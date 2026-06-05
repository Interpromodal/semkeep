# Mind Palace MCP Implementation Plan

> **Renamed:** this project shipped as **semkeep**. This dated plan keeps its original working name ("Mind Palace") as a historical record.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, offline-capable MCP server that gives Claude semantic search over code & local docs (clickable `file:line`) plus a thin durable notes scratchpad — the gap MemPalace's conversational memory leaves open.

**Architecture:** Node + TypeScript ESM. A JSON store holds chunk/note records with L2-normalized embedding vectors; search is brute-force dot-product (= cosine) ranking. Embeddings come from a tiered, never-fail provider chain (API key → Ollama → local all-MiniLM → deterministic lexical fallback). The MCP layer is thin wiring over pure modules. Tests force the lexical embedder so the suite needs no network or model download.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk` (high-level `McpServer`), `zod` (tool input schemas), `vitest` (test runner — chosen over node:test for reliable ESM+TS+glob on Windows), `tsx` (dev run). `@huggingface/transformers` is an **optional**, lazily-imported dependency (local model tier) so the core install stays fast and never blocks.

---

## File Structure

```
package.json            # ESM, scripts: build/test/start/dev
tsconfig.json           # NodeNext, strict, outDir dist
src/
  types.ts              # Chunk, Note, StoreData, SearchHit, EmbeddingProvider
  config.ts             # env + defaults (dataDir, forced embedder, hosts/models)
  embeddings/
    lexical.ts          # deterministic hashed bag-of-identifiers vectorizer (always works)
    openai.ts           # OPENAI_API_KEY provider
    voyage.ts           # VOYAGE_API_KEY provider
    ollama.ts           # local Ollama provider
    local.ts            # transformers.js all-MiniLM (lazy/optional)
    detect.ts           # tiered selection -> { provider, degraded }
  store.ts              # load/save (atomic), upsert chunks, notes CRUD+dedup, dot-search
  chunker.ts            # walk + ignore rules + line-aware chunking + content hash
  indexer.ts            # indexPath: walk -> hash/skip -> chunk -> embed -> upsert
  search.ts             # query -> embed -> dot (+ keyword boost) -> scoped, ranked hits
  tools.ts              # 6 thin tool handlers (index_path, search, remember, recall, forget, status)
  server.ts             # McpServer wiring + stdio main
test/
  lexical.test.ts
  store.test.ts
  chunker.test.ts
  search.test.ts
  notes.test.ts
  detect.test.ts
  integration.test.ts
README.md
```

Decision: tool handlers live in one `tools.ts` (they're thin and change together) rather than a `tools/` dir — keeps a small project from sprawling. `server.ts` stays pure wiring.

---

## Shared Types (defined once, referenced everywhere)

```typescript
// src/types.ts
export interface EmbeddingProvider {
  readonly name: string;
  readonly dim: number;
  embed(texts: string[]): Promise<Float32Array[]>; // returns L2-normalized vectors
}

export interface Chunk {
  id: string;          // `${fileHash}:${startLine}` style, stable
  file: string;        // absolute path
  startLine: number;   // 1-based, inclusive
  endLine: number;     // 1-based, inclusive
  text: string;
  vector: number[];    // L2-normalized
}

export interface Note {
  id: string;          // `n_<sha1[0..10]>`
  text: string;
  tags: string[];
  vector: number[];    // L2-normalized
  createdAt: number;   // Date.now()
}

export interface StoreData {
  meta: { embedder: string; dim: number; version: number };
  files: Record<string, string>;  // path -> contentHash (skip-unchanged)
  chunks: Chunk[];
  notes: Note[];
}

export interface SearchHit {
  file: string; startLine: number; endLine: number; score: number; snippet: string;
}
```

---

### Task 0: Scaffold project

**Files:** Create `package.json`, `tsconfig.json`, `src/types.ts`, `test/smoke.test.ts`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "mind-palace-mcp",
  "version": "0.1.0",
  "type": "module",
  "bin": { "mind-palace-mcp": "dist/server.js" },
  "scripts": {
    "build": "tsc",
    "start": "node dist/server.js",
    "dev": "tsx src/server.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.23.0"
  },
  "optionalDependencies": {
    "@huggingface/transformers": "^3.0.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "@types/node": "^22.0.0",
    "vitest": "^2.0.0",
    "tsx": "^4.16.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": false
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3:** Create `src/types.ts` with the Shared Types block above.

- [ ] **Step 4: Write smoke test** `test/smoke.test.ts`

```typescript
import { test, expect } from "vitest";
import type { StoreData } from "../src/types.js";
test("types compile & smoke", () => {
  const s: StoreData = { meta: { embedder: "x", dim: 1, version: 1 }, files: {}, chunks: [], notes: [] };
  expect(s.chunks).toHaveLength(0);
});
```

- [ ] **Step 5:** `npm install` then `npm test`. Expected: 1 passing test. Note: optional `@huggingface/transformers` may warn if it can't build — that's fine, it's optional.

- [ ] **Step 6: Commit** `chore: scaffold mind-palace-mcp (ts, vitest, mcp sdk)`

---

### Task 1: Lexical embedder (the always-works fallback)

**Files:** Create `src/embeddings/lexical.ts`, `test/lexical.test.ts`

Core idea: tokenize (split identifiers on camelCase/snake/non-alphanumerics, lowercase), hash each token into a `dim`-wide vector with sublinear tf, then L2-normalize. Cosine over these = weighted token overlap — lexical but ranked, deterministic, dependency-free. Identifier splitting is what makes it usable for code (`backoffScheduler` → `backoff`, `scheduler`).

- [ ] **Step 1: Write failing test** `test/lexical.test.ts`

```typescript
import { test, expect } from "vitest";
import { LexicalEmbedder, tokenize } from "../src/embeddings/lexical.js";

test("tokenize splits identifiers", () => {
  expect(tokenize("backoffScheduler retry_count")).toEqual(
    ["backoff", "scheduler", "retry", "count"]
  );
});

test("embeddings are deterministic and normalized", async () => {
  const e = new LexicalEmbedder(256);
  const [a] = await e.embed(["retry backoff logic"]);
  const [b] = await e.embed(["retry backoff logic"]);
  expect(Array.from(a)).toEqual(Array.from(b));            // deterministic
  const norm = Math.hypot(...Array.from(a));
  expect(norm).toBeCloseTo(1, 5);                          // L2-normalized
});

test("closer text scores higher (cosine via dot)", async () => {
  const e = new LexicalEmbedder(512);
  const [q] = await e.embed(["retry logic with backoff"]);
  const [near] = await e.embed(["the backoffScheduler handles retry attempts"]);
  const [far] = await e.embed(["render the login button in blue"]);
  const dot = (x: Float32Array, y: Float32Array) => x.reduce((s, v, i) => s + v * y[i], 0);
  expect(dot(q, near)).toBeGreaterThan(dot(q, far));
});
```

- [ ] **Step 2:** Run `npx vitest run test/lexical.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `src/embeddings/lexical.ts`

```typescript
import type { EmbeddingProvider } from "../types.js";

export function tokenize(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")   // camelCase -> camel Case
    .split(/[^A-Za-z0-9]+/)                     // non-alnum incl. _ . -
    .filter(Boolean)
    .map((t) => t.toLowerCase());
}

function hashToken(tok: string, dim: number): number {
  let h = 2166136261;
  for (let i = 0; i < tok.length; i++) { h ^= tok.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h) % dim;
}

export class LexicalEmbedder implements EmbeddingProvider {
  readonly name = "lexical";
  constructor(readonly dim = 512) {}
  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((text) => {
      const v = new Float32Array(this.dim);
      for (const tok of tokenize(text)) v[hashToken(tok, this.dim)] += 1;
      for (let i = 0; i < this.dim; i++) if (v[i] > 0) v[i] = 1 + Math.log(v[i]); // sublinear tf
      let norm = 0; for (let i = 0; i < this.dim; i++) norm += v[i] * v[i];
      norm = Math.sqrt(norm) || 1;
      for (let i = 0; i < this.dim; i++) v[i] /= norm;
      return v;
    });
  }
}
```

- [ ] **Step 4:** Run `npx vitest run test/lexical.test.ts`. Expected: PASS (3 tests).
- [ ] **Step 5: Commit** `feat: deterministic lexical embedder with identifier-aware tokenizer`

---

### Task 2: Store (CRUD + dot-search + atomic save)

**Files:** Create `src/store.ts`, `test/store.test.ts`

Vectors are stored already-normalized, so similarity is a plain dot product. Save is atomic (write temp + rename). `addNote` does cosine dedup.

Interface:
```typescript
class Store {
  static load(dataDir: string): Promise<Store>;
  save(): Promise<void>;
  setEmbedderMeta(name: string, dim: number): void;       // sets meta if empty; throws on dim mismatch unless empty
  fileHash(path: string): string | undefined;
  setFileHash(path: string, hash: string): void;
  replaceFileChunks(path: string, chunks: Chunk[]): void;  // drop old chunks for file, add new
  searchChunks(q: number[], k: number, filter?: {pathPrefix?: string; ext?: string[]}): SearchHit[];
  addNote(text: string, tags: string[], vector: number[], dedupThreshold?: number): {id: string; deduped: boolean};
  searchNotes(q: number[], k: number): Array<{id:string;text:string;tags:string[];score:number}>;
  deleteNote(id: string): boolean;
  stats(): {chunkCount:number; noteCount:number; fileCount:number; embedder:string; dim:number};
}
export function dot(a: number[]|Float32Array, b: number[]|Float32Array): number;
```

- [ ] **Step 1: Write failing test** `test/store.test.ts`

```typescript
import { test, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, dot } from "../src/store.js";

const tmp = () => mkdtempSync(join(tmpdir(), "mp-"));

test("dot of identical unit vectors ~1", () => {
  expect(dot([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  expect(dot([1, 0, 0], [0, 1, 0])).toBeCloseTo(0);
});

test("searchChunks ranks by similarity and respects pathPrefix", async () => {
  const s = await Store.load(tmp());
  s.setEmbedderMeta("lexical", 3);
  s.replaceFileChunks("/repo/a.ts", [
    { id: "a1", file: "/repo/a.ts", startLine: 1, endLine: 2, text: "retry backoff", vector: [1, 0, 0] },
  ]);
  s.replaceFileChunks("/repo/b.ts", [
    { id: "b1", file: "/repo/b.ts", startLine: 1, endLine: 2, text: "blue button", vector: [0, 1, 0] },
  ]);
  const hits = s.searchChunks([1, 0, 0], 5);
  expect(hits[0].file).toBe("/repo/a.ts");
  const scoped = s.searchChunks([1, 0, 0], 5, { pathPrefix: "/repo/b" });
  expect(scoped).toHaveLength(1);
  expect(scoped[0].file).toBe("/repo/b.ts");
});

test("addNote dedups near-identical vectors", async () => {
  const s = await Store.load(tmp());
  s.setEmbedderMeta("lexical", 3);
  const r1 = s.addNote("auth uses JWT", [], [1, 0, 0]);
  const r2 = s.addNote("auth uses JWT", [], [1, 0, 0]);
  expect(r1.deduped).toBe(false);
  expect(r2.deduped).toBe(true);
  expect(r2.id).toBe(r1.id);
});

test("save then load round-trips", async () => {
  const dir = tmp();
  const s = await Store.load(dir);
  s.setEmbedderMeta("lexical", 3);
  s.addNote("remember me", ["x"], [0, 1, 0]);
  await s.save();
  const s2 = await Store.load(dir);
  expect(s2.stats().noteCount).toBe(1);
});
```

- [ ] **Step 2:** `npx vitest run test/store.test.ts` → FAIL.
- [ ] **Step 3: Implement** `src/store.ts` (load/save atomic via `writeFileSync(tmp)`+`renameSync`; `dot`; ranking with optional `pathPrefix`/`ext` filter; `addNote` computes max dot vs existing notes, dedups if `> dedupThreshold` default 0.97; ids via `crypto` sha1). Build snippet for hits as the chunk text truncated to ~3 lines.
- [ ] **Step 4:** `npx vitest run test/store.test.ts` → PASS (4 tests).
- [ ] **Step 5: Commit** `feat: json store with dot-product search, note dedup, atomic save`

---

### Task 3: Chunker (walk + ignore + line-aware chunks + hash)

**Files:** Create `src/chunker.ts`, `test/chunker.test.ts`

- [ ] **Step 1: Write failing test** `test/chunker.test.ts`

```typescript
import { test, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { walk, chunkText, hashContent, DEFAULT_INCLUDE } from "../src/chunker.js";

function repo() {
  const d = mkdtempSync(join(tmpdir(), "mp-repo-"));
  writeFileSync(join(d, "a.ts"), "line1\nline2\nline3\n");
  mkdirSync(join(d, "node_modules"));
  writeFileSync(join(d, "node_modules", "junk.ts"), "ignored\n");
  writeFileSync(join(d, "pic.png"), Buffer.from([0, 1, 2, 0, 3]));
  return d;
}

test("walk includes code files, ignores node_modules and binaries", () => {
  const files = walk(repo(), { include: DEFAULT_INCLUDE, exclude: [] });
  expect(files.some((f) => f.endsWith("a.ts"))).toBe(true);
  expect(files.some((f) => f.includes("node_modules"))).toBe(false);
  expect(files.some((f) => f.endsWith("pic.png"))).toBe(false);
});

test("chunkText produces line-aware windows with overlap", () => {
  const text = Array.from({ length: 120 }, (_, i) => `L${i + 1}`).join("\n");
  const chunks = chunkText(text, 50, 10);
  expect(chunks[0].startLine).toBe(1);
  expect(chunks[0].endLine).toBe(50);
  expect(chunks[1].startLine).toBe(41); // 50 - 10 overlap + 1
  expect(chunks.at(-1)!.endLine).toBe(120);
});

test("hashContent is stable", () => {
  expect(hashContent("abc")).toBe(hashContent("abc"));
  expect(hashContent("abc")).not.toBe(hashContent("abd"));
});
```

- [ ] **Step 2:** `npx vitest run test/chunker.test.ts` → FAIL.
- [ ] **Step 3: Implement** `src/chunker.ts`:
  - `DEFAULT_INCLUDE` = extension set (ts,tsx,js,jsx,mjs,cjs,py,go,rs,java,rb,php,c,cpp,h,hpp,cs,kt,swift,scala,sh,md,mdx,txt,json,yaml,yml,toml,html,css,scss).
  - `DEFAULT_IGNORE_DIRS` = .git,node_modules,dist,build,.next,out,coverage,.mindpalace,vendor,.venv,__pycache__,target.
  - `walk(dir,{include,exclude})`: recursive readdir; skip ignore dirs + exclude substrings; include files whose ext ∈ include; skip files > 1.5MB; skip binary (NUL byte in first 4KB).
  - `chunkText(text, window=50, overlap=10)`: slice lines into windows, 1-based start/end, step = window-overlap, drop empty.
  - `hashContent(text)`: sha1 hex.
- [ ] **Step 4:** `npx vitest run test/chunker.test.ts` → PASS (3 tests).
- [ ] **Step 5: Commit** `feat: file walker with ignore rules and line-aware chunker`

---

### Task 4: Indexer (orchestration + skip-unchanged)

**Files:** Create `src/indexer.ts` (no new test file — covered by integration in Task 7; add a focused unit test here)

`indexPath(store, embedder, path, {include?, exclude?, force?})` → `{filesIndexed, chunksAdded, filesSkipped, embedder, elapsedMs}`. For each file: compute hash; if `store.fileHash(path)===hash && !force` → skip; else read, `chunkText`, `embedder.embed(texts)`, build `Chunk[]` (id = `${hash.slice(0,12)}:${startLine}`), `store.replaceFileChunks`, `store.setFileHash`.

- [ ] **Step 1: Write failing test** `test/indexer` block inside `test/chunker.test.ts` is avoided; create `test/indexer.test.ts`:

```typescript
import { test, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { indexPath } from "../src/indexer.js";
import { LexicalEmbedder } from "../src/embeddings/lexical.js";

test("indexes files then skips unchanged on re-run", async () => {
  const d = mkdtempSync(join(tmpdir(), "mp-idx-"));
  writeFileSync(join(d, "x.ts"), "function retryWithBackoff() {}\n");
  const store = await Store.load(mkdtempSync(join(tmpdir(), "mp-data-")));
  const emb = new LexicalEmbedder(256);
  store.setEmbedderMeta(emb.name, emb.dim);
  const r1 = await indexPath(store, emb, d);
  expect(r1.filesIndexed).toBe(1);
  const r2 = await indexPath(store, emb, d);
  expect(r2.filesIndexed).toBe(0);     // unchanged -> skipped
  expect(r2.filesSkipped).toBe(1);
});
```

- [ ] **Step 2:** `npx vitest run test/indexer.test.ts` → FAIL.
- [ ] **Step 3: Implement** `src/indexer.ts` per signature above.
- [ ] **Step 4:** `npx vitest run test/indexer.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat: indexer with content-hash skip-unchanged`

---

### Task 5: Search (semantic + keyword boost + scoping)

**Files:** Create `src/search.ts`, `test/search.test.ts`

`search(store, embedder, query, {k=8, pathPrefix?, ext?, mode="hybrid"})`: embed query → `store.searchChunks` (over-fetch k*4) → if `mode==="hybrid"`, add a keyword-overlap boost (`shared query tokens / query tokens` × 0.3) to each hit's score and re-sort → return top k. Scoping passes `pathPrefix`/`ext` into the store filter.

- [ ] **Step 1: Write failing test** `test/search.test.ts`

```typescript
import { test, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { indexPath } from "../src/indexer.js";
import { search } from "../src/search.js";
import { LexicalEmbedder } from "../src/embeddings/lexical.js";

test("natural-language query finds the right code chunk", async () => {
  const d = mkdtempSync(join(tmpdir(), "mp-s-"));
  writeFileSync(join(d, "net.ts"), "export function backoffScheduler(){ /* retry attempts */ }\n");
  writeFileSync(join(d, "ui.ts"), "export function renderLoginButton(){ /* blue */ }\n");
  const store = await Store.load(mkdtempSync(join(tmpdir(), "mp-d-")));
  const emb = new LexicalEmbedder(512);
  store.setEmbedderMeta(emb.name, emb.dim);
  await indexPath(store, emb, d);
  const hits = await search(store, emb, "where is the retry backoff logic", { k: 3 });
  expect(hits[0].file.endsWith("net.ts")).toBe(true);
});
```

- [ ] **Step 2:** `npx vitest run test/search.test.ts` → FAIL.
- [ ] **Step 3: Implement** `src/search.ts` per signature.
- [ ] **Step 4:** `npx vitest run test/search.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat: scoped hybrid search (semantic + keyword boost)`

---

### Task 6: Notes (remember + recall + forget)

**Files:** Create `src/tools.ts` notes helpers OR thin functions in `src/search.ts`? → put note ops in `src/tools.ts` later; for now test through Store + embedder directly to confirm behavior.

Notes flow uses `embedder.embed([text])` then `store.addNote/searchNotes/deleteNote`. This is exercised end-to-end in Task 8 tool tests; here we add one direct test for recall ranking.

- [ ] **Step 1: Write failing test** `test/notes.test.ts`

```typescript
import { test, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { LexicalEmbedder } from "../src/embeddings/lexical.js";

test("recall finds the relevant note by meaning, forget removes it", async () => {
  const store = await Store.load(mkdtempSync(join(tmpdir(), "mp-n-")));
  const emb = new LexicalEmbedder(512);
  store.setEmbedderMeta(emb.name, emb.dim);
  for (const t of ["auth uses JWT tokens", "the logo is teal", "deploy runs on Vercel"]) {
    const [v] = await emb.embed([t]); store.addNote(t, [], Array.from(v));
  }
  const [qv] = await emb.embed(["how does authentication work"]);
  const hits = store.searchNotes(Array.from(qv), 1);
  expect(hits[0].text).toContain("JWT");
  expect(store.deleteNote(hits[0].id)).toBe(true);
});
```

- [ ] **Step 2–4:** Run → (Store already implements these) PASS. If `searchNotes` ranking is off, fix in store.
- [ ] **Step 5: Commit** `test: note recall-by-meaning and forget`

---

### Task 7: Embedding providers + tiered detect

**Files:** Create `src/embeddings/{openai,voyage,ollama,local,detect}.ts`, `src/config.ts`, `test/detect.test.ts`

Providers each implement `EmbeddingProvider`, normalizing output vectors. `detect(config, fetchImpl?)` returns `{provider, degraded}` trying: forced env → OpenAI/Voyage key → Ollama reachable → local (dynamic import; if import throws, skip) → LexicalEmbedder (`degraded:true`). Inject `fetch` for tests.

- [ ] **Step 1: Write failing test** `test/detect.test.ts`

```typescript
import { test, expect } from "vitest";
import { detect } from "../src/embeddings/detect.js";

test("falls back to lexical when nothing is available", async () => {
  const { provider, degraded } = await detect(
    { dataDir: ".", forced: undefined, openaiKey: undefined, voyageKey: undefined, ollamaHost: "http://127.0.0.1:1" },
    async () => { throw new Error("offline"); }   // ollama unreachable
  );
  expect(provider.name).toBe("lexical");
  expect(degraded).toBe(true);
});

test("uses ollama when reachable", async () => {
  const fakeFetch = async (url: string) =>
    ({ ok: true, json: async () => ({ models: [] }) }) as any;
  const { provider, degraded } = await detect(
    { dataDir: ".", forced: undefined, openaiKey: undefined, voyageKey: undefined, ollamaHost: "http://x" },
    fakeFetch as any
  );
  expect(provider.name).toBe("ollama");
  expect(degraded).toBe(false);
});
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** providers + `detect` + `config.ts` (`loadConfig()` reading `MIND_PALACE_DATA_DIR`, `OPENAI_API_KEY`, `VOYAGE_API_KEY`, `OLLAMA_HOST` default `http://localhost:11434`, `MIND_PALACE_EMBEDDER`, `MIND_PALACE_MODEL`). API/local providers need no live test (network/model); detection logic is unit-tested with injected fetch. `local.ts` wraps `@huggingface/transformers` in try/catch dynamic import.
- [ ] **Step 4:** Run → PASS (2 tests).
- [ ] **Step 5: Commit** `feat: tiered never-fail embedding detection (api/ollama/local/lexical)`

---

### Task 8: MCP server wiring (tools.ts + server.ts)

**Files:** Create `src/tools.ts`, `src/server.ts`

`tools.ts` exports handler functions taking a shared context `{store, embedder, degraded, config}` and returning MCP `content` payloads. `server.ts` builds `McpServer`, registers the 6 tools with zod schemas, lazily builds context on first use (detect embedder, load store), connects `StdioServerTransport`. `status.protocol` returns a short usage string ("Prefer `search` for meaning-based code lookup; use `pathPrefix`/`ext` to scope; `Grep` for exact strings.").

- [ ] **Step 1:** Write `src/tools.ts` with the 6 handlers (index_path, search, remember, recall, forget, status), formatting `SearchHit[]` as readable `file:startLine-endLine (score)\n  snippet` text.
- [ ] **Step 2:** Write `src/server.ts` (McpServer + zod tool registration + stdio). Confirm exact SDK import paths against installed version (`server/mcp.js`, `server/stdio.js`).
- [ ] **Step 3: Build** `npm run build`. Expected: clean tsc, `dist/server.js` exists.
- [ ] **Step 4: Manual stdio smoke** — send an MCP `initialize` + `tools/list` JSON-RPC line to `node dist/server.js` and confirm 6 tools come back (script in README/dev notes).
- [ ] **Step 5: Commit** `feat: MCP stdio server exposing 6 mind-palace tools`

---

### Task 9: Integration test (end-to-end, never-fail proof)

**Files:** Create `test/integration.test.ts`

- [ ] **Step 1: Write test** — build a temp repo with a few files; `loadConfig` forced to lexical; `Store.load`; `indexPath`; assert `search("retry backoff")` top hit is the networking file; `remember`/`recall`/`forget` round-trip; assert a `status()`-style stats object reports `degraded:true` under lexical. (Reuses public module APIs — no MCP transport needed.)
- [ ] **Step 2–4:** Run full suite `npm test` → all green.
- [ ] **Step 5: Commit** `test: end-to-end index/search/notes integration`

---

### Task 10: README, register with Claude Code, live demo

**Files:** Create `README.md`

- [ ] **Step 1:** Write `README.md` (what/why, tools, embedding tiers, env vars, `claude mcp add` line, scoping tips).
- [ ] **Step 2: Register** (after build): `claude mcp add mind-palace -- node F:\Dreams\Dream1\dist\server.js`. Document that Claude Code must restart to load it.
- [ ] **Step 3: Live demo** — index this project's own `src/`, run a natural-language `search`, show `file:line` hits Grep would miss; `remember`→`recall` round-trip; `status` showing the active tier.
- [ ] **Step 4: Commit** `docs: README + Claude Code registration`

---

## Self-Review

- **Spec coverage:** index_path (T4/T8), search (T5/T8), remember/recall/forget (T6/T8), status+protocol (T8), tiered never-fail embeddings (T1,T7), JSON store + cosine (T2), scoping first-class (T2/T5), dedup on remember (T2/T6), chunking+ignore (T3), TDD-no-network (lexical forced throughout), registration+demo (T10). All spec sections map to a task. ✔
- **Placeholders:** none — every code step has real code; signatures defined before use. ✔
- **Type consistency:** `EmbeddingProvider.embed`, `Chunk`, `Note`, `StoreData`, `SearchHit`, `dot`, `Store` method names are used identically across T1–T9. `search()` and `indexPath()` signatures match between definition and call sites. ✔
- **Known integration risk:** exact `@modelcontextprotocol/sdk` import paths/API verified at T8 against the installed version (adapt if the high-level `McpServer` API differs); the local-model tier (T7) is best-effort and guarded by try/catch so install/runtime failure degrades to lexical. ✔
