# semkeep Phase 2 — Freshness — Design Spec

**Date:** 2026-06-04
**Status:** Draft for review
**Author:** Claude (with John)
**Builds on:** the shipped semkeep (Phase 1 structural + Phase 1.5 quality). Extends the codebase; does not rewrite it.

## 1. Purpose & Motivation

semkeep's index goes stale: after you edit, add, or delete files, `search` and the structural tools still reflect the *last* `index_path`. We hit this twice live — needing a manual (force) re-index. Phase 2 makes the index reflect reality **automatically**, via **lazy freshen-on-query**: a fast change-detection pass runs at the start of each code/structure query and incrementally updates the index before answering.

## 2. Goals & Non-Goals

### Goals
- Auto-reflect **edits**, **new files**, and **deletions** without a manual re-index.
- Cheap when nothing changed (stat-based fast path + debounce).
- Persist the **indexed roots** so the long-lived server knows what to keep fresh.
- Preserve semkeep invariants: offline, local, **never hard-fail** (freshen errors degrade to stale-but-working).

### Non-Goals (deferred — YAGNI)
- No file watcher (chokidar/`fs.watch`).
- No ANN index — brute-force cosine is fine at single-project scale (1,694-chunk benchmark was instant). A `status` note flags huge-monorepo scale as future work.
- No content-addressed embedding cache.
- Notes (`recall`) are not file-derived, so they never freshen.

## 3. Mechanism (lazy freshen-on-query)

Before each of `search`, `define`, `callers`, `outline`, `imports`, run `freshen` (when `autoRefresh` is on and not debounced):

For each persisted root (skip if the root path no longer exists on disk — don't mass-prune a temporarily-missing drive):
1. Walk the root with its stored include/exclude → the current file set.
2. **New / changed:** for each current file, `stat` it; if `(mtime, size)` matches the stored signature → skip (fast path). Otherwise re-hash; only if the **content hash** changed → re-index that file (re-extract symbols/imports/references, re-chunk, re-embed). Update the stat signature regardless.
3. **Deleted:** any file the store has under this root that isn't in the current walk → **prune** all its records.

A short in-process **debounce** (skip if freshened < ~1.5s ago) amortizes rapid successive queries. `SEMKEEP_AUTO_REFRESH=0` disables it (manual `index_path`/`refresh` only).

## 4. Architecture (modules)

```
src/
  freshen.ts   # freshen(store, embedder, opts) -> summary; scan/update/prune; never throws
  indexer.ts   # (extend) extract reusable indexFile(...); index_path records roots + stat sigs
  store.ts     # (extend) roots[]; parallel fileStats map; pruneFile; root/stat accessors
  tools.ts     # (extend) auto-freshen at top of the 5 code/structure tools; `refresh` tool; status
  config.ts    # (extend) autoRefresh (default true), refreshDebounceMs
  server.ts    # (extend) register `refresh`
```

- `indexFile(store, embedder, file, text, hash)` — the per-file pipeline (parse → symbols/imports/references → symbolChunks → embed → store chunks + setFileHash + setFileStat). Both `indexPath` and `freshen` call it (DRY).
- `freshen(store, embedder)` — orchestrates §3; returns `{ scanned, reindexed, added, pruned, elapsedMs }`.
- Tools call a small `maybeFreshen(ctx)` helper that respects `autoRefresh` + debounce and saves after.

## 5. Data Model (additive, backward-compatible)

- `StoreData.roots: Array<{ path: string; include?: string[]; exclude?: string[] }>` — absolute root paths + their index options.
- `StoreData.fileStats: Record<string, { mtime: number; size: number }>` — **parallel** to the existing `files` (hash) map, so the hash/skip-unchanged logic is untouched. Missing stat → treated as changed (forces a re-hash, self-heals old stores).
- `Store.load` initializes both to defaults; `rebuildForEmbedder` clears them too.

New `Store` methods: `setRoot(path, opts)`, `roots()`, `fileStat(path)`, `setFileStat(path, sig)`, `pruneFile(file)` (removes the file's chunks/symbols/imports/references + `files`/`fileStats` entries), `allIndexedFiles()`.

## 6. Error Handling (never hard-fail)

- `freshen` wraps the whole pass and each file in try/catch — a bad file is skipped; the query still answers (possibly slightly stale).
- A root whose path no longer exists is skipped entirely (no pruning) — guards against a temporarily-unavailable drive wiping the index.
- Embedding failure during a re-index falls through per semkeep's existing tiered/lexical fallback.
- Debounce + auto-refresh state live in-process (not persisted); a fresh server process re-scans on first query.

## 7. Testing (TDD, offline, lexical embedder)

- `freshen` indexes a **new** file appearing under a root.
- `freshen` re-indexes a **changed** file (new symbol/chunk visible afterward).
- `freshen` **prunes** a deleted file (its chunks + symbols gone).
- `freshen` is a **no-op** when nothing changed (stat fast-path → no re-embed; assert via an embed-count spy or unchanged chunk set).
- `pruneFile` removes every record type and both map entries.
- `roots` and `fileStats` **persist** across save/load.
- End-to-end tool test: index a temp repo → delete a file → call `search` (through the tool, auto-freshen on) → the deleted file no longer appears.

## 8. Acceptance Criteria

1. `npm run build && npm test` green, including new freshness tests.
2. Demo (script, since live MCP needs a restart): index a temp repo, then add / edit / delete files and query **without** a manual re-index — results reflect every change.
3. Deletions are pruned (no stale `file:line` pointing at removed files).
4. Unchanged-repo queries pay near-zero overhead (stat-only fast path; debounce).
5. `SEMKEEP_AUTO_REFRESH=0` disables auto-freshen; `refresh` tool still works manually.

## 9. Milestones

1. `store.ts`: `roots`, `fileStats`, `pruneFile`, accessors (+ load/rebuild init) — TDD.
2. `indexer.ts`: extract `indexFile`; record roots + stat sigs in `index_path` — TDD.
3. `freshen.ts`: scan/update/prune + debounce — TDD.
4. `tools.ts` + `server.ts`: `maybeFreshen` in the 5 tools, `refresh` tool, `status` roots/autoRefresh — TDD.
5. Acceptance: end-to-end freshness demo (add/edit/delete) + full suite green.
