# Integration & Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans for the CODE tasks (1–6). The **Cutover runbook** (§Cutover) is controller-executed and human-gated — NOT a subagent task.

**Goal:** Turn the merged semkeep into the single project-companion server: a CLI dispatcher serving the SessionStart/PreCompact hooks and the greenlight skill, credential isolation so semkeep never grabs an ambient API key, migration of cairn's markers, and the deregistration of cairn + greenlight.

**Architecture:** `bin: semkeep` becomes `dist/cli.js` — a thin dispatcher: no subcommand → start the MCP server (today's behavior); subcommands `markers`/`nudge` emit Claude Code hook JSON (ported from cairn's `cli.js`), `greenlight run/lint/init` drive the verification engine for the skill, `import-cairn` migrates data. `config.ts` reads namespaced creds. Cutover edits `~/.claude/settings.json` (hooks) and `~/.claude.json` / `claude mcp` (registrations) only after the merged server is proven live.

**Tech Stack:** TypeScript ESM (`.js` imports), vitest, `@modelcontextprotocol/sdk`. Branch `feat/consolidate-cairn-greenlight`.

**Plan 3 of 3.** Parity reference for hooks: `F:/Dreams/Dream4/src/cli.js` (exact hook JSON + preamble + exit-0 discipline). Greenlight CLI reference: `C:/Users/john/.claude/tools/greenlight/greenlight/cli.py`.

## File Structure

- `src/config.ts` — **Modify.** Namespaced credential resolution + optional `~/.semkeep/config.json`.
- `src/server.ts` — **Modify.** Extract `main()` → exported `serve()`.
- `src/cli.ts` — **Create.** Dispatcher + subcommand handlers (or `src/cli/` if it grows).
- `src/cli/hooks.ts` — **Create.** Pure hook-output formatters (`sessionStartHook`, `preCompactHook`) — unit-testable.
- `src/cli/greenlight-cli.ts` — **Create.** `run`/`lint`/`init` with exit codes 0/1/2.
- `src/cli/import-cairn.ts` — **Create.** `~/.cairn/cairn.json` → `~/.semkeep/operational.json`.
- `package.json` — **Modify.** `bin.semkeep` → `dist/cli.js`.
- `src/tools.ts` — **Modify.** `statusTool` shows the active credential source.
- Tests: `test/config-credentials.test.ts`, `test/cli-hooks.test.ts`, `test/cli-greenlight.test.ts`, `test/import-cairn.test.ts`.

---

## Task 1: Credential isolation

**Files:** Modify `src/config.ts`; Test `test/config-credentials.test.ts`.

- [ ] **Step 1: Write the failing test**
```ts
import { describe, it, expect, afterEach } from "vitest";
import { loadConfig } from "../src/config.js";

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

describe("credential isolation", () => {
  it("uses SEMKEEP_OPENAI_API_KEY and ignores an ambient OPENAI_API_KEY by default", () => {
    process.env = { ...saved, OPENAI_API_KEY: "ambient", SEMKEEP_OPENAI_API_KEY: "scoped" };
    delete process.env.SEMKEEP_INHERIT_ENV_KEYS; delete process.env.SEMKEEP_EMBEDDER;
    expect(loadConfig().openaiKey).toBe("scoped");
  });
  it("does NOT read a bare OPENAI_API_KEY when no namespaced key and no opt-in", () => {
    process.env = { ...saved, OPENAI_API_KEY: "ambient" };
    delete process.env.SEMKEEP_OPENAI_API_KEY; delete process.env.SEMKEEP_INHERIT_ENV_KEYS; delete process.env.SEMKEEP_EMBEDDER;
    expect(loadConfig().openaiKey).toBeUndefined();
  });
  it("reads the bare key when SEMKEEP_INHERIT_ENV_KEYS=1", () => {
    process.env = { ...saved, OPENAI_API_KEY: "ambient", SEMKEEP_INHERIT_ENV_KEYS: "1" };
    delete process.env.SEMKEEP_OPENAI_API_KEY;
    expect(loadConfig().openaiKey).toBe("ambient");
  });
  it("reads the bare key when SEMKEEP_EMBEDDER=openai (explicit intent)", () => {
    process.env = { ...saved, OPENAI_API_KEY: "ambient", SEMKEEP_EMBEDDER: "openai" };
    delete process.env.SEMKEEP_OPENAI_API_KEY; delete process.env.SEMKEEP_INHERIT_ENV_KEYS;
    expect(loadConfig().openaiKey).toBe("ambient");
  });
});
```

- [ ] **Step 2: Run → FAIL** (`npx vitest run test/config-credentials.test.ts`).

- [ ] **Step 3: Implement.** In `src/config.ts`, add a `~/.semkeep/config.json` reader and namespaced resolution. Replace the `openaiKey`/`voyageKey` assignments:
```ts
import { homedir } from "node:os";
import { existsSync, readFileSync } from "node:fs";

function readUserConfig(): { openaiKey?: string; voyageKey?: string } {
  const p = join(homedir(), ".semkeep", "config.json");
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return {}; }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): SemkeepConfig {
  const fileCfg = readUserConfig();
  const inheritEnv = env.SEMKEEP_INHERIT_ENV_KEYS === "1" || env.SEMKEEP_EMBEDDER === "openai" || env.SEMKEEP_EMBEDDER === "voyage";
  const openaiKey = env.SEMKEEP_OPENAI_API_KEY ?? fileCfg.openaiKey ?? (inheritEnv ? env.OPENAI_API_KEY : undefined);
  const voyageKey = env.SEMKEEP_VOYAGE_API_KEY ?? fileCfg.voyageKey ?? (inheritEnv ? env.VOYAGE_API_KEY : undefined);
  return { /* ...existing fields..., */ openaiKey, voyageKey };
}
```
Keep every other field as-is. (Also add a `credentialSource: "scoped-env" | "config-file" | "inherited-env" | "none"` field if you want `status` to show it — optional; the §Task 6 status line can recompute it.)

- [ ] **Step 4: Run → PASS.** **Step 5: Commit** `feat(config): isolate credentials — SEMKEEP_OPENAI_API_KEY, no ambient inherit by default`.

---

## Task 2: `serve()` extraction + CLI dispatcher skeleton

**Files:** Modify `src/server.ts`; Create `src/cli.ts`; Modify `package.json`.

- [ ] **Step 1:** In `src/server.ts`, rename `async function main()` to **`export async function serve()`** (keep its body — connect StdioServerTransport, log ready). Remove the bottom `main().catch(...)` auto-invoke from `server.ts` (the dispatcher owns process lifecycle now). Keep the `#!/usr/bin/env node` shebang OFF server.ts (move it to cli.ts).

- [ ] **Step 2:** Create `src/cli.ts`:
```ts
#!/usr/bin/env node
import { serve } from "./server.js";
import { sessionStartHook, preCompactHook } from "./cli/hooks.js";
import { runGreenlightCli } from "./cli/greenlight-cli.js";
import { importCairn } from "./cli/import-cairn.js";

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case undefined: return serve();                 // `npx -y semkeep` → MCP server
    case "markers": return sessionStartHook(rest);  // SessionStart hook
    case "nudge":   return preCompactHook(rest);     // PreCompact hook
    case "greenlight": return runGreenlightCli(rest);
    case "import-cairn": return importCairn(rest);
    case "help": case "--help": console.log(USAGE); return;
    default: console.error(`semkeep: unknown command "${cmd}"\n${USAGE}`); process.exitCode = 2;
  }
}
const USAGE = `Usage: semkeep [serve] | markers --hook | nudge --hook | greenlight <run|lint|init> | import-cairn`;
main().catch((e) => { console.error("[semkeep] fatal:", e); process.exit(1); });
```

- [ ] **Step 3:** In `package.json`, change `"bin": { "semkeep": "dist/server.js" }` → `"dist/cli.js"`.

- [ ] **Step 4:** `npm run build` → `tsc` exits 0. Smoke: `node dist/cli.js --help` prints usage; `echo "" | node dist/cli.js` should start the server then exit on stdin close (Ctrl-C in manual test). **Step 5: Commit** `feat(cli): bin dispatcher; extract serve() from server`.

---

## Task 3: Hook formatters (`markers` + `nudge`)

**Files:** Create `src/cli/hooks.ts`; Test `test/cli-hooks.test.ts`.

Port the exact behavior from `F:/Dreams/Dream4/src/cli.js` (read it): SessionStart `markers --hook` is **silent when the project has no markers**, else prints `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext": <preamble + formatted markers>}}`; PreCompact `nudge --hook` always prints `{"hookSpecificOutput":{"hookEventName":"PreCompact","additionalContext": <reminder + up to 15 known titles>}}`. **In `--hook` mode, never exit non-zero** (swallow all errors → exit 0).

- [ ] **Step 1: Write failing tests** — pure formatter functions so they're testable without spawning:
```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatSessionStart, formatPreCompact } from "../src/cli/hooks.js";
import { OperationalStore } from "../src/operational/store.js";

const dirs: string[] = [];
function opsFile() { const d = mkdtempSync(join(tmpdir(), "semkeep-hook-")); dirs.push(d); return join(d, "operational.json"); }
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

describe("hook formatters", () => {
  it("SessionStart is empty string (silent) when no markers", () => {
    const store = new OperationalStore(opsFile());
    expect(formatSessionStart("/p", store)).toBe("");
  });
  it("SessionStart emits hookSpecificOutput JSON with markers", () => {
    const file = opsFile();
    new OperationalStore(file).mark("/p", { kind: "recipe", title: "run tests", command: "npm test", exitCode: 0 });
    const out = formatSessionStart("/p", new OperationalStore(file));
    const parsed = JSON.parse(out);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("run tests");
  });
  it("PreCompact always emits, listing known titles", () => {
    const file = opsFile();
    new OperationalStore(file).mark("/p", { kind: "note", title: "watch the cache" });
    const parsed = JSON.parse(formatPreCompact("/p", new OperationalStore(file)));
    expect(parsed.hookSpecificOutput.hookEventName).toBe("PreCompact");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("watch the cache");
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `src/cli/hooks.ts`.** Pure formatters + the `--hook` wrappers:
```ts
import { OperationalStore } from "../operational/store.js";
import { resolveProject, defaultOpsStorePath } from "../operational/paths.js";
import { formatMarkers } from "../operational/format.js";

const PREAMBLE = "semkeep recalled operational memory for this project — re-verify anything flagged ⚠️ STALE, and record new verified commands/gotchas with `mark`.\n\n";

export function formatSessionStart(project: string, store: OperationalStore): string {
  const markers = store.recall(project, { includeStale: true });
  if (!markers.length) return "";            // silent in unknown projects
  const body = PREAMBLE + formatMarkers(project, markers);
  return JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: body } });
}

export function formatPreCompact(project: string, store: OperationalStore): string {
  const titles = store.recall(project, { includeStale: true }).map((m) => m.title);
  const shown = titles.slice(0, 15);
  const more = titles.length > 15 ? ` …(+${titles.length - 15} more)` : "";
  const have = titles.length ? `Already in semkeep: ${shown.join("; ")}${more}.` : "Nothing is recorded for this project yet.";
  const text = "Context is about to be compacted — record any newly-verified commands, gotchas, or dead-ends now with `mark` so they survive. " + have;
  return JSON.stringify({ hookSpecificOutput: { hookEventName: "PreCompact", additionalContext: text } });
}

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined;
}
function store(): OperationalStore { return new OperationalStore(defaultOpsStorePath()); }

export async function sessionStartHook(argv: string[]): Promise<void> {
  try {
    const out = formatSessionStart(resolveProject(flag(argv, "--project")), store());
    if (out) process.stdout.write(out);
  } catch { /* never break the session */ }
  process.exit(0);
}
export async function preCompactHook(argv: string[]): Promise<void> {
  try { process.stdout.write(formatPreCompact(resolveProject(flag(argv, "--project")), store())); }
  catch { /* swallow */ }
  process.exit(0);
}
```
(Confirm the preamble + JSON envelope shape against cairn's `cli.js`; the wire shape must satisfy Claude Code's hook protocol.)

- [ ] **Step 4: Run → PASS.** **Step 5: Commit** `feat(cli): SessionStart/PreCompact hook formatters (cairn parity, never non-zero)`.

---

## Task 4: `greenlight` CLI subcommand

**Files:** Create `src/cli/greenlight-cli.ts`; Test `test/cli-greenlight.test.ts`.

Reference `C:/Users/john/.claude/tools/greenlight/greenlight/cli.py` for exit codes and `init` output.

- [ ] **Step 1: Write failing tests** — invoke `runGreenlightCli` with a temp spec file; assert it sets `process.exitCode` to 0 (GREEN), 1 (NOT GREEN), 2 (spec error). For `init`, assert it writes a starter `greenlight.json`. (Capture exit via a small wrapper that returns the code instead of calling `process.exit`, OR assert on `process.exitCode`.)

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `src/cli/greenlight-cli.ts`:**
```ts
import { writeFileSync, existsSync } from "node:fs";
import { loadSpec, runSpec, lintSpec, renderHuman, renderJson } from "../greenlight/index.js";

const STARTER = { name: "my-gate", checks: [
  { name: "tests", run: "npm test", assert: [{ type: "exit_code", equals: 0 }, { type: "stdout_contains", value: "pass" }] },
] };

export async function runGreenlightCli(argv: string[]): Promise<void> {
  const [sub, ...rest] = argv;
  if (sub === "init") {
    const path = rest[0] ?? "greenlight.json";
    if (existsSync(path)) { console.error(`refusing to overwrite ${path}`); process.exitCode = 2; return; }
    writeFileSync(path, JSON.stringify(STARTER, null, 2) + "\n");
    console.log(`wrote ${path}`); return;
  }
  const specPath = rest.find((a) => !a.startsWith("--"));
  if (!specPath) { console.error("usage: semkeep greenlight <run|lint|init> <spec.json>"); process.exitCode = 2; return; }
  let spec;
  try { spec = loadSpec({ specPath }); } catch (e) { console.error(String((e as Error).message)); process.exitCode = 2; return; }
  if (sub === "lint") { const w = lintSpec(spec); console.log(w.length ? w.map((x) => `[${x.check}] (${x.rule}) ${x.message}`).join("\n") : "no shallow-gate warnings"); return; }
  if (sub === "run") {
    const json = rest.includes("--json");
    const strict = rest.includes("--strict");
    const onlyIdx = rest.indexOf("--only");
    const only = onlyIdx >= 0 ? rest.slice(onlyIdx + 1).filter((a) => !a.startsWith("--")) : undefined;
    const report = runSpec(spec, { only });
    console.log(json ? JSON.stringify(renderJson(report), null, 2) : renderHuman(report));
    if (strict && lintSpec(spec).length) process.exitCode = 1;
    else process.exitCode = report.green ? 0 : 1;
    return;
  }
  console.error(`unknown greenlight subcommand "${sub}"`); process.exitCode = 2;
}
```
Reconcile exit codes / `init` template with `cli.py`.

- [ ] **Step 4: Run → PASS.** **Step 5: Commit** `feat(cli): greenlight run/lint/init subcommand`.

---

## Task 5: `import-cairn` migration

**Files:** Create `src/cli/import-cairn.ts`; Test `test/import-cairn.test.ts`.

- [ ] **Step 1: Write failing test** — write a fake `cairn.json` (`{version:1, projects:{"/p":{markers:[{id:"rcp_x",kind:"recipe",title:"t",command:"c",exitCode:0,createdAt:"...",updatedAt:"...",verifiedAt:"..."}]}}}`) to a temp path; run `importCairn(["--from", fakeCairn, "--into", tempOps])`; assert the ops store now has that marker with id/timestamps/verifiedAt preserved (read via `OperationalStore`).

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `src/cli/import-cairn.ts`.** Shapes are identical (`{version, projects:{<path>:{markers:[]}}}`), so it's a per-project merge preserving everything:
```ts
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

function flag(a: string[], n: string) { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; }

export async function importCairn(argv: string[]): Promise<void> {
  const from = resolve(flag(argv, "--from") ?? join(homedir(), ".cairn", "cairn.json"));
  const into = resolve(flag(argv, "--into") ?? process.env.SEMKEEP_OPS_STORE ?? join(homedir(), ".semkeep", "operational.json"));
  if (!existsSync(from)) { console.error(`no cairn store at ${from}`); process.exitCode = 1; return; }
  const src = JSON.parse(readFileSync(from, "utf8")) as { projects?: Record<string, { markers: unknown[] }> };
  const dst = existsSync(into) ? JSON.parse(readFileSync(into, "utf8")) : { version: 1, projects: {} };
  let imported = 0;
  for (const [project, bucket] of Object.entries(src.projects ?? {})) {
    const target = (dst.projects[project] ??= { markers: [] });
    const existing = new Set(target.markers.map((m: { id: string }) => m.id));
    for (const m of bucket.markers as { id: string }[]) {
      if (!existing.has(m.id)) { target.markers.push(m); imported++; }
    }
  }
  mkdirSync(dirname(into), { recursive: true });
  writeFileSync(into, JSON.stringify(dst, null, 2) + "\n");
  console.log(`imported ${imported} marker(s) from ${from} into ${into}`);
}
```

- [ ] **Step 4: Run → PASS.** **Step 5: Commit** `feat(cli): import-cairn migration (id/timestamps/verifiedAt preserved)`.

---

## Task 6: Status credential line + full suite + build

**Files:** Modify `src/tools.ts`; Test (extend `test/operational-status.test.ts` or add to config test).

- [ ] **Step 1:** Add a `credentials:` line to `statusTool` showing the active source without leaking the key, e.g. `credentials: scoped (SEMKEEP_OPENAI_API_KEY)` / `local (ambient keys ignored)` / `config-file` / `inherited (SEMKEEP_INHERIT_ENV_KEYS)`. Derive from `ctx.config` + env (no key material). Add a test asserting the line appears and never contains the key value.

- [ ] **Step 2:** `npm test` → ALL green. `npm run build` → `tsc` 0. Manual smoke: `node dist/cli.js markers --hook` in a project with no markers prints nothing and exits 0; `node dist/cli.js greenlight init /tmp/g.json` writes a file.

- [ ] **Step 3: Commit** `feat(cli): status shows credential source; finalize dispatcher`.

---

## Self-Review (completed during planning)

**Spec coverage:** CLI dispatcher + hook entrypoints ✓ (T2/T3, spec D3/§4.4), credential isolation ✓ (T1, spec "Credential isolation"), greenlight CLI for the skill ✓ (T4), cairn migration ✓ (T5, spec §6.1), status surfacing ✓ (T6). **Cutover steps** (hook repoint, skill update, deregistration, docs) are the runbook below, not code tasks.

**Placeholder scan:** `cli.py`/`cli.js` reconciliation notes are pin-to-source instructions, gated by tests — not vague placeholders.

**Type consistency:** `serve()` exported from `server.ts` and imported by `cli.ts`; `formatSessionStart/formatPreCompact(project, OperationalStore)` match their tests; `runGreenlightCli`/`importCairn`/`sessionStartHook`/`preCompactHook(argv: string[])` signatures match the dispatcher. `OperationalStore`/`loadSpec`/`runSpec`/`lintSpec`/renderers reused from Plans 1–2 unchanged.

---

## Cutover (controller-executed, HUMAN-GATED — do AFTER Tasks 1–6 pass and dist is built)

> cairn + greenlight stay registered until step 6 verifies the merged server. Each step is reversible.

1. **Build:** `npm run build`. Confirm `dist/cli.js` exists and `node dist/cli.js --help` works.
2. **[HUMAN] Restart Claude Code** so the user-scoped `semkeep` server reloads from the new `dist/` and exposes all 16 tools (`mark/markers/unmark`, `greenlight_run/greenlight_lint`, + existing). Verify with `claude mcp list` (semkeep connected) and a live `status` call.
3. **Migrate markers:** `node dist/cli.js import-cairn` (≈6 markers from `~/.cairn/cairn.json` → `~/.semkeep/operational.json`). Verify with a live `markers` call in `F:/Dreams/Dream4` (or `markers --project F:/Dreams/Dream4`).
4. **Repoint hooks** in `~/.claude/settings.json`: SessionStart → `node F:/Dreams/Dream1/dist/cli.js markers --hook` (or `npx -y semkeep markers --hook`); PreCompact → `... nudge --hook`. Keep the existing semkeep PreToolUse(Grep) "mind-palace" hook. Remove the two cairn hook entries pointing at `F:/Dreams/Dream4/src/cli.js`.
5. **Update the greenlight skill** `~/.claude/skills/greenlight/SKILL.md`: replace `python -m greenlight run|init|lint` invocations with `semkeep greenlight run|init|lint` (or `npx -y semkeep greenlight …`). Keep the discipline/content identical.
6. **Verify merged server live**, then **deregister**: `claude mcp remove cairn -s user`; remove the `greenlight` block from `~/.claude.json`. Confirm `claude mcp list` shows **only** semkeep, healthy; cairn + greenlight gone. (If anything is wrong, STOP — old servers are still removable/re-addable.)
7. **Dogfood:** author `greenlight.json` at the repo root gating the merge (`npm run build` exit 0, `vitest run` all pass, `node dist/cli.js --help` runs) and run `node dist/cli.js greenlight run greenlight.json` → expect GREEN. Record verified recipes via `mark` (build/test/smoke commands for semkeep).
8. **Docs:** update README (new tools + CLI + the credential-isolation reversal of last week's "auto-uses your key" note), the site FAQ accordingly, and a short note in the consolidation spec marking it shipped.
9. **Finish the branch** via superpowers:finishing-a-development-branch (merge to main or PR, per the user).

## Definition of Done (from the spec)

- [ ] Operational memory at cairn parity — green (Plan 1 ✓).
- [ ] Verification at greenlight parity — green (Plan 2 ✓).
- [ ] All pre-existing semkeep tools + tests pass.
- [ ] One unambiguous tool surface — no duplicate recall/forget.
- [ ] cairn markers + greenlight migrated; nothing lost.
- [ ] Hooks repointed, verified to fire, silent/non-fatal when appropriate.
- [ ] Credentials isolated.
- [ ] cairn + greenlight deregistered; `claude mcp list` shows only semkeep, healthy.
- [ ] End-to-end stdio smoke test passes.
- [ ] README/site/docs updated.
