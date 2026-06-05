# semkeep Phase 3 — Notes ↔ Symbols Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a note anchor to a symbol (and/or file) so it surfaces in `define`/`outline`, while staying semantically recallable and durable.

**Architecture:** Add an optional name-based `anchor` to `Note`; `addNote` carries it (and re-anchors on dedup); `notesForSymbol`/`notesForFile` power surfacing in the structural tools. No new dependencies; unanchored behavior is unchanged.

**Tech Stack:** TypeScript ESM, existing store/tools/server, vitest (lexical embedder, offline).

---

## File Structure

```
src/types.ts   # NoteAnchor; Note.anchor?
src/store.ts   # addNote(anchor) + re-anchor; notesForSymbol; notesForFile; searchNotes returns anchor
src/tools.ts   # rememberTool symbol/file; defineTool/outlineTool surface notes; recallTool shows anchor
src/server.ts  # remember schema: optional symbol, file
test/notes-anchor.test.ts  # NEW
```

## Shared Types (add to `src/types.ts`)

```typescript
export interface NoteAnchor {
  symbol?: string; // a symbol name (not line-based)
  file?: string; // absolute path scope (optional)
}
```
Add to `Note`: `anchor?: NoteAnchor;`.

---

### Task 1: Store — anchor on notes + queries

**Files:** Modify `src/types.ts`, `src/store.ts`; Create `test/notes-anchor.test.ts`

`addNote` signature becomes `addNote(text, tags, vector, anchor?, dedupThreshold = DEFAULT_DEDUP_THRESHOLD)` (anchor is the new 4th param — no current caller passes a 4th positional). On a new note, include `anchor`. On a dedup hit, if `anchor` was supplied, set the existing note's `anchor = anchor` (re-anchor) before returning. Add:
```typescript
notesForSymbol(name: string): Note[] {
  return this.data.notes.filter((n) => n.anchor?.symbol === name);
}
notesForFile(file: string, symbolNames: string[]): Note[] {
  return this.data.notes.filter(
    (n) => n.anchor?.file === file || (n.anchor?.symbol !== undefined && symbolNames.includes(n.anchor.symbol)),
  );
}
```
And `searchNotes` returns each note's `anchor` in its result objects (add `anchor: n.anchor`).

- [ ] **Step 1: Write failing test** `test/notes-anchor.test.ts`

```typescript
import { test, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";

test("notes anchor to a symbol/file and are queryable", async () => {
  const s = await Store.load(mkdtempSync(join(tmpdir(), "mp-na-")));
  s.setEmbedderMeta("lexical", 3);
  s.addNote("retry path drops events", ["bug"], [1, 0, 0], { symbol: "backoffScheduler", file: "/r/net.ts" });
  expect(s.notesForSymbol("backoffScheduler")[0].text).toContain("retry path");
  expect(s.notesForFile("/r/net.ts", [])[0].text).toContain("retry path"); // by file
  expect(s.notesForFile("/other.ts", ["backoffScheduler"])[0].text).toContain("retry path"); // by symbol-in-file
  expect(s.notesForSymbol("nope")).toHaveLength(0);
});

test("re-remembering the same text with a new anchor re-anchors (no duplicate)", async () => {
  const s = await Store.load(mkdtempSync(join(tmpdir(), "mp-na2-")));
  s.setEmbedderMeta("lexical", 3);
  const r1 = s.addNote("flaky under load", [], [1, 0, 0], { symbol: "alpha" });
  const r2 = s.addNote("flaky under load", [], [1, 0, 0], { symbol: "beta" });
  expect(r2.deduped).toBe(true);
  expect(r2.id).toBe(r1.id);
  expect(s.notesForSymbol("beta")).toHaveLength(1); // re-anchored
  expect(s.notesForSymbol("alpha")).toHaveLength(0);
  expect(s.stats().noteCount).toBe(1);
});

test("searchNotes returns the anchor", async () => {
  const s = await Store.load(mkdtempSync(join(tmpdir(), "mp-na3-")));
  s.setEmbedderMeta("lexical", 3);
  s.addNote("auth uses JWT", [], [1, 0, 0], { symbol: "login" });
  expect(s.searchNotes([1, 0, 0], 1)[0].anchor?.symbol).toBe("login");
});
```

- [ ] **Step 2:** `npx vitest run test/notes-anchor.test.ts` → FAIL.
- [ ] **Step 3:** Implement type + store changes.
- [ ] **Step 4:** Run → PASS; `npx vitest run` (all) green (existing note/dedup tests unaffected).
- [ ] **Step 5: Commit** `feat(store): name-based note anchors + notesForSymbol/notesForFile`

---

### Task 2: Tools — write the anchor, surface notes

**Files:** Modify `src/tools.ts`; extend `test/structure-tools.test.ts`

- `rememberTool(ctx, { text, tags?, symbol?, file? })`: build `anchor = (symbol || file) ? { symbol, file: file ? resolve(file) : undefined } : undefined`; `addNote(text, tags ?? [], Array.from(v), anchor)`; include the anchor in the reply (`anchored to @symbol …`).
- `defineTool`: compute `const notes = ctx.store.notesForSymbol(args.name)`; build `noteBlock = notes.length ? "\n\nNotes:\n" + notes.map((n) => \`  • ${n.text}${n.tags.length ? \` [${n.tags.join(", ")}]\` : ""} (${n.id})\`).join("\n") : ""`. Return `defsString + noteBlock` (and `\`No definition found for "${args.name}".\` + noteBlock` when there are no defs).
- `outlineTool`: after computing `syms`, `const names = syms.map((s) => s.name); const notes = ctx.store.notesForFile(file, names);` append the same `Notes:` block; if no syms and no notes, return the existing "No symbols" message.
- `recallTool`: include each hit's anchor in the line (`↳ @${h.anchor.symbol}` or `↳ ${h.anchor.file}` when present).

- [ ] **Step 1: Write failing test** (append to `test/structure-tools.test.ts`)

```typescript
test("a note anchored to a symbol surfaces in define and outline", async () => {
  const c = await makeCtx();
  const repo = mkdtempSync(join(tmpdir(), "mp-na-repo-"));
  writeFileSync(join(repo, "net.ts"), "export function backoffScheduler(){ return 1 }\n");
  await indexPathTool(c, { path: repo });
  await rememberTool(c, { text: "retry path drops events under load", symbol: "backoffScheduler" });

  const def = await defineTool(c, { name: "backoffScheduler" });
  expect(def).toContain("retry path drops events");

  const out = await outlineTool(c, { path: join(repo, "net.ts") });
  expect(out).toContain("retry path drops events"); // surfaced via symbol-in-file

  // unrelated symbol: no note noise
  const other = await defineTool(c, { name: "nonexistent" });
  expect(other).not.toContain("retry path");
});
```
(`makeCtx`, `indexPathTool`, `rememberTool`, `defineTool`, `outlineTool` are already imported/used in this file from Phase 2.)

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the tool changes. (`rememberTool` already imports `resolve` via tools.ts.)
- [ ] **Step 4:** Run → PASS; full suite green.
- [ ] **Step 5: Commit** `feat(tools): remember(symbol/file) + surface anchored notes in define/outline`

---

### Task 3: Server schema + acceptance

**Files:** Modify `src/server.ts`; Create `scripts/demo-notes.mjs`

- `server.ts`: the `remember` registration `inputSchema` gains `symbol: z.string().optional().describe("Anchor the note to this symbol name")` and `file: z.string().optional().describe("Anchor the note to this file")`.

- [ ] **Step 1:** Update the `remember` schema; `npm run build` clean.
- [ ] **Step 2:** Demo script `scripts/demo-notes.mjs`: index a temp repo defining `backoffScheduler`; `rememberTool` a note anchored to it; `defineTool("backoffScheduler")` → prints the note under the definition; `recallTool("flaky retry")` → finds it by meaning and shows the anchor; `defineTool("unrelated")` → no note. Run it; confirm output.
- [ ] **Step 3:** `npm test` green. **Commit** `test: server remember(symbol/file) schema + anchored-notes demo`

---

## Self-Review

- **Spec coverage:** NoteAnchor + Note.anchor (T1), addNote anchor + re-anchor (T1), notesForSymbol/notesForFile (T1), searchNotes anchor (T1), rememberTool anchor (T2), define/outline surfacing (T2), recall shows anchor (T2), server schema (T3), durability (notes never pruned — unchanged from freshen, no task needed), acceptance demo (T3). All spec sections map. ✔
- **Placeholder scan:** none — real code/tests in each step. ✔
- **Type consistency:** `NoteAnchor`, `Note.anchor`, `addNote(text,tags,vector,anchor?,dedupThreshold?)`, `notesForSymbol(name)`, `notesForFile(file,symbolNames)`, `searchNotes(...).anchor` used identically across tasks. ✔
- **No-regression:** anchor is the 4th positional param (no current caller passes 4th), so existing addNote callers/tests are unaffected; unanchored remember stores no anchor. ✔
