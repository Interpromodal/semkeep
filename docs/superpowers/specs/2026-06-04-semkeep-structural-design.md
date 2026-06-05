# semkeep Phase 1 — Structural Intelligence (Cartographer) — Design Spec

**Date:** 2026-06-04
**Status:** Draft for review
**Author:** Claude (with John)
**Builds on:** the shipped semkeep MCP (semantic search over code/docs + notes). This **extends** that codebase; it does not rewrite it.

## 1. Purpose & Motivation

The vs-grep evaluation showed semkeep's semantic search is a real but narrow win, with three weaknesses that share one root cause — **semkeep understands *meaning* but not *structure*:**
1. **Confident false leads** — "timeout"/"cancel" pointed at usage-dense task-queue code, missing the real implementations. Semantic similarity ≠ actual code relationship.
2. **No structural questions** — it cannot answer "who calls `validateToolInput`?" or "what does this file export?"
3. **Precision loss from naive chunking** — fixed 50-line windows let large keyword-dense blocks float above the exact implementation.

Phase 1 adds a **structural layer** (originally brainstormed as "Project Cartographer") on top of the semantic layer, turning semkeep from "find by meaning" into "know your codebase — by meaning **and** structure." It both adds new capabilities and **repairs** semantic search.

## 2. Goals & Non-Goals

### Goals
- Parse TS/JS/TSX/JSX into real ASTs (tree-sitter via WASM — no native build) and extract symbols + import edges.
- Ship four structural tools: `outline`, `define`, `callers`, `imports`.
- Replace fixed-window chunking with **AST-aware chunking** (symbol-boundary chunks; fallback for non-code).
- Make `search` **structure-aware** (definition-bearing chunks re-ranked above usage-only blocks).
- Preserve semkeep's invariants: offline, zero-config, **never hard-fail** (degrade to today's behavior if parsing is unavailable).

### Non-Goals (v1)
- No type-aware name resolution / true call graph — `callers` is an identifier-aware heuristic, ranked by import-link.
- TS/JS/TSX/JSX only (grammar loading is pluggable so Python/Go/etc. are a small add later).
- No LSP / language-server processes.
- Auto-reindex & scale = Phase 2. Notes-linked-to-symbols = Phase 3.

## 3. Capabilities (new MCP tools)

1. **`outline`** — Inputs: `path` (file or dir). Returns the symbol tree (containers → members) with kinds and line ranges. "Show me the shape of this file."
2. **`define`** — Inputs: `name`, `pathPrefix?`. Returns definition site(s): `file:line`, kind, and a signature snippet.
3. **`callers`** — Inputs: `name`, `pathPrefix?`. Returns reference/usage sites. **v1 heuristic:** identifier nodes matching `name` (tree-sitter excludes strings/comments), ranked higher when the containing file imports the symbol's module. Clearly labeled approximate.
4. **`imports`** — Inputs: `path`, `direction?` (`"out"` = what this file imports, `"in"` = who imports this file, default both). Returns edges with module specifiers + imported names.

`search` is **updated** (not a new tool): each hit carries its owning symbol (name+kind) when it falls inside one, and ranking gives a modest boost to definition chunks.

## 4. Architecture

New modules under `src/structure/`, plus targeted extensions to existing files:

```
src/structure/
  grammars.ts        # extension -> language; locate & lazy-load prebuilt .wasm grammars
  parser.ts          # web-tree-sitter init (once) + parseFile(path,text) -> Tree | null
  queries.ts         # per-language tree-sitter (.scm) queries for symbols & imports
  symbols.ts         # extractSymbols(tree,file,text) -> Symbol[]; extractImports(...) -> ImportEdge[]
  chunkBySymbol.ts   # symbol-aligned chunks, with fallback to the line-window chunker
src/
  indexer.ts         # (extend) parse -> symbols/imports -> store; chunk by symbol w/ fallback
  store.ts           # (extend) symbols[]/imports[]; define/callers/imports/outline queries; chunk.symbol fields
  search.ts          # (extend) structure-aware re-rank (definition boost)
  tools.ts           # (extend) outline/define/callers/imports handlers
  server.ts          # (extend) register the 4 new tools; status reports structural availability
```

Each module has one responsibility and a narrow interface; `parser` knows nothing about the store, `store` knows nothing about tree-sitter.

## 5. Data Model (additive, backward-compatible)

```typescript
interface Symbol {
  id: string;        // `${fileHash.slice(0,12)}:${startLine}:${name}`
  file: string;      // absolute path
  name: string;
  kind: "function" | "class" | "method" | "interface" | "type" | "enum" | "const" | "variable";
  startLine: number; endLine: number; // 1-based inclusive
  exported: boolean;
  container?: string; // enclosing symbol (e.g. the class of a method)
  signature?: string; // first line / declarator text, for display
}

interface ImportEdge {
  file: string;        // the importing file (absolute)
  source: string;      // module specifier, e.g. "./store.js" or "zod"
  names: string[];     // imported names, or ["*"] / ["default"]
  resolved?: string;   // resolved absolute path when local & resolvable
}
```
`StoreData` gains `symbols: Symbol[]` and `imports: ImportEdge[]`. `Chunk` gains optional `symbolName?: string` and `kind?: Symbol["kind"]`. A `structureVersion` in `meta` lets a future bump trigger a reindex; older stores simply lack symbols until re-indexed.

## 6. Parsing & Chunking

- **Grammars:** prebuilt `.wasm` for typescript/tsx/javascript/jsx, sourced from a prebuilt-grammar package (e.g. `tree-sitter-wasms`) — verified at implementation time — and lazy-loaded on first parse, cached per language. `web-tree-sitter` is the runtime (pure WASM; cross-platform).
- **Symbol extraction:** tree-sitter queries capture declaration nodes (`function_declaration`, `class_declaration`, `method_definition`, `interface_declaration`, `type_alias_declaration`, `enum_declaration`, exported `lexical_declaration`) and `import_statement`/`import` nodes. Exact node names verified against the loaded grammar at impl time.
- **AST-aware chunking:** one chunk per top-level symbol (its line range). Symbols larger than ~60 lines are split into line-windows *within* the symbol; a file's prologue/imports become a leading chunk; tiny adjacent siblings may merge. Files with no grammar or that fail to parse fall back to the existing `chunkText` line-window chunker. Chunks record `symbolName`/`kind` when aligned to a symbol.

## 7. Structure-Aware Search Re-rank

In hybrid mode, after semantic + keyword scoring, add a small **definition boost**: a chunk whose `kind` is a definition (function/class/method/interface/type/enum) and whose symbol name appears in the query tokens (or whose symbol is a strong match) is boosted over usage-only chunks. Weight kept conservative and additive (same spirit as the keyword boost) to avoid over-tuning. Acceptance is measured, not assumed (Section 10).

## 8. Error Handling (never hard-fail)

- Missing/oversized grammar or `web-tree-sitter` init failure → structural features disabled; indexing falls back to line-window chunks; semantic search unaffected.
- Per-file parse failure → that file gets line-window chunks and no symbols; logged to stderr; indexing continues.
- Structural tool called with no symbols indexed → friendly message ("no structure indexed yet; run index_path").
- `status` reports `{ structural: boolean, grammarsLoaded: string[], symbolCount, importCount }`.

## 9. Testing Strategy (TDD, offline)

Grammars ship with the package, so structural tests run offline (no network). The embedding-dependent tests still force the lexical embedder.

- `symbols` — extraction on TS/JS fixtures: top-level function, class with methods (container set), interface, exported const, default+named imports → assert names/kinds/lines/exported and import edges.
- `chunkBySymbol` — 3-function file → 3 symbol-aligned chunks with correct ranges; oversized symbol splits; unparseable/non-code file → line-window fallback.
- `store` — `findDefinitions(name)`, `findReferences(name)` (heuristic + import-rank), `importsOf`/`importedBy`, `outline(file)` on seeded data.
- `tools` — `outline`/`define`/`callers`/`imports` handlers return expected formatted output (module-level, like existing integration tests).
- `search` re-rank — deterministic test (lexical embedder + seeded symbols): a definition chunk outranks a usage-only chunk for the same name.
- never-fail — a file that fails to parse is still indexed via fallback; structural tools on an empty index return friendly messages.

## 10. Acceptance Criteria (Definition of Done)

1. `npm install && npm run build && npm test` green on this machine, including new structural tests.
2. `web-tree-sitter` + TS/JS grammars load and parse on this Windows box (de-risked as the first implementation step).
3. The 4 new tools work end-to-end over stdio (extend `scripts/smoke-stdio.mjs`).
4. **Structural win demonstrated:** `callers("validateToolInput")` on the MCP-SDK corpus returns the real call site(s) — a question both grep ("handler"/1039-hit "schema") and plain semantic flailed on.
5. **No semantic regression:** re-run `scripts/eval-vs-grep.mjs` + the independent judge; structure-aware re-rank + AST chunking must not lower the head-to-head (target: hold or improve the 4-win baseline, ideally recover a false-lead query).
6. Never-fail proven: with grammars forcibly unavailable, indexing + semantic search still work (structural tools report disabled).

## 11. Milestones

1. De-risk: `web-tree-sitter` init + parse a TS snippet on this machine; confirm grammar `.wasm` source. (Gate before building further.)
2. `parser` + `grammars` (lazy load, fallback) — TDD.
3. `symbols` (+ `queries`) extraction — TDD.
4. `chunkBySymbol` + `indexer` integration (with fallback) — TDD.
5. `store` symbol/import schema + query methods — TDD.
6. `search` structure-aware re-rank — TDD.
7. `tools` + `server` wiring for the 4 tools; stdio smoke.
8. Acceptance: structural-win demo + re-run vs-grep benchmark/judge; `status` reporting.
