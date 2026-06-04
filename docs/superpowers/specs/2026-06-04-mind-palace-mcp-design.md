# Mind Palace MCP — Design Spec

**Date:** 2026-06-04
**Status:** Draft for review
**Author:** Claude (with John, buildreach.com)

## 1. Purpose & Motivation

Claude Code's built-in retrieval is **lexical**: `Grep`/`Glob` match exact strings and patterns. When the searcher doesn't know the exact identifier a codebase uses ("where's the retry logic?" when the code says `backoffScheduler`), this fails. Likewise, the flat-file `MEMORY.md` has no recall-by-meaning.

**Mind Palace MCP** fills the missing primitive: **semantic (meaning-based) storage and retrieval**, delivered as a local, offline-capable MCP server.

### Relationship to MemPalace (deliberate non-overlap)

[MemPalace](https://github.com/mempalace/mempalace) already owns *conversational long-term memory* (store chats verbatim, knowledge graph, temporal recall). We do **not** rebuild that. Mind Palace targets the orthogonal gap:

| Capability | MemPalace | Mind Palace |
|---|---|---|
| Remember conversations/facts over time | ✅ its purpose | ❌ out of scope |
| Semantic + (optional) hybrid search over **your code & local docs** | ❌ not targeted | ✅ **core** |
| Lightweight durable per-project working notes | partial/heavy | ✅ thin scratchpad |

MemPalace remembers your *chats*; Mind Palace understands your *codebase*.

## 2. Goals & Non-Goals

### Goals
- Index any local folder (code or docs) and search it **by meaning**, returning ranked `file:line` chunks.
- Work **offline with zero required configuration**, and **never hard-fail** — degrade gracefully through embedding backends.
- Provide a thin durable working-notes facility (`remember`/`recall`/`forget`) scoped per project.
- Be a clean, small, well-isolated codebase that is easy to test and extend.

### Non-Goals (YAGNI — explicitly out for MVP)
- No conversational/auto memory capture, knowledge graph, or temporal reasoning (MemPalace's territory).
- No multi-language AST parsing or call graph (that's the "Cartographer" idea — possible Phase 2).
- No file-watcher/auto-reindex daemon (manual `reindex` for MVP).
- No web UI, no remote/multi-user mode.

## 3. Capabilities (MCP Tools)

The server exposes these tools over stdio:

1. **`index_path`** — Index a directory or file.
   - Inputs: `path` (string), `include` (glob[]?, default sensible code/doc globs), `exclude` (glob[]?), `force` (bool?, re-embed even if unchanged).
   - Behavior: walk → filter (ignore rules) → chunk → embed → upsert into store (skip unchanged files via content hash).
   - Returns: `{ filesIndexed, chunksAdded, chunksSkipped, embedder, elapsedMs }`.

2. **`search`** — Semantic search over indexed chunks.
   - Inputs: `query` (string), `k` (int?, default 8), `pathPrefix` (string?, restrict to a subtree), `mode` (`"semantic" | "hybrid"`?, default `"hybrid"`).
   - Returns: ranked `[{ file, startLine, endLine, score, snippet }]`.

3. **`remember`** — Store a durable working note.
   - Inputs: `text` (string), `tags` (string[]?).
   - Returns: `{ id }`.

4. **`recall`** — Semantic search over stored notes.
   - Inputs: `query` (string), `k` (int?, default 5).
   - Returns: ranked `[{ id, text, tags, score }]`.

5. **`forget`** — Delete a note by id.
   - Inputs: `id` (string). Returns `{ deleted: bool }`.

6. **`status`** — Diagnostics.
   - Returns: `{ embedder, embedderDim, degraded, chunkCount, noteCount, fileCount, dataDir }`.

(Stretch, not MVP-blocking: `reindex` to drop & rebuild, `list_sources`.)

## 4. Architecture

Node.js + TypeScript. MCP via `@modelcontextprotocol/sdk`. Input validation via `zod`. Small, single-purpose modules:

```
src/
  server.ts          # MCP stdio wiring + tool registration (thin)
  config.ts          # env + defaults (data dir, forced embedder, model)
  store.ts           # load/save JSON store; CRUD; cosine search
  chunker.ts         # file walk, ignore rules, line-aware chunking, content hashing
  indexer.ts         # orchestrate walk -> chunk -> embed -> upsert
  search.ts          # query -> embed -> cosine (+ lexical) -> ranked, formatted
  embeddings/
    index.ts         # EmbeddingProvider interface
    detect.ts        # tiered auto-detection
    openai.ts        # API provider (OPENAI_API_KEY)
    voyage.ts        # API provider (VOYAGE_API_KEY)
    ollama.ts        # local Ollama provider
    local.ts         # transformers.js (all-MiniLM-L6-v2), no key
    lexical.ts       # deterministic hashing/BM25-ish fallback (always works)
  tools/             # one thin handler per MCP tool
```

**EmbeddingProvider interface:** `{ name: string; dim: number; embed(texts: string[]): Promise<Float32Array[]> }`.

### Embedding backend selection (tiered, never fails)
`detect.ts` chooses the first available, reported by `status`:
1. `MIND_PALACE_EMBEDDER` env forces a specific backend (escape hatch).
2. `OPENAI_API_KEY` / `VOYAGE_API_KEY` present → API provider (best quality).
3. Ollama reachable at `OLLAMA_HOST` (default `http://localhost:11434`) → local model.
4. `transformers.js` local model (`all-MiniLM-L6-v2`, ~25MB, downloaded once) → true semantic, no key. **Default when nothing else is present.**
5. **Lexical fallback** (`lexical.ts`) → deterministic, dependency-free, always available; `status.degraded = true`.

> Implementation note: Tier 4 (local model) is validated during implementation on this machine. If it cannot install/run cleanly on Windows, the tool still functions via Tier 5, and Tiers 2–3 remain available by adding a key or running Ollama. The spec's correctness does not depend on Tier 4 succeeding.

**Dimension mismatch guard:** the store records which embedder/dim produced it. If the active embedder differs, `search`/`recall` warn and `index_path` requires `force` to re-embed, preventing cosine across incompatible vectors.

## 5. Data Model & Storage

- Default data dir: `${MIND_PALACE_DATA_DIR || <cwd>/.mindpalace}`.
- `store.json` (or JSONL for large indexes):
  - `meta`: `{ embedder, dim, version }`
  - `chunks`: `[{ id, file, startLine, endLine, hash, text, vector:number[] }]`
  - `files`: `{ [path]: contentHash }` (for skip-unchanged)
  - `notes`: `[{ id, text, tags, vector:number[], createdAt }]`
- Search = brute-force cosine in JS. Adequate for thousands of chunks (the realistic single-project scale); a note in `status` flags when the index grows large enough to warrant a future ANN index.

## 6. Chunking & Ignore Rules

- Default ignores: `.git`, `node_modules`, `dist`, `build`, `.next`, `coverage`, `.mindpalace`, lockfiles, binaries, images, files > ~1.5MB.
- Default include globs: common code + docs (`*.ts,js,tsx,jsx,py,go,rs,java,rb,php,c,cpp,h,cs,md,mdx,txt,json,yaml,toml`, etc.).
- Line-aware chunking: ~40–60 line windows (~200–400 tokens) with small overlap; never split mid-line. Each chunk keeps `startLine`/`endLine` for clickable `file:line` results.
- Content hashing per file → skip re-embedding unchanged files on re-index.

## 7. Error Handling

- Missing/invalid `path` → structured error, no crash.
- Per-file failures (unreadable, too large, binary) → skip + count, continue.
- Embedding backend error → fall to next tier; surface degraded mode via `status`; never crash the server.
- Empty index on `search` → friendly "nothing indexed yet; run index_path first."
- Writes serialized + debounced; store written atomically (temp file + rename).

## 8. Testing Strategy

TDD throughout. Tests must run with **no network and no model download** by forcing the deterministic `lexical` embedder.

- `chunker` — boundaries, overlap, ignore rules, hashing.
- `store` — CRUD; cosine ranking correctness on known vectors; atomic save/load round-trip; dimension-mismatch guard.
- `lexical` embedder — determinism + that semantically/lexically closer text ranks higher on a fixture.
- `detect` — tier selection under mocked env (keys present/absent, Ollama up/down).
- Integration — index a temp fixture repo, assert `search("retry logic")` returns the chunk containing `backoffScheduler`-style code over unrelated chunks; `remember`/`recall`/`forget` round-trip.

## 9. Configuration & Registration

**Env:** `MIND_PALACE_DATA_DIR`, `OPENAI_API_KEY`/`VOYAGE_API_KEY`, `OLLAMA_HOST`, `MIND_PALACE_EMBEDDER`, `MIND_PALACE_MODEL`.

**Register with Claude Code** as a stdio MCP server (after build):
```
claude mcp add mind-palace -- node F:\Dreams\Dream1\dist\server.js
```
Then restart Claude Code so the `mind-palace` tools load. A companion note/skill will document when to use `search` vs `Grep`.

## 10. Acceptance Criteria (Definition of Done)

1. `npm install && npm run build && npm test` all green on this machine.
2. Server starts over stdio and registers all six tools.
3. `index_path` on a real folder (e.g. this project's own `src/` or `.claude/plugins`) populates the store; `status` reports the active embedder.
4. `search` returns relevant `file:line` results for a natural-language query that plain `Grep` would miss.
5. `remember` → `recall` round-trips by meaning; `forget` removes.
6. With all keys/Ollama/model unavailable, the server still works via the lexical fallback (`status.degraded = true`) — demonstrating "never hard-fails."
7. Registered in Claude Code MCP config and callable as live tools.

## 11. Milestones

1. Scaffold (TS, MCP SDK, zod, test runner, `.gitignore`) + green "hello" test.
2. `lexical` embedder + `store` (cosine, CRUD) — TDD.
3. `chunker` + `indexer` — TDD.
4. `search` (semantic + hybrid) + `remember`/`recall`/`forget` — TDD.
5. `embeddings/detect` + real backends (local model validated; API/Ollama wired) — TDD with mocks.
6. `server.ts` tool wiring + integration test.
7. Register in Claude Code, live demo, write usage note/skill.
