# Design: consolidate `cairn` + `greenlight` into `semkeep`

**Date:** 2026-06-05
**Status:** awaiting approval (no code until approved)
**Goal:** fold two small MCP servers — **cairn** (operational memory, Node/TS) and **greenlight** (verification gate, Python) — into **semkeep**, producing one project-companion server with a single coherent, non-overlapping tool surface, losing none of each tool's distinguishing semantics.

---

## 1. Non-negotiables (carried from the task)

- cairn's verification semantics survive: typed kinds, `exitCode`/`verifiedAt`, recipe staleness, upsert-by-title, per-project scoping. Recipes are **not** generic "remember a string."
- greenlight's done-gating survives: `lint` + `run` as first-class checks.
- All existing semkeep tools and tests keep working (18 test files; remember/recall/forget unchanged).
- **One unambiguous tool surface** — no duplicate `recall`/`forget`.
- cairn + greenlight stay fully intact and registered until the merged semkeep is proven; **then** cut over.

---

## 2. Current state (verified by reading the real source)

**semkeep** (`F:/Dreams/Dream1`, Node/TS, vitest): one per-project JSON store at `<dataDir>/store.json` (`dataDir = SEMKEEP_DATA_DIR || <cwd>/.semkeep`). `StoreData` holds flat arrays: `chunks`, `notes`, `symbols`, `imports`, `references`, `roots`, plus `files`/`fileStats`/`meta`. **Notes** are embedded vectors, similarity-ranked, dedup-by-cosine (>0.97), optional symbol/file anchor — *semantic*, no kinds/metadata/staleness. Tools registered via `server.registerTool(name, {description, inputSchema}, handler)`; context built lazily (`getContext()`); `bin: semkeep → dist/server.js`.

**cairn** (`F:/Dreams/Dream4`, Node/TS): one **global** store `~/.cairn/cairn.json`, shape `{version, projects: {<absPath>: {markers: []}}}`. **One flat marker shape** for all kinds (`recipe|gotcha|deadend|note`): `{id, kind, title, body?, command?, cwd?, exitCode?, tags?, createdAt, updatedAt, verifiedAt?}` (ISO timestamps). `kind` only drives the id-prefix and recipe-only `verifiedAt`/staleness. **Upsert** by `(project, kind, normalizeTitle(title))` — field-level merge preserving `id`+`createdAt`. **Staleness** = recipe-only, computed at read, `>30d` (strict) or missing/unparseable `verifiedAt`. The store is pure logic with injectable `now`/`genId`/`staleDays`; project resolution lives in `paths.js` (`arg → CAIRN_PROJECT → CLAUDE_PROJECT_DIR → cwd`). CLI (`recall --hook`, `nudge --hook`) emits Claude Code hook JSON, silent when empty, never non-zero in `--hook`. 12 store tests.

**greenlight** (`~/.claude/tools/greenlight`, Python 3.10+): **not** a linter wrapper — a declarative **done-gate engine**. A JSON spec lists `checks`; each check optionally runs a shell command, then ~20 pure assertion **predicates** (`exit_code`, `stdout/stderr_(not_)contains/matches`, `duration_under_ms`, `file_exists/absent/contains/matches/not_matches`, `json_path`) decide GREEN/NOT-GREEN with evidence. `greenlight_run` executes + asserts; `greenlight_lint` statically flags shallow gates (`only_exit_code`, `all_negative`, `trivial_pattern`, `empty_substring`). **Zero third-party deps**, ~1,400 lines stdlib-only, **stateless**. Its paired skill drives the **CLI** (`python -m greenlight run greenlight.json`), never the MCP tools.

---

## 3. Decisions (resolved)

**D1 — Operational memory: dedicated module, not folded into notes.** Notes (semantic dedup) and markers (exact upsert-by-title + typed metadata + staleness) are different storage and retrieval models; merging would wrongly dedup distinct recipes and lose verification/staleness. Port cairn's logic into a new `src/operational/` module.

**D2 — greenlight: port to TypeScript.** ~1,400 lines of zero-dependency, stdlib-only orchestration (subprocess + ~20 tiny predicates + JSON validation); no Python-specific intelligence to preserve. Porting removes the `C:/Python314` dependency, unifies the stack, shares semkeep's MCP server, and keeps the JSON spec format unchanged so existing `greenlight.json` files keep working. Port the Python tests as a conformance suite.

**D3 — Hook entrypoint: make `bin: semkeep` a dispatcher.** Bare invocation (`npx -y semkeep`) starts the stdio MCP server, exactly as today. Subcommands run CLI actions: `semkeep markers --hook`, `semkeep nudge --hook`, `semkeep greenlight run|lint|init …`, `semkeep import-cairn`. `server.ts`'s `main()` is refactored into an exported `serve()` the dispatcher calls.

**D4 — Scoping/storage: operational memory is its own lean, global, project-keyed store** at `~/.semkeep/operational.json` (override `SEMKEEP_OPS_STORE`), shape identical to cairn's (`{version, projects:{<absPath>:{markers:[]}}}`). Project resolution mirrors cairn: `arg → SEMKEEP_PROJECT → CLAUDE_PROJECT_DIR → cwd`. The per-project code/notes `store.json` is untouched. Rationale: the SessionStart hook must read markers without parsing a multi-MB embeddings file, and operational facts should persist independently of any project's code index. Migration is then a near-verbatim copy of `cairn.json`.

> **Two same-named folders, on purpose — keep them distinct:** `~/.semkeep/` (home) holds the **global** operational store (`operational.json`) and the optional credential config (`config.json`); the **per-project** code/notes index stays at `<cwd>/.semkeep/store.json`. Same folder name, different locations (home vs project root).

**Tool surface (your call): separate verbs.** Semantic notes keep `remember`/`recall`/`forget` (byte-identical). Operational memory gets non-colliding verbs `mark`/`markers`/`unmark`. greenlight adds `greenlight_run`/`greenlight_lint`. No duplicate `recall`/`forget`; each verb means exactly one thing.

**Credential isolation (your request).** semkeep stops auto-inheriting ambient API keys. Resolution order per provider: `SEMKEEP_OPENAI_API_KEY` (env) → `~/.semkeep/config.json` → **only if opted in** (`SEMKEEP_INHERIT_ENV_KEYS=1`, or `SEMKEEP_EMBEDDER=openai|voyage` explicitly) the bare `OPENAI_API_KEY`/`VOYAGE_API_KEY`. Default = local on-device model; your machine-wide key never leaks into semkeep. Set the namespaced key in semkeep's own MCP-server `env` block (process-scoped). This flips the "auto-uses your OPENAI_API_KEY" warning we shipped last week into "uses its own isolated key; ignores your ambient key by default."

---

## 4. Architecture

### 4.1 Final MCP tool surface (16 tools)

| Group | Tools |
|---|---|
| Code intelligence (unchanged) | `index_path`, `search`, `define`, `callers`, `outline`, `imports`, `refresh`, `status` |
| Semantic notes (unchanged) | `remember`, `recall`, `forget` |
| Operational memory (new) | `mark`, `markers`, `unmark` |
| Verification (new) | `greenlight_run`, `greenlight_lint` |

`status` is extended to also report operational-store path + marker count, and the active credential source. The `PROTOCOL` string gains one line each for operational memory and verification.

### 4.2 Operational memory — `src/operational/`

**Types** (`src/operational/types.ts`):
```ts
export type MarkerKind = "recipe" | "gotcha" | "deadend" | "note";
export interface Marker {
  id: string;          // `${rcp|gca|ded|not}_${rand6}`
  kind: MarkerKind;
  title: string;       // raw display text
  body?: string; command?: string; cwd?: string;
  exitCode?: number; tags?: string[];
  createdAt: string; updatedAt: string; verifiedAt?: string;  // ISO 8601
}
export interface OperationalData {
  version: 1;
  projects: Record<string, { markers: Marker[] }>;  // key = resolved abs path
}
```

**`store.ts`** — port of cairn `store.js`: `mark`, `recall`, `forget`, `isStale`, `normalizeTitle`, `genId`, with injectable `now`/`genId`/`staleDays` (so cairn's tests port directly). Same upsert semantics (preserve `id`+`createdAt`; refresh `verifiedAt` only on verified recipe; never clear fields). Reads/writes `OperationalData` to disk; ENOENT → empty; bad JSON / wrong shape → clear thrown error (never auto-reset).

**`paths.ts`** — `resolveProject(arg)` (`arg → SEMKEEP_PROJECT → CLAUDE_PROJECT_DIR → cwd`, `path.resolve`d) and `defaultOpsStorePath()` (`SEMKEEP_OPS_STORE || ~/.semkeep/operational.json`).

**`format.ts`** — port of cairn `format.js`: grouped, staleness-flagged markdown for `markers`/hook output; one-line confirmation for `mark`.

**Tool handlers** (in `tools.ts`): `markTool`, `markersTool`, `unmarkTool` — resolve project, open the operational store, delegate, save, format. These do **not** touch the code/notes store or the embedder (operational memory is non-semantic).

**MCP schemas:**
- `mark` — `kind` (enum, required), `title` (required), `project?`, `body?`, `command?`, `cwd?`, `exitCode?` (int), `tags?` (string[]).
- `markers` — `project?`, `query?` (substring over title/body/command/tags), `kind?` (enum), `includeStale?` (default true).
- `unmark` — `id` (required), `project?`.

### 4.3 Verification — `src/greenlight/`

Faithful TS port, module-per-Python-module: `spec.ts` (types + exhaustive validation), `predicates.ts` (all ~20 predicates; replicate `json_path` strict numeric typing), `runner.ts` (`child_process` with `shell:true` for string commands; capture stdout/stderr/exit/duration; per-check timeout), `report.ts` (result model, GREEN = all required checks pass; human + JSON renderers with 1200-char tails), `strict.ts` (shallow-gate linter + `strict_exempt`).

**Tool handlers** (in `tools.ts`): `greenlightRunTool` (`spec?`, `spec_path?`, `cwd?`, `only?`, `strict?`), `greenlightLintTool` (`spec?`, `spec_path?`). Same input contract as the Python tools; `spec`/`spec_path` mutually exclusive (enforced in code). The `greenlight.json` format is unchanged, so existing specs cross over untouched.

### 4.4 CLI dispatcher — `src/cli.ts` (`bin: semkeep → dist/cli.js`)

```
semkeep                         # no args → serve() the MCP server on stdio (today's behavior)
semkeep markers   --hook [--project DIR] [--query Q] [--kind K]   # SessionStart auto-recall
semkeep nudge     --hook [--project DIR]                          # PreCompact capture nudge
semkeep greenlight run  <spec.json> [--json] [--only N...] [--strict]   # exit 0=GREEN,1=NOT-GREEN,2=spec-error
semkeep greenlight lint <spec.json>
semkeep greenlight init [path]
semkeep import-cairn [--from ~/.cairn/cairn.json] [--into ~/.semkeep/operational.json]
```

Hook discipline is preserved exactly: `--hook` commands print Claude Code hook JSON, stay **silent when the project has no markers** (SessionStart), and **can only ever exit 0** in `--hook` mode (success, usage, or any thrown error all exit 0). The dispatcher shares `loadConfig()` so the CLI and the server agree on store locations.

### 4.5 Credential isolation — `src/config.ts`

```ts
const inheritEnv = env.SEMKEEP_INHERIT_ENV_KEYS === "1"
                || env.SEMKEEP_EMBEDDER === "openai" || env.SEMKEEP_EMBEDDER === "voyage";
const fileCfg = readUserConfig();           // ~/.semkeep/config.json (optional)
openaiKey = env.SEMKEEP_OPENAI_API_KEY ?? fileCfg.openaiKey ?? (inheritEnv ? env.OPENAI_API_KEY : undefined);
voyageKey = env.SEMKEEP_VOYAGE_API_KEY ?? fileCfg.voyageKey ?? (inheritEnv ? env.VOYAGE_API_KEY : undefined);
```
`detect.ts` is unchanged (it consumes `config.openaiKey`/`voyageKey`). Default behavior changes: a bare ambient key is **no longer used** unless explicitly opted in.

---

## 5. Data flow

- **Code/search/notes:** unchanged. Per-project `store.json` + embedder.
- **`mark`/`markers`/`unmark`:** resolve project → open `~/.semkeep/operational.json` → mutate/read markers for that project → save → format. No embeddings.
- **SessionStart hook:** `semkeep markers --hook` → read operational store for the resolved project → emit recall JSON or stay silent.
- **PreCompact hook:** `semkeep nudge --hook` → list known marker titles + capture reminder.
- **`greenlight_run`/CLI:** load spec → run each check's command via subprocess → evaluate predicates → GREEN/NOT-GREEN + evidence. Stateless.

---

## 6. Migration & cutover (only after the merge is proven on a branch)

1. **Operational data:** `semkeep import-cairn` reads `~/.cairn/cairn.json` and writes `~/.semkeep/operational.json` (shapes are identical — copy markers verbatim, preserving `id`/`createdAt`/`updatedAt`/`verifiedAt`/all fields; merge per-project if the target exists). ~6 markers for `F:/Dreams/Dream4`.
2. **greenlight:** no persistent state to migrate; existing `greenlight.json` files keep working. Update `~/.claude/skills/greenlight/SKILL.md` to call `semkeep greenlight run` (and `init`/`--json`) instead of `python -m greenlight`.
3. **Hooks** (`~/.claude/settings.json`): repoint SessionStart (recall) and PreCompact (nudge) from `F:/Dreams/Dream4/src/cli.js` to `semkeep markers --hook` / `semkeep nudge --hook`. Keep the existing semkeep PreToolUse(Grep) "mind-palace" nudge hook. Preserve silent-when-empty / never-non-zero discipline.
4. **Deregister** once parity is verified: `claude mcp remove cairn -s user`; remove the `greenlight` block from `~/.claude.json`. Confirm `claude mcp list` shows **only** semkeep, healthy.
5. **Rebuild** `dist/`; update README, site FAQ (incl. the credential-isolation correction + the new tools), and docs.

---

## 7. Testing strategy (TDD)

- **Port cairn's 12 store tests** → `test/operational-store.test.ts` (injected clock/genId): upsert/staleness/isolation/persistence/validation/corrupt-file.
- **Port greenlight's Python tests** → `test/greenlight-{predicates,runner,spec,strict,report}.test.ts` (esp. `json_path` numeric typing and the shallow-gate rules — verbatim conformance).
- **New tool-handler tests:** `mark`/`markers`/`unmark` round-trips; `greenlight_run` GREEN/NOT-GREEN; `greenlight_lint` flags a shallow gate.
- **Credential tests:** `SEMKEEP_OPENAI_API_KEY` used; bare `OPENAI_API_KEY` ignored unless `SEMKEEP_INHERIT_ENV_KEYS=1` or forced.
- **CLI/hook tests:** `markers --hook` silent when empty + exits 0; `nudge --hook` always emits.
- **All 18 existing test files stay green**; extend `scripts/smoke-stdio.mjs` to exercise the new tools.
- **Dogfood:** author `greenlight.json` gating the merge (build + `vitest run` + stdio smoke), run it before claiming done; record semkeep's verified build/test/run commands via `mark kind=recipe`.

---

## 8. Non-goals / YAGNI

- No unifying notes + markers storage; no change to notes' semantics or the code index.
- No new greenlight predicates beyond parity.
- No port of cairn's id RNG beyond functional parity (keep the prefix scheme).
- No remote/multi-user features.

---

## 9. Risks & mitigations

- **Cross-platform shell** (greenlight `shell:true`): keep parity with Python's behavior; port runner tests; document cmd.exe vs sh nuance.
- **`json_path` numeric/bool typing**: port its unit tests verbatim — easy to get subtly wrong in JS.
- **Behavior change (ambient key no longer used)**: surface in `status` (when no namespaced key + inherit off → "local (ambient keys ignored)"), and update README/site.
- **Tool count grows to 16**: acceptable; the `status` protocol documents when to reach for each.
- **Hook regressions**: golden-test the hook JSON output and the exit-0 guarantee before repointing; leave cairn registered until verified.

---

## 10. Definition of done

- [ ] Operational memory at cairn parity (typed kinds, verification proof, staleness, upsert, per-project) — tests green.
- [ ] Verification at greenlight parity (lint + run done-gating) — tests green.
- [ ] All pre-existing semkeep tools + tests pass.
- [ ] One unambiguous tool surface — no duplicate `recall`/`forget`.
- [ ] cairn markers + greenlight usage migrated; nothing lost.
- [ ] Hooks repointed to semkeep, verified to fire, silent/non-fatal when appropriate.
- [ ] Credentials isolated (`SEMKEEP_OPENAI_API_KEY`; ambient keys ignored by default).
- [ ] cairn + greenlight registrations removed; `claude mcp list` shows only semkeep, healthy.
- [ ] End-to-end stdio smoke test of the merged server passes.
- [ ] README/site/docs updated.
