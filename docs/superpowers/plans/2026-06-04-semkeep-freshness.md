# semkeep Phase 2 — Freshness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make semkeep's index auto-reflect edits, new files, and deletions via lazy freshen-on-query — no manual re-index.

**Architecture:** Persist indexed roots + per-file stat signatures in the store. A new `freshen` pass (called at the top of code/structure tools, debounced) stat-scans the roots, re-indexes changed/new files via a shared `indexFile`, and prunes deleted ones. Extends the existing codebase; no new dependencies.

**Tech Stack:** TypeScript ESM, Node `fs` (`statSync`), existing `chunker`/`structure`/`store`, vitest. No watcher, no ANN.

---

## File Structure

```
src/freshen.ts   # NEW: freshen(store, embedder) -> summary; scan/update/prune; never throws
src/types.ts     # MODIFY: StoreData.roots[]; StoreData.fileStats; IndexRoot/FileStat types
src/store.ts     # MODIFY: load/rebuild init; setRoot/roots/fileStat/setFileStat/pruneFile/allIndexedFiles
src/indexer.ts   # MODIFY: extract indexFile(...); record root + stat sig in indexPath
src/config.ts    # MODIFY: autoRefresh (default true), refreshDebounceMs
src/tools.ts     # MODIFY: maybeFreshen(ctx) at top of search/define/callers/outline/imports; refreshTool; status
src/server.ts    # MODIFY: register `refresh`
test/freshness.test.ts        # NEW
test/freshness-store.test.ts  # NEW
```

## Shared Types (add to `src/types.ts`)

```typescript
export interface IndexRoot {
  path: string; // absolute
  include?: string[];
  exclude?: string[];
}
export interface FileStat {
  mtime: number; // statSync().mtimeMs
  size: number;
}
```
Add to `StoreData`: `roots: IndexRoot[];` and `fileStats: Record<string, FileStat>;`.

---

### Task 1: Store — roots, fileStats, pruneFile, accessors

**Files:** Modify `src/types.ts`, `src/store.ts`; Create `test/freshness-store.test.ts`

Add `roots`/`fileStats` to `StoreData` + the two interfaces. In `Store.load`, init both (`data.roots ??= []; data.fileStats ??= {}`) in the existing branch and the fresh-init object. In `rebuildForEmbedder`, also clear them (`this.data.roots = []` — actually keep roots so re-index targets survive an embedder change; clear `fileStats = {}` so everything re-embeds). Methods:

```typescript
setRoot(path: string, opts: { include?: string[]; exclude?: string[] }): void {
  this.data.roots = this.data.roots.filter((r) => r.path !== path);
  this.data.roots.push({ path, include: opts.include, exclude: opts.exclude });
}
roots(): IndexRoot[] { return this.data.roots; }
fileStat(path: string): FileStat | undefined { return this.data.fileStats[path]; }
setFileStat(path: string, sig: FileStat): void { this.data.fileStats[path] = sig; }
allIndexedFiles(): string[] { return Object.keys(this.data.files); }
pruneFile(file: string): void {
  this.data.chunks = this.data.chunks.filter((c) => c.file !== file);
  this.data.symbols = this.data.symbols.filter((s) => s.file !== file);
  this.data.imports = this.data.imports.filter((i) => i.file !== file);
  this.data.references = this.data.references.filter((r) => r.file !== file);
  delete this.data.files[file];
  delete this.data.fileStats[file];
}
```
Note: `rebuildForEmbedder` keeps `roots` (re-index targets) but resets `fileStats = {}`.

- [ ] **Step 1: Write failing test** `test/freshness-store.test.ts`

```typescript
import { test, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";

test("roots dedupe by path and persist; fileStats persist", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mp-fr-"));
  const s = await Store.load(dir);
  s.setEmbedderMeta("lexical", 3);
  s.setRoot("/repo", { include: ["ts"] });
  s.setRoot("/repo", { exclude: ["dist"] }); // dedupe
  s.setFileStat("/repo/a.ts", { mtime: 111, size: 9 });
  expect(s.roots()).toHaveLength(1);
  expect(s.roots()[0].exclude).toEqual(["dist"]);
  await s.save();
  const s2 = await Store.load(dir);
  expect(s2.roots()[0].path).toBe("/repo");
  expect(s2.fileStat("/repo/a.ts")).toEqual({ mtime: 111, size: 9 });
});

test("pruneFile removes every record type", async () => {
  const s = await Store.load(mkdtempSync(join(tmpdir(), "mp-pr-")));
  s.setEmbedderMeta("lexical", 3);
  s.replaceFileChunks("/r/a.ts", [{ id: "c", file: "/r/a.ts", startLine: 1, endLine: 1, text: "x", vector: [1, 0, 0] }]);
  s.replaceFileSymbols(
    "/r/a.ts",
    [{ id: "s", file: "/r/a.ts", name: "f", kind: "function", startLine: 1, endLine: 1, exported: true }],
    [{ file: "/r/a.ts", source: "./b.js", names: ["x"] }],
    [{ file: "/r/a.ts", name: "x", line: 1 }],
  );
  s.setFileHash("/r/a.ts", "h");
  s.setFileStat("/r/a.ts", { mtime: 1, size: 1 });
  s.pruneFile("/r/a.ts");
  expect(s.stats().chunkCount).toBe(0);
  expect(s.stats().symbolCount).toBe(0);
  expect(s.allIndexedFiles()).not.toContain("/r/a.ts");
  expect(s.fileStat("/r/a.ts")).toBeUndefined();
});
```

- [ ] **Step 2:** `npx vitest run test/freshness-store.test.ts` → FAIL.
- [ ] **Step 3:** Implement the type + store changes.
- [ ] **Step 4:** Run → PASS; `npx vitest run` (all) green.
- [ ] **Step 5: Commit** `feat(store): indexed roots, file stat signatures, pruneFile`

---

### Task 2: Indexer — extract `indexFile`, record roots + stat sigs

**Files:** Modify `src/indexer.ts`; extend `test/indexer.test.ts`

Extract the per-file pipeline into:
```typescript
export async function indexFile(
  store: Store, embedder: EmbeddingProvider, file: string, text: string, hash: string, sig: FileStat,
): Promise<{ chunksAdded: number; symbolsAdded: number }>
```
It does what the current loop body does (parse → symbols/imports/references → replaceFileSymbols → symbolChunks → embed → replaceFileChunks) **plus** `store.setFileHash(file, hash)` and `store.setFileStat(file, sig)`. `indexPath` then: records the root once (`store.setRoot(root, { include, exclude })`), and per file `statSync` → build `sig` → on skip-unchanged still `store.setFileStat(file, sig)`, else call `indexFile`.

- [ ] **Step 1: Write failing test** (append to `test/indexer.test.ts`): after `indexPath` on a temp dir, assert `store.roots()[0].path` resolves to that dir and `store.fileStat(<the indexed file>)` is defined with `size > 0`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `indexFile` + the `indexPath` refactor.
- [ ] **Step 4:** Run → PASS; full suite green (existing indexer tests still pass).
- [ ] **Step 5: Commit** `refactor(indexer): extract indexFile; record roots + stat signatures`

---

### Task 3: `freshen` — scan, re-index changed/new, prune deleted

**Files:** Create `src/freshen.ts`, `test/freshness.test.ts`

```typescript
import { readFileSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { EmbeddingProvider } from "./types.js";
import { Store } from "./store.js";
import { DEFAULT_INCLUDE, hashContent, walk } from "./chunker.js";
import { indexFile } from "./indexer.js";

export interface FreshenSummary { scanned: number; reindexed: number; added: number; pruned: number; elapsedMs: number; }

function underRoot(file: string, rootPath: string): boolean {
  return file === rootPath || file.startsWith(rootPath + sep);
}

export async function freshen(store: Store, embedder: EmbeddingProvider): Promise<FreshenSummary> {
  const started = Date.now();
  let scanned = 0, reindexed = 0, added = 0, pruned = 0;
  for (const root of store.roots()) {
    let isFile = false;
    try { isFile = statSync(root.path).isFile(); } catch { continue; } // missing root -> skip (no prune)
    const files = isFile
      ? [resolve(root.path)]
      : walk(root.path, { include: root.include ?? DEFAULT_INCLUDE, exclude: root.exclude ?? [] });
    const currentSet = new Set(files);
    for (const file of files) {
      scanned++;
      let st; try { st = statSync(file); } catch { continue; }
      const sig = { mtime: st.mtimeMs, size: st.size };
      const prev = store.fileStat(file);
      if (prev && prev.mtime === sig.mtime && prev.size === sig.size) continue; // fast path
      let text; try { text = readFileSync(file, "utf8"); } catch { continue; }
      const hash = hashContent(text);
      const known = store.fileHash(file);
      store.setFileStat(file, sig);
      if (known === hash) continue; // content same despite stat change
      try { await indexFile(store, embedder, file, text, hash, sig); } catch { continue; }
      if (known === undefined) added++; else reindexed++;
    }
    for (const f of store.allIndexedFiles()) {
      if (underRoot(f, root.path) && !currentSet.has(f)) { store.pruneFile(f); pruned++; }
    }
  }
  return { scanned, reindexed, added, pruned, elapsedMs: Date.now() - started };
}
```

- [ ] **Step 1: Write failing test** `test/freshness.test.ts`

```typescript
import { test, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { indexPath } from "../src/indexer.js";
import { freshen } from "../src/freshen.js";
import { LexicalEmbedder } from "../src/embeddings/lexical.js";

async function setup() {
  const repo = mkdtempSync(join(tmpdir(), "mp-frq-repo-"));
  writeFileSync(join(repo, "a.ts"), "export function alpha(){ return 1 }\n");
  const store = await Store.load(mkdtempSync(join(tmpdir(), "mp-frq-data-")));
  const emb = new LexicalEmbedder(256);
  store.setEmbedderMeta(emb.name, emb.dim);
  await indexPath(store, emb, repo);
  return { repo, store, emb };
}

test("freshen indexes a NEW file", async () => {
  const { repo, store, emb } = await setup();
  writeFileSync(join(repo, "b.ts"), "export function beta(){ return 2 }\n");
  const r = await freshen(store, emb);
  expect(r.added).toBe(1);
  expect(store.findDefinitions("beta")).toHaveLength(1);
});

test("freshen re-indexes a CHANGED file", async () => {
  const { repo, store, emb } = await setup();
  writeFileSync(join(repo, "a.ts"), "export function alpha(){ return 1 }\nexport function gamma(){ return 3 }\n");
  const r = await freshen(store, emb);
  expect(r.reindexed).toBe(1);
  expect(store.findDefinitions("gamma")).toHaveLength(1);
});

test("freshen PRUNES a deleted file", async () => {
  const { repo, store, emb } = await setup();
  rmSync(join(repo, "a.ts"));
  const r = await freshen(store, emb);
  expect(r.pruned).toBe(1);
  expect(store.findDefinitions("alpha")).toHaveLength(0);
});

test("freshen is a no-op when nothing changed", async () => {
  const { store, emb } = await setup();
  const r = await freshen(store, emb);
  expect(r.added).toBe(0);
  expect(r.reindexed).toBe(0);
  expect(r.pruned).toBe(0);
});
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `src/freshen.ts`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(freshen): stat-based scan — re-index changed/new, prune deleted`

---

### Task 4: Tools/server/config — auto-freshen + `refresh` + status

**Files:** Modify `src/config.ts`, `src/tools.ts`, `src/server.ts`; extend `test/structure-tools.test.ts`

- `config.ts`: add `autoRefresh: boolean` (`env.SEMKEEP_AUTO_REFRESH !== "0" && env.SEMKEEP_AUTO_REFRESH !== "false"`) and `refreshDebounceMs: number` (`Number(env.SEMKEEP_REFRESH_DEBOUNCE_MS) || 1500`) to `SemkeepConfig` + `loadConfig`.
- `tools.ts`: module-level `let lastFreshenAt = 0`. Add:
```typescript
export async function maybeFreshen(ctx: Context): Promise<void> {
  if (!ctx.config.autoRefresh) return;
  const now = Date.now();
  if (now - lastFreshenAt < ctx.config.refreshDebounceMs) return;
  lastFreshenAt = now;
  const r = await freshen(ctx.store, ctx.embedder);
  if (r.added || r.reindexed || r.pruned) await ctx.store.save();
}
```
Call `await maybeFreshen(ctx)` as the first line of `searchTool`, `defineTool`, `callersTool`, `outlineTool`, `importsTool`. Add `refreshTool(ctx)` → `const r = await freshen(ctx.store, ctx.embedder); await ctx.store.save(); return \`Refreshed: +${r.added} new, ${r.reindexed} changed, -${r.pruned} pruned in ${r.elapsedMs}ms.\`;`. Extend `statusTool` with `roots: ${ctx.store.roots().length}` and `auto-refresh: ${ctx.config.autoRefresh ? "on" : "off"}`.
- `server.ts`: register `refresh` (no inputs).

- [ ] **Step 1: Write failing test** (append to `test/structure-tools.test.ts`): build a Context with `config.autoRefresh = true, refreshDebounceMs = 0`; index a temp repo via `indexPathTool`; delete one file with `rmSync`; call `searchTool` (or `defineTool` for the deleted symbol) — assert the deleted file/symbol no longer appears (auto-freshen pruned it).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement config + `maybeFreshen` + tool wiring + `refresh` registration.
- [ ] **Step 4:** Run → PASS; `npm run build` clean; full suite green.
- [ ] **Step 5: Commit** `feat: auto-freshen on query + refresh tool + status roots/auto-refresh`

---

### Task 5: Acceptance

**Files:** Create `scripts/demo-freshness.mjs`

- [ ] **Step 1:** Demo script: index a temp repo (lexical, fast); then **add** a file, **edit** a file, **delete** a file; call `freshen`; print that `define`/`search` reflect each change (new symbol found, edited symbol updated, deleted symbol gone) — all **without** a manual `index_path`.
- [ ] **Step 2:** Run it; confirm output shows add/edit/delete all reflected.
- [ ] **Step 3:** `npm test` green. **Commit** `test: end-to-end freshness demo (add/edit/delete)`

---

## Self-Review

- **Spec coverage:** persist roots (T1/T2), stat signatures (T1/T2), pruneFile (T1), indexFile DRY (T2), freshen scan/update/prune (T3), debounce + autoRefresh + refresh tool + status (T4), never-fail (T3 try/catch; missing-root skip), acceptance add/edit/delete (T5). All spec sections map to tasks. ✔
- **Placeholder scan:** none — real code/tests in every step. ✔
- **Type consistency:** `IndexRoot`/`FileStat`, `setRoot/roots/fileStat/setFileStat/pruneFile/allIndexedFiles`, `indexFile(store,embedder,file,text,hash,sig)`, `freshen(store,embedder)→FreshenSummary`, `maybeFreshen(ctx)`, `config.autoRefresh/refreshDebounceMs` are used identically across tasks. `indexFile` sets fileHash+fileStat (so T3 doesn't double-set). ✔
- **Never-fail:** freshen swallows per-file and per-root errors; missing root skipped (no mass prune); embedding failure handled by existing tiered fallback. ✔
