# semkeep Phase 3 — Notes ↔ Symbols — Design Spec

**Date:** 2026-06-04
**Status:** Draft for review
**Author:** Claude (with John)
**Builds on:** the shipped semkeep (Phases 1 structural, 1.5 quality, 2 freshness). Extends the codebase; does not rewrite it.

## 1. Purpose & Motivation

semkeep's notes (`remember`/`recall`) and its code knowledge are separate islands. Phase 3 ties them together: a note can **anchor** to a symbol, so the knowledge surfaces exactly where you work with that code. Jot *"this retry path drops events under load"* anchored to `backoffScheduler`, and every `define`/`outline` that touches `backoffScheduler` shows it. This is the "second brain for your codebase" payoff — knowledge co-located with the code it's about.

Anchoring is **name-based** (chosen over file:line): it survives edits, re-formatting, and the line-shifts that Phase 2's freshen produces.

## 2. Goals & Non-Goals

### Goals
- A note can anchor to a **symbol name** (and optionally a file), or stay free (as today).
- Anchored notes **surface** in `define` (by symbol) and `outline` (by file/its symbols).
- Notes remain fully **semantically recallable** via `recall`, anchored or not — anchoring is an extra retrieval path, never a replacement.
- Notes are **durable**: `freshen` never deletes them; refactors don't lose knowledge.

### Non-Goals (deferred — YAGNI)
- Surfacing notes inside `search` results (noisier; `define`/`outline` are the precise spots).
- Line-level anchors (brittle under freshen).
- Auto-migrating an anchor when a symbol is renamed (the note simply stops surfacing via the old name but stays recallable).

## 3. Data Model (additive, backward-compatible)

`Note` gains an optional anchor:
```typescript
export interface NoteAnchor {
  symbol?: string; // a symbol name (not line-based)
  file?: string;   // absolute path, optional scope
}
// Note: add `anchor?: NoteAnchor;`
```
Existing notes (no `anchor`) are unaffected.

## 4. Behavior

**Write — `remember(text, tags?, symbol?, file?)`:**
- If `symbol` or `file` is given, store `anchor = { symbol, file: resolve(file) }` (file resolved to absolute so it matches indexed symbol paths).
- Semantic dedup is unchanged; on a dedup hit, if a new anchor was supplied, **re-anchor** the existing note (lets you attach/move knowledge to a note you already have).

**Surface:**
- `define(name)` → after the definition(s), append a `Notes:` section listing notes whose `anchor.symbol === name`.
- `outline(file)` → append notes whose `anchor.file === file` **or** whose `anchor.symbol` is one of the file's symbols ("what do I know about this file").
- `recall(query)` → unchanged semantic search over all notes; output now shows each note's anchor (`↳ @symbol` / file) when present.

No notes for a symbol/file → nothing appended (no noise).

## 5. Architecture (extend, don't rewrite)

```
src/types.ts   # NoteAnchor; Note.anchor?
src/store.ts   # addNote carries anchor (+ re-anchor on dedup); notesForSymbol; notesForFile; searchNotes returns anchor
src/tools.ts   # rememberTool symbol/file -> anchor; defineTool/outlineTool surface; recallTool shows anchor
src/server.ts  # remember tool schema: optional symbol, file
```

- `addNote(text, tags, vector, anchor?, dedupThreshold?)` — anchor inserted as the 4th param (no current caller passes a 4th positional, so this is safe).
- `notesForSymbol(name): Note[]` = notes where `anchor?.symbol === name`.
- `notesForFile(file, symbolNames): Note[]` = notes where `anchor?.file === file || (anchor?.symbol && symbolNames.includes(anchor.symbol))`.

## 6. Error Handling

- Unanchored `remember` behaves exactly as today.
- Surfacing is read-only and additive; an empty result appends nothing.
- A note anchored to a now-deleted symbol is harmless — it just won't surface via `define`, and `recall` still finds it. Notes are never auto-pruned.

## 7. Testing (TDD, offline, lexical embedder)

- `addNote` with an anchor stores it; `notesForSymbol` / `notesForFile` return it; dedup with a new anchor **re-anchors**.
- `rememberTool` with `symbol` → `defineTool(symbol)` output contains the note.
- `outlineTool(file)` surfaces both a file-anchored note and a symbol-in-file-anchored note.
- `recall` still finds an anchored note semantically (and shows its anchor).
- Unanchored `remember` → no anchor; existing notes tests unaffected.

## 8. Acceptance Criteria

1. `npm run build && npm test` green, including the new notes-anchor tests.
2. Demo (script): `remember` a note anchored to a symbol, `index_path` the code, `define` that symbol → the note appears beneath the definition; `recall` finds it by meaning; an unrelated `define` shows nothing.
3. Re-`remember`ing the same text with a different symbol re-anchors (no duplicate note).

## 9. Milestones

1. `types.ts` + `store.ts`: `NoteAnchor`, `Note.anchor`, `addNote` anchor + re-anchor, `notesForSymbol`/`notesForFile`, `searchNotes` returns anchor — TDD.
2. `tools.ts`: `rememberTool` anchor args; `defineTool`/`outlineTool` surfacing; `recallTool` shows anchor — TDD.
3. `server.ts`: `remember` schema gains `symbol`/`file`.
4. Acceptance: anchored-note demo + full suite green.
