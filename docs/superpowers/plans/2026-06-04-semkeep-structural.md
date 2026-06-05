# semkeep Phase 1 — Structural Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tree-sitter structural layer to semkeep — symbols, imports, AST-aware chunking, four tools (`outline`/`define`/`callers`/`imports`), and a structure-aware search re-rank — extending the existing codebase without rewriting it.

**Architecture:** New `src/structure/` modules parse TS/JS/TSX/JSX via `web-tree-sitter` (WASM) and extract symbols/imports. The indexer chunks on symbol boundaries (falling back to line windows), the store gains symbol/import tables and query methods, search re-ranks definitions above usages, and the server exposes four new tools. Never hard-fails: any parse/grammar problem degrades to today's line-window behavior.

**Tech Stack:** TypeScript ESM, **`web-tree-sitter@0.24.7`** (pinned — default export; `Parser.init({locateFile})`, `Parser.Language.load(bytes)`, `language.query(src)`), **`tree-sitter-wasms@0.1.13`** (pinned — prebuilt `out/tree-sitter-{typescript,tsx,javascript}.wasm`; the 0.25/0.26 runtime line rejects these grammars), vitest.

> **Verified on this machine (spike):** exported decls are wrapped in `export_statement` (descend through it; `exported = parent.type === "export_statement"`); `const` is `lexical_declaration → variable_declarator(name)`; node types: `function_declaration`(name `identifier`), `class_declaration`/`interface_declaration`/`type_alias_declaration`(name `type_identifier`), `enum_declaration`(name `identifier`), `method_definition`(name `property_identifier`), `import_statement`(field `source` = string, names under `import_clause`). Positions are 0-based rows (+1 for 1-based lines).

---

## File Structure

```
src/structure/
  grammars.ts      # ext -> language id; resolve & lazy-load wasm (runtime + grammars) via createRequire
  parser.ts        # init once; getParser(lang); parseFile(path,text) -> Tree | null (null = unparseable)
  queries.ts       # per-language tree-sitter query strings (symbols, imports)
  symbols.ts       # extractSymbols(tree,file,hash) -> Symbol[]; extractImports(tree,file) -> ImportEdge[]
  chunkBySymbol.ts # symbolChunks(file,text,symbols) -> RawChunk[] with symbol tags; fallback to chunkText
src/
  types.ts         # (extend) Symbol, ImportEdge; Chunk.symbolName?/kind?
  store.ts         # (extend) symbols[]/imports[]; replaceFileSymbols; findDefinitions/findReferences/importsOf/importedBy/outline
  indexer.ts       # (extend) parse -> symbols/imports -> store; symbolChunks w/ fallback; tag chunks
  search.ts        # (extend) definition boost in hybrid re-rank
  tools.ts         # (extend) outlineTool/defineTool/callersTool/importsTool; status structural fields
  server.ts        # (extend) register 4 tools
test/
  structure-parser.test.ts
  structure-symbols.test.ts
  structure-chunk.test.ts
  structure-store.test.ts
  structure-search.test.ts
  structure-tools.test.ts
```

## Shared Types (added to `src/types.ts`)

```typescript
export type SymbolKind =
  | "function" | "class" | "method" | "interface" | "type" | "enum" | "const" | "variable";

export interface Symbol {
  id: string;        // `${fileHash.slice(0,12)}:${startLine}:${name}`
  file: string;
  name: string;
  kind: SymbolKind;
  startLine: number; endLine: number; // 1-based inclusive
  exported: boolean;
  container?: string; // enclosing symbol name (e.g. class of a method)
  signature?: string; // first source line, trimmed, for display
}

export interface ImportEdge {
  file: string;     // importing file (absolute)
  source: string;   // module specifier, e.g. "./bar.js" or "zod"
  names: string[];  // imported names, or ["*"] / ["default"]
}
```
Also add to `Chunk`: `symbolName?: string;` and `kind?: SymbolKind;`. Add to `StoreData`: `symbols: Symbol[];` and `imports: ImportEdge[];`. Bump `meta.structureVersion?: number`.

---

### Task 0: Pin deps

**Files:** Modify `package.json`

- [ ] **Step 1:** Set exact versions (ABI-sensitive pair) — `"web-tree-sitter": "0.24.7"` and `"tree-sitter-wasms": "0.1.13"` in `dependencies` (they install cleanly, no native build; code degrades gracefully if absent).
- [ ] **Step 2:** `npm install` then `npm test`. Expected: existing 31 tests still pass.
- [ ] **Step 3: Commit** `chore: pin web-tree-sitter 0.24.7 + tree-sitter-wasms 0.1.13`

---

### Task 1: Parser + grammar loading (with fallback)

**Files:** Create `src/structure/grammars.ts`, `src/structure/parser.ts`, `test/structure-parser.test.ts`

`grammars.ts`: map extension → grammar id (`ts→typescript`, `tsx→tsx`, `js/jsx/mjs/cjs→javascript`); `langIdFor(path): string | null`. `parser.ts`: `parseFile(path, text): Promise<{tree, lang} | null>` — `Parser.init({locateFile: () => requireResolve("web-tree-sitter/tree-sitter.wasm")})` once (memoized); load grammar via `Parser.Language.load(readFileSync(requireResolve("tree-sitter-wasms/out/tree-sitter-<id>.wasm")))` (cached per id); return `null` for unknown ext or any error (never throw). Use `createRequire(import.meta.url)` for `requireResolve`.

- [ ] **Step 1: Write failing test** `test/structure-parser.test.ts`

```typescript
import { test, expect } from "vitest";
import { parseFile } from "../src/structure/parser.js";
import { langIdFor } from "../src/structure/grammars.js";

test("langIdFor maps extensions", () => {
  expect(langIdFor("a.ts")).toBe("typescript");
  expect(langIdFor("a.tsx")).toBe("tsx");
  expect(langIdFor("a.js")).toBe("javascript");
  expect(langIdFor("a.md")).toBeNull();
});

test("parseFile returns a tree for TS, null for non-code", async () => {
  const ok = await parseFile("x.ts", "export function f(){ return 1 }");
  expect(ok).not.toBeNull();
  expect(ok!.tree.rootNode.namedChildren.length).toBeGreaterThan(0);
  expect(await parseFile("x.md", "# hi")).toBeNull();
});
```

- [ ] **Step 2:** Run `npx vitest run test/structure-parser.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement `grammars.ts` + `parser.ts` per the description (memoized init, per-lang grammar cache, try/catch → null).
- [ ] **Step 4:** Run → PASS. (First run loads wasm; allow a few seconds.)
- [ ] **Step 5: Commit** `feat(structure): web-tree-sitter parser with grammar loading + fallback`

---

### Task 2: Symbol & import extraction

**Files:** Create `src/structure/queries.ts`, `src/structure/symbols.ts`, `test/structure-symbols.test.ts`

Walk `tree.rootNode.namedChildren`. For each node: if `export_statement`, descend to its declaration child and mark `exported=true`. Map node type → `SymbolKind` (`function_declaration→function`, `class_declaration→class`, `interface_declaration→interface`, `type_alias_declaration→type`, `enum_declaration→enum`, `lexical_declaration→const` via each `variable_declarator`'s name). For `class_declaration`, also walk its `class_body` for `method_definition` → `method` with `container=<class name>`. Name via `node.childForFieldName("name")?.text` (or the declarator/property name). Lines = `startPosition.row+1 .. endPosition.row+1`. `signature` = first source line trimmed. `extractImports`: for each `import_statement`, `source = childForFieldName("source").text` stripped of quotes; `names` from the `import_clause` identifiers (`["*"]`/`["default"]` as applicable).

- [ ] **Step 1: Write failing test** `test/structure-symbols.test.ts`

```typescript
import { test, expect } from "vitest";
import { parseFile } from "../src/structure/parser.js";
import { extractSymbols, extractImports } from "../src/structure/symbols.js";

const SRC = `import { foo } from "./bar.js";
export function alpha(x){ return x; }
class Beta { gamma(){ return 1; } }
export const eps = 42;
interface Delta { id: string }
`;

test("extracts symbols with kinds, lines, exported, container", async () => {
  const { tree } = (await parseFile("m.ts", SRC))!;
  const syms = extractSymbols(tree, "/m.ts", "deadbeefcafe");
  const by = (n: string) => syms.find((s) => s.name === n)!;
  expect(by("alpha").kind).toBe("function");
  expect(by("alpha").exported).toBe(true);
  expect(by("Beta").kind).toBe("class");
  expect(by("gamma").kind).toBe("method");
  expect(by("gamma").container).toBe("Beta");
  expect(by("eps").kind).toBe("const");
  expect(by("Delta").kind).toBe("interface");
  expect(by("alpha").startLine).toBe(2);
});

test("extracts import edges", async () => {
  const { tree } = (await parseFile("m.ts", SRC))!;
  const imps = extractImports(tree, "/m.ts");
  expect(imps[0].source).toBe("./bar.js");
  expect(imps[0].names).toContain("foo");
});
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `symbols.ts` (+ any shared query strings in `queries.ts`).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(structure): symbol & import extraction (handles export_statement/const)`

---

### Task 3: AST-aware chunking

**Files:** Create `src/structure/chunkBySymbol.ts`, `test/structure-chunk.test.ts`

`symbolChunks(text, symbols, opts?)`: produce one `RawChunk` (`{startLine,endLine,text,symbolName?,kind?}`) per top-level symbol (skip methods — covered by their class), aligned to symbol line ranges; symbols longer than `maxLines` (default 60) are split into line-windows within the range; lines not covered by any symbol (prologue/imports/loose code) become fallback line-window chunks. If `symbols` is empty → return `chunkText(text)` (existing line chunker) unchanged.

- [ ] **Step 1: Write failing test** `test/structure-chunk.test.ts`

```typescript
import { test, expect } from "vitest";
import { parseFile } from "../src/structure/parser.js";
import { extractSymbols } from "../src/structure/symbols.js";
import { symbolChunks } from "../src/structure/chunkBySymbol.js";
import { chunkText } from "../src/chunker.js";

test("one chunk per top-level symbol, tagged", async () => {
  const src = "export function a(){ return 1 }\nexport function b(){ return 2 }\n";
  const { tree } = (await parseFile("m.ts", src))!;
  const chunks = symbolChunks(src, extractSymbols(tree, "/m.ts", "h"));
  const names = chunks.map((c) => c.symbolName).filter(Boolean).sort();
  expect(names).toEqual(["a", "b"]);
  expect(chunks.find((c) => c.symbolName === "a")!.kind).toBe("function");
});

test("falls back to line windows when no symbols", () => {
  const text = Array.from({ length: 120 }, (_, i) => `L${i + 1}`).join("\n");
  expect(symbolChunks(text, [])).toEqual(chunkText(text));
});
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `symbolChunks` (reuse `chunkText` for splits/fallback).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(structure): symbol-aligned chunking with line-window fallback`

---

### Task 4: Store schema + structural queries

**Files:** Modify `src/types.ts`, `src/store.ts`; Create `test/structure-store.test.ts`

Add `symbols`/`imports` to `StoreData` (default `[]` on load). Methods:
- `replaceFileSymbols(file, symbols: Symbol[], imports: ImportEdge[])` — drop existing for `file`, add new.
- `findDefinitions(name, pathPrefix?): Symbol[]`.
- `findReferences(name, pathPrefix?): Array<{file,startLine,endLine}>` — **heuristic**: symbols whose definition is excluded; for v1 reference sites come from chunk text scans is overkill, so v1 `findReferences` returns symbols+import-edges that mention `name`: files that import a module exporting `name` OR symbols whose `container`/file references it. (Keep simple: return import edges whose `names` include `name`, plus definitions in other files — ranked import-first.) Document as approximate.
- `importsOf(file): ImportEdge[]` and `importedBy(file): ImportEdge[]` (match `source` resolved by suffix).
- `outline(file): Symbol[]` sorted by startLine.

- [ ] **Step 1: Write failing test** `test/structure-store.test.ts`

```typescript
import { test, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";

test("symbols/imports persist and query", async () => {
  const s = await Store.load(mkdtempSync(join(tmpdir(), "mp-st-")));
  s.setEmbedderMeta("lexical", 3);
  s.replaceFileSymbols(
    "/r/a.ts",
    [{ id: "1", file: "/r/a.ts", name: "alpha", kind: "function", startLine: 2, endLine: 4, exported: true }],
    [{ file: "/r/a.ts", source: "./b.js", names: ["foo"] }],
  );
  expect(s.findDefinitions("alpha")[0].file).toBe("/r/a.ts");
  expect(s.outline("/r/a.ts").map((x) => x.name)).toEqual(["alpha"]);
  expect(s.importsOf("/r/a.ts")[0].source).toBe("./b.js");
  await s.save();
  const s2 = await Store.load((s as any).dataDir ?? "");
});
```
(Adjust the reload line to your `Store.load` dir handle; the assertion that matters is the query methods.)

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement type + store changes.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(store): symbol/import tables + define/outline/imports/references queries`

---

### Task 5: Indexer integration

**Files:** Modify `src/indexer.ts`; extend `test/indexer.test.ts`

In `indexPath`, per file: after reading text + hashing, `const parsed = await parseFile(file, text)`. If parsed: `symbols = extractSymbols(...)`, `imports = extractImports(...)`, `store.replaceFileSymbols(file, symbols, imports)`, `raw = symbolChunks(text, symbols)`. Else: `store.replaceFileSymbols(file, [], [])` and `raw = chunkText(text)`. Then embed + store chunks as today, carrying `symbolName`/`kind` from each `RawChunk`. Add `symbolsAdded` to `IndexResult`.

- [ ] **Step 1: Write failing test** (append to `test/indexer.test.ts`): index a temp `.ts` file with two exported functions; assert `store.findDefinitions("retryWithBackoff")` returns it and chunks carry `symbolName`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement integration.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(indexer): parse + index symbols/imports with symbol-aligned chunks`

---

### Task 6: Structure-aware search re-rank

**Files:** Modify `src/search.ts`; Create `test/structure-search.test.ts`

In hybrid mode, after the keyword boost, add a definition boost: if a candidate chunk has a `kind` in the definition set (`function|class|method|interface|type|enum`) and its `symbolName` token is in the query tokens, add `DEFINITION_WEIGHT` (≈0.25). Requires `searchChunkCandidates` to surface `symbolName`/`kind` (already on the chunk — include them in `ScoredChunk`).

- [ ] **Step 1: Write failing test** — seed two chunks for query "alpha": chunk D (vector slightly lower, `kind:"function"`, `symbolName:"alpha"`, text "function alpha") and chunk U (vector higher, no kind, text "call alpha here"); assert hybrid search ranks D first (definition boost overtakes).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the boost (extend `ScoredChunk` with `symbolName?`/`kind?`; thread through `rankChunks`).
- [ ] **Step 4:** Run → PASS. Then `npx vitest run` → all green.
- [ ] **Step 5: Commit** `feat(search): definition-aware re-rank to fight false leads`

---

### Task 7: Tools + server wiring

**Files:** Modify `src/tools.ts`, `src/server.ts`; Create `test/structure-tools.test.ts`

Add handlers (take `Context`, return text): `outlineTool({path})`, `defineTool({name,pathPrefix?})`, `callersTool({name,pathPrefix?})`, `importsTool({path,direction?})`. Register the four tools in `server.ts` with zod schemas. Extend `statusTool` with `structural: boolean`, `symbolCount`, `importCount`. Format outputs as readable `file:line — kind name` lines.

- [ ] **Step 1: Write failing test** `test/structure-tools.test.ts` — build a Context, index a temp repo, assert `defineTool` returns the symbol's `file:line` and `outlineTool` lists it. (Module-level, like `integration.test.ts`.)
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement handlers + registration.
- [ ] **Step 4:** Run → PASS; `npm run build` clean.
- [ ] **Step 5: Commit** `feat: outline/define/callers/imports MCP tools + structural status`

---

### Task 8: Acceptance & cleanup

**Files:** delete `scripts/spike-treesitter.mjs`; extend `scripts/smoke-stdio.mjs`

- [ ] **Step 1:** Extend the stdio smoke to call `define`/`outline`/`callers`/`imports` and print results; confirm 10 tools register.
- [ ] **Step 2:** Structural-win demo: stage the MCP-SDK corpus, index it, run `callers("validateToolInput")` and `define("validateToolInput")`; confirm the real site is returned (grep + plain-semantic both flailed here).
- [ ] **Step 3:** Re-run `scripts/eval-vs-grep.mjs` + the judge; confirm AST chunking + definition re-rank **hold or improve** the 4-win baseline.
- [ ] **Step 4:** Delete the spike; `npm test` green; **Commit** `test: structural acceptance (callers demo + benchmark) and cleanup`

---

## Self-Review

- **Spec coverage:** parser/grammars (T1), symbols+imports (T2), AST chunking (T3), store schema+queries (T4), indexer integration (T5), search re-rank (T6), 4 tools + status (T7), never-fail fallback (T1/T3/T5 — `null`→line chunks), acceptance incl. callers demo + benchmark (T8). All spec sections map to tasks. ✔
- **Placeholder scan:** none — real code in test steps; the `findReferences` heuristic is explicitly specified (not "TODO"). The store-test reload line is flagged for the executor to bind to the real dir handle. ✔
- **Type consistency:** `Symbol`/`ImportEdge`/`SymbolKind`, `symbolChunks`, `extractSymbols(tree,file,hash)`, `parseFile(path,text)→{tree,lang}|null`, `replaceFileSymbols`/`findDefinitions`/`findReferences`/`importsOf`/`importedBy`/`outline`, and `ScoredChunk.symbolName/kind` are used identically across tasks. ✔
- **Verified-fact grounding:** versions pinned and API/node-types confirmed by the spike (export_statement wrapping, const declarators, query API), so the queries in T2 are not speculative. ✔
