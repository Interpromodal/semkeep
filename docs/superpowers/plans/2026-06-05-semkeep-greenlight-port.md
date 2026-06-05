# Greenlight → TypeScript Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the greenlight "definition-of-done" gate engine from Python to TypeScript inside semkeep, exposing `greenlight_run` and `greenlight_lint` MCP tools, with full behavioral parity proven by porting greenlight's own Python test vectors to vitest.

**Architecture:** A new `src/greenlight/` module mirrors greenlight's Python modules one-to-one (`spec`, `predicates`, `runner`, `report`, `strict`). A spec is a JSON object of `checks`; each check optionally runs a shell command (`child_process`), then pure assertion **predicates** evaluate the captured result; a report decides GREEN (all required checks pass). Stateless. The JSON spec format is unchanged, so existing `greenlight.json` files and the skill stay compatible. **The CLI (`semkeep greenlight run/lint/init`) is Plan 3** — Plan 2 delivers the engine + MCP tools + tests only.

**Tech Stack:** TypeScript (ESM, NodeNext, `.js` import extensions), vitest, `node:child_process`/`node:fs`, `@modelcontextprotocol/sdk` `registerTool` + zod. Zero runtime deps (matches greenlight).

**Plan 2 of 3.** Branch `feat/consolidate-cairn-greenlight`.

## Porting source (authoritative)

The Python original lives at **`C:/Users/john/.claude/tools/greenlight/greenlight/`**:
`spec.py` (167), `predicates.py` (400 — ~20 predicates), `runner.py` (113), `report.py` (164), `strict.py` (122), plus `mcp_server.py` (tool schemas) and the repo's `tests/` dir (`test_*.py`, ~1,500 lines).

**Porting rule for every task:** read the corresponding Python module and **preserve its behavior exactly** (field names, defaults, edge cases). Then **port that module's Python test file** to a vitest file — the ported test vectors are the conformance gate. Where this plan gives TS code, use it; where it says "port from `<file>.py`," the Python is authoritative for anything this plan doesn't pin down. **Do NOT invent behavior or predicates not in the source. Do NOT leave greenlight's Python install altered** (read-only reference).

**Two flagged parity risks (do not skim):**
1. **`json_path` typing** — Python does strict typed equality with int/float coercion but excludes `bool`. JS's number model differs. Port `test_predicates.py`'s json_path cases verbatim and make them pass.
2. **Shell semantics** — Python uses `subprocess.run(cmd, shell=True)` for string commands. Use Node `spawn(cmd, { shell: true })` so cmd.exe/sh behavior matches today's specs. Array-form commands run without a shell.

---

## File Structure

- `src/greenlight/types.ts` — **Create.** `Spec`, `Check`, `Assertion` (discriminated union on `type`), `RunResult`, `AssertionResult`, `CheckResult`, `Report`.
- `src/greenlight/spec.ts` — **Create.** `loadSpec(input)`, `validateSpec(spec)` (exhaustive, collects all errors).
- `src/greenlight/predicates.ts` — **Create.** All ~20 predicate evaluators + a `evaluateAssertion(assertion, ctx)` dispatcher.
- `src/greenlight/runner.ts` — **Create.** `runSpec(spec, opts)` — execute checks via subprocess, evaluate assertions.
- `src/greenlight/report.ts` — **Create.** `buildReport(...)`, `isGreen(report)`, `renderHuman(report)`, `renderJson(report)`.
- `src/greenlight/strict.ts` — **Create.** `lintSpec(spec)` → shallow-gate warnings.
- `src/greenlight/index.ts` — **Create.** Re-export the public surface (`runSpec`, `lintSpec`, `loadSpec`, renderers).
- `src/tools.ts` — **Modify.** Add `greenlightRunTool`, `greenlightLintTool`.
- `src/server.ts` — **Modify.** Register `greenlight_run`, `greenlight_lint`.
- `test/greenlight-spec.test.ts`, `-predicates.test.ts`, `-runner.test.ts`, `-report.test.ts`, `-strict.test.ts`, `-tools.test.ts` — **Create.** Ported from the Python `test_*.py` + tool round-trips.

---

## Task 1: Spec types + validation

**Files:**
- Create: `src/greenlight/types.ts`, `src/greenlight/spec.ts`
- Test: `test/greenlight-spec.test.ts` (port `tests/test_spec.py`)

- [ ] **Step 1: Write the failing test (port `test_spec.py`)**

Read `C:/Users/john/.claude/tools/greenlight/tests/test_spec.py`. Port every case to `test/greenlight-spec.test.ts` using vitest (`describe`/`it`/`expect`). Cover at minimum: a valid spec loads; a spec with no `checks` (or empty) is rejected; a check with no `name` is rejected; a check with no/empty `assert` list is rejected; an unknown assertion `type` is rejected; **all** errors are collected (not just the first). Match the Python error messages closely enough that the same malformed inputs fail.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/greenlight-spec.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Define the types**

Create `src/greenlight/types.ts`. Use this shape; **reconcile the exact `type` strings and field names against `predicates.py`** (it is authoritative — adjust if the source differs):
```ts
export interface RegexFlags { ignore_case?: boolean; multiline?: boolean; dotall?: boolean }

export type Assertion =
  | ({ type: "exit_code" } & { equals?: number; in?: number[] })
  | { type: "stdout_contains" | "stderr_contains" | "file_contains"; value: string; path?: string }
  | { type: "stdout_not_contains" | "stderr_not_contains"; value: string }
  | ({ type: "stdout_matches" | "stderr_matches" | "stdout_not_matches" | "stderr_not_matches"; pattern: string } & RegexFlags)
  | ({ type: "file_matches" | "file_not_matches"; path: string; pattern: string } & RegexFlags)
  | { type: "duration_under_ms"; value: number }
  | { type: "file_exists" | "file_absent"; path: string }
  | { type: "json_path"; path: string; equals: unknown; source?: "stdout" | "stderr"; file?: string };

export interface Check {
  name: string;
  run?: string | string[];
  optional?: boolean;     // default false
  timeout_ms?: number;    // default 120000
  cwd?: string;           // relative to base cwd
  strict_exempt?: boolean | string;
  assert: Assertion[];    // required, non-empty
}
export interface Spec { name?: string; checks: Check[] }

export interface RunResult {
  exit_code: number | null;  // null on timeout/spawn failure
  stdout: string;
  stderr: string;
  duration_ms: number;
  timed_out: boolean;
}
export interface AssertionResult { type: string; ok: boolean; summary: string; detail?: string }
export interface CheckResult {
  name: string; optional: boolean; skipped: boolean;
  run?: string | string[];
  result?: RunResult;            // absent if no `run`
  assertions: AssertionResult[];
  passed: boolean;               // all assertions ok AND not timed_out
}
export interface Report {
  name?: string;
  checks: CheckResult[];
  required_total: number; required_passed: number;
  green: boolean;
}
```

- [ ] **Step 4: Implement `spec.ts`**

Create `src/greenlight/spec.ts` porting `spec.py`. Provide:
```ts
import { readFileSync } from "node:fs";
import type { Spec } from "./types.js";

/** Load a spec from an inline object or a JSON file path. Exactly one of the two. */
export function loadSpec(input: { spec?: unknown; specPath?: string }): Spec {
  if ((input.spec == null) === (input.specPath == null)) {
    throw new Error("greenlight: provide exactly one of spec or spec_path");
  }
  const raw = input.specPath ? JSON.parse(readFileSync(input.specPath, "utf8")) : input.spec;
  const errors = validateSpec(raw);
  if (errors.length) throw new SpecError(errors);
  return raw as Spec;
}

export class SpecError extends Error {
  constructor(public readonly errors: string[]) {
    super(`Invalid greenlight spec:\n- ${errors.join("\n- ")}`);
    this.name = "SpecError";
  }
}

/** Exhaustively validate, collecting ALL errors (port spec.py's validator). */
export function validateSpec(raw: unknown): string[] {
  // Port the full rule set from spec.py: top-level is object; `checks` is a
  // non-empty array; each check has a non-empty string `name`, an `assert`
  // array with >=1 entry; each assertion has a known `type`; `run` if present
  // is string|string[]; `timeout_ms`/`optional`/`cwd`/`strict_exempt` types.
  // Return a flat list of human-readable error strings (empty = valid).
  // IMPLEMENT to satisfy the ported test_spec.py cases.
  ...
}
```
Replace the `...` by faithfully porting `spec.py`'s validation (the ported tests define the exact rules and messages).

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run test/greenlight-spec.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/greenlight/types.ts src/greenlight/spec.ts test/greenlight-spec.test.ts
git commit -m "feat(greenlight): spec types + exhaustive validation (TS port)"
```

---

## Task 2: Predicates (the assertion engine)

**Files:**
- Create: `src/greenlight/predicates.ts`
- Test: `test/greenlight-predicates.test.ts` (port `tests/test_predicates.py`)

- [ ] **Step 1: Write the failing test (port `test_predicates.py` verbatim)**

Read `C:/Users/john/.claude/tools/greenlight/greenlight/predicates.py` and `tests/test_predicates.py`. Port **every** test case to `test/greenlight-predicates.test.ts`. This file is the conformance gate for all ~20 predicates — especially every `json_path` case (typed equality, int/float coercion, bool exclusion) and every regex case (`ignore_case`/`multiline`/`dotall`).

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/greenlight-predicates.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `predicates.ts`**

Create `src/greenlight/predicates.ts`. Port **all** predicates from `predicates.py` — enumerate them from the source, do not rely on memory. Structure: one evaluator per predicate returning `{ ok, summary, detail? }`, plus a dispatcher:
```ts
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Assertion, AssertionResult, RunResult } from "./types.js";

export interface AssertCtx { result?: RunResult; cwd: string }

export function evaluateAssertion(a: Assertion, ctx: AssertCtx): AssertionResult {
  // switch on a.type → call the matching evaluator → normalize to AssertionResult
}
```
Provide the **`json_path`** evaluator in full (the flagged-risk one); port its exact semantics from `predicates.py`'s `_numeric_match`/json walk — strict typed equality, int↔float coercion, **`bool` is NOT numeric**:
```ts
function getByPath(root: unknown, dotted: string): unknown {
  return dotted.split(".").reduce<unknown>((acc, key) => {
    if (acc == null) return undefined;
    if (Array.isArray(acc)) return acc[Number(key)];
    if (typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, root);
}
function jsonEquals(actual: unknown, expected: unknown): boolean {
  if (typeof actual === "boolean" || typeof expected === "boolean") return actual === expected; // bool: identity only
  if (typeof actual === "number" && typeof expected === "number") return actual === expected;   // int/float unified in JS
  return JSON.stringify(actual) === JSON.stringify(expected);
}
```
Adjust `jsonEquals`/`getByPath` until **every** ported `json_path` test passes — the Python source + tests are authoritative if this sketch diverges. For regex predicates, build the `RegExp` from `pattern` + flags (`i` for `ignore_case`, `m` for `multiline`, `s` for `dotall`). For `file_*`, resolve `path` against `ctx.cwd`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/greenlight-predicates.test.ts`
Expected: PASS (all ported predicate cases).

- [ ] **Step 5: Commit**

```bash
git add src/greenlight/predicates.ts test/greenlight-predicates.test.ts
git commit -m "feat(greenlight): assertion predicates with json_path/regex parity"
```

---

## Task 3: Runner (subprocess execution)

**Files:**
- Create: `src/greenlight/runner.ts`
- Test: `test/greenlight-runner.test.ts` (port `tests/test_runner.py`)

- [ ] **Step 1: Write the failing test (port `test_runner.py`)**

Port `tests/test_runner.py` to `test/greenlight-runner.test.ts`. Cover: a check whose command exits 0 and whose assertions pass → check passes; a non-zero exit with an `exit_code` assertion expecting non-zero passes; a timeout marks `timed_out` and fails the check; `only` filters checks; a check with no `run` evaluates assertions (e.g. `file_exists`) without spawning. Use cross-platform commands (e.g. `node -e "..."`) so tests run on Windows.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/greenlight-runner.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `runner.ts` (full TS — this is the most platform-specific port)**

Create `src/greenlight/runner.ts`:
```ts
import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
import type { Check, CheckResult, Report, RunResult, Spec } from "./types.js";
import { evaluateAssertion } from "./predicates.js";

export interface RunOpts { cwd?: string; only?: string[] }
const DEFAULT_TIMEOUT_MS = 120_000;

function execute(run: string | string[], cwd: string, timeoutMs: number): RunResult {
  const t0 = Date.now();
  const isStr = typeof run === "string";
  const r = spawnSync(isStr ? run : run[0], isStr ? [] : run.slice(1), {
    cwd, shell: isStr, encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024,
  });
  const timed_out = r.error != null && (r.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
  return {
    exit_code: r.status, // null on signal/timeout/spawn error
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    duration_ms: Date.now() - t0,
    timed_out,
  };
}

export function runSpec(spec: Spec, opts: RunOpts = {}): Report {
  const baseCwd = resolve(opts.cwd ?? ".");
  const checks: CheckResult[] = spec.checks.map((c: Check) => {
    const skipped = opts.only ? !opts.only.includes(c.name) : false;
    if (skipped) {
      return { name: c.name, optional: !!c.optional, skipped: true, run: c.run, assertions: [], passed: true };
    }
    const checkCwd = c.cwd ? join(baseCwd, c.cwd) : baseCwd;
    const result = c.run !== undefined
      ? execute(c.run, checkCwd, c.timeout_ms ?? DEFAULT_TIMEOUT_MS)
      : undefined;
    const assertions = c.assert.map((a) => evaluateAssertion(a, { result, cwd: checkCwd }));
    const passed = !result?.timed_out && assertions.every((a) => a.ok);
    return { name: c.name, optional: !!c.optional, skipped: false, run: c.run, result, assertions, passed };
  });
  const required = checks.filter((c) => !c.optional && !c.skipped);
  return {
    name: spec.name,
    checks,
    required_total: required.length,
    required_passed: required.filter((c) => c.passed).length,
    green: required.every((c) => c.passed),
  };
}
```
Reconcile timeout/exit-code edge cases against `runner.py` and make the ported tests pass. (Note: `spawnSync` with `timeout` kills the process and sets `error.code = "ETIMEDOUT"`; `status` is `null` then.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/greenlight-runner.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/greenlight/runner.ts test/greenlight-runner.test.ts
git commit -m "feat(greenlight): subprocess runner with timeout + only-filter"
```

---

## Task 4: Report (GREEN decision + renderers)

**Files:**
- Create: `src/greenlight/report.ts`
- Test: `test/greenlight-report.test.ts` (port `tests/test_report.py`)

- [ ] **Step 1: Write the failing test (port `test_report.py`)**

Port `tests/test_report.py`. Cover: GREEN iff all required (non-optional, non-skipped) checks passed; an optional failing check does NOT break GREEN; the human render shows per-check pass/fail + a final verdict; the JSON render includes `green`, `required_total`, `required_passed`, per-check assertion details, and **stdout/stderr tails truncated to 1200 chars**.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/greenlight-report.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `report.ts`**

Create `src/greenlight/report.ts` porting `report.py`. `runSpec` already computes `green`; this module owns the **renderers** and any shared GREEN helper:
```ts
import type { Report } from "./types.js";

const TAIL = 1200;
const tail = (s: string) => (s.length > TAIL ? s.slice(-TAIL) : s);

export function isGreen(r: Report): boolean { return r.green; }

export function renderHuman(r: Report): string {
  // Port report.py's human format: header, one block per check (✓/✗, name,
  // failing assertion summaries, exit code, stdout/stderr tail), final
  // "GREEN" / "NOT GREEN (X/Y required checks passed)" verdict line.
  ...
}

export function renderJson(r: Report): unknown {
  // Structured object: { green, required_total, required_passed, checks: [
  //   { name, optional, skipped, exit_code, duration_ms, stdout_tail, stderr_tail,
  //     assertions: [{ type, ok, summary, detail }] } ] }
  // Apply `tail()` to stdout/stderr. Port the exact field names from report.py.
  ...
}
```
Fill the `...` from `report.py` so the ported tests pass.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/greenlight-report.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/greenlight/report.ts test/greenlight-report.test.ts
git commit -m "feat(greenlight): report GREEN decision + human/json renderers"
```

---

## Task 5: Strict linter (shallow-gate detection)

**Files:**
- Create: `src/greenlight/strict.ts`, `src/greenlight/index.ts`
- Test: `test/greenlight-strict.test.ts` (port `tests/test_strict.py`)

- [ ] **Step 1: Write the failing test (port `test_strict.py`)**

Port `tests/test_strict.py`. Cover the four shallow-gate rules and the `strict_exempt` opt-out: **R1 only_exit_code** (a check whose every assertion is `exit_code`/`duration_under_ms` — exempt if it asserts a non-zero exit, i.e. an error-path check); **R2 trivial_pattern** (a positive regex that matches the empty string); **R3 all_negative** (every assertion is a `*_not_contains`/`*_not_matches`); **R4 empty_substring** (a `*_contains` with `value === ""`). A check with `strict_exempt: true` or a reason string is skipped.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/greenlight-strict.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `strict.ts` + `index.ts`**

Create `src/greenlight/strict.ts` porting `strict.py`:
```ts
import type { Spec, Check, Assertion } from "./types.js";

export interface StrictWarning { check: string; rule: string; message: string }

export function lintSpec(spec: Spec): StrictWarning[] {
  const warnings: StrictWarning[] = [];
  for (const c of spec.checks) {
    if (c.strict_exempt) continue;
    // R1 only_exit_code, R2 trivial_pattern, R3 all_negative, R4 empty_substring
    // Port the exact predicates from strict.py; push StrictWarning per violation.
    ...
  }
  return warnings;
}
```
Create `src/greenlight/index.ts` re-exporting the public surface:
```ts
export { loadSpec, validateSpec, SpecError } from "./spec.js";
export { runSpec } from "./runner.js";
export { lintSpec } from "./strict.js";
export { renderHuman, renderJson, isGreen } from "./report.js";
export type { Spec, Report } from "./types.js";
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/greenlight-strict.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/greenlight/strict.ts src/greenlight/index.ts test/greenlight-strict.test.ts
git commit -m "feat(greenlight): strict shallow-gate linter"
```

---

## Task 6: MCP tools `greenlight_run` + `greenlight_lint`

**Files:**
- Modify: `src/tools.ts`
- Modify: `src/server.ts`
- Test: `test/greenlight-tools.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/greenlight-tools.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { greenlightRunTool, greenlightLintTool } from "../src/tools.js";

describe("greenlight tools", () => {
  it("greenlight_run returns GREEN when an inline spec's checks pass", async () => {
    const spec = { name: "t", checks: [
      { name: "echo", run: 'node -e "console.log(\'hello\')"', assert: [
        { type: "exit_code", equals: 0 },
        { type: "stdout_contains", value: "hello" },
      ] },
    ] };
    const out = await greenlightRunTool({ spec });
    expect(out).toMatch(/GREEN/);
    expect(out).not.toMatch(/NOT GREEN/);
  });

  it("greenlight_run reports NOT GREEN when an assertion fails", async () => {
    const spec = { checks: [
      { name: "bad", run: 'node -e "process.exit(1)"', assert: [{ type: "exit_code", equals: 0 }] },
    ] };
    const out = await greenlightRunTool({ spec });
    expect(out).toMatch(/NOT GREEN/);
  });

  it("greenlight_lint flags a shallow exit-code-only gate", async () => {
    const spec = { checks: [{ name: "shallow", run: "node -e \"\"", assert: [{ type: "exit_code", equals: 0 }] }] };
    const out = await greenlightLintTool({ spec });
    expect(out).toMatch(/only_exit_code|shallow/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/greenlight-tools.test.ts`
Expected: FAIL — handlers not exported.

- [ ] **Step 3: Implement the tool handlers in `src/tools.ts`**

Add imports:
```ts
import { loadSpec, runSpec, lintSpec, renderHuman } from "./greenlight/index.js";
```
Add handlers:
```ts
export async function greenlightRunTool(
  args: { spec?: unknown; spec_path?: string; cwd?: string; only?: string[]; strict?: boolean },
): Promise<string> {
  const spec = loadSpec({ spec: args.spec, specPath: args.spec_path });
  const report = runSpec(spec, { cwd: args.cwd, only: args.only });
  let out = renderHuman(report);
  if (args.strict) {
    const warns = lintSpec(spec);
    if (warns.length) out += "\n\nStrict warnings:\n" + warns.map((w) => `  - [${w.check}] ${w.message}`).join("\n");
  }
  return out;
}

export async function greenlightLintTool(
  args: { spec?: unknown; spec_path?: string },
): Promise<string> {
  const spec = loadSpec({ spec: args.spec, specPath: args.spec_path });
  const warns = lintSpec(spec);
  return warns.length
    ? "Shallow-gate warnings:\n" + warns.map((w) => `  - [${w.check}] (${w.rule}) ${w.message}`).join("\n")
    : "No shallow-gate warnings — the spec's checks assert real behavior.";
}
```

- [ ] **Step 4: Register in `src/server.ts`**

Add to the `./tools.js` import block: `greenlightRunTool`, `greenlightLintTool`. Register (after `unmark`):
```ts
server.registerTool(
  "greenlight_run",
  {
    description:
      "Run a definition-of-done gate: execute a JSON spec's checks and assert their results. Returns GREEN only if all required checks pass. Provide an inline `spec` or a `spec_path`.",
    inputSchema: {
      spec: z.record(z.any()).optional().describe("Inline spec object: { checks: [...] }"),
      spec_path: z.string().optional().describe("Path to a JSON spec file"),
      cwd: z.string().optional().describe("Base working directory for checks (default '.')"),
      only: z.array(z.string()).optional().describe("Run only these check names"),
      strict: z.boolean().optional().describe("Also flag gates too shallow to trust"),
    },
  },
  async (args) => text(await greenlightRunTool(args)),
);

server.registerTool(
  "greenlight_lint",
  {
    description:
      "Statically analyze a greenlight spec for shallow gates (checks that would pass without proving anything). Runs nothing.",
    inputSchema: {
      spec: z.record(z.any()).optional().describe("Inline spec object"),
      spec_path: z.string().optional().describe("Path to a JSON spec file"),
    },
  },
  async (args) => text(await greenlightLintTool(args)),
);
```

- [ ] **Step 5: Run the FULL suite + build**

Run: `npx vitest run test/greenlight-tools.test.ts` → PASS.
Run: `npm test` → ALL pass (Plan 1 operational tests + all 6 greenlight test files + pre-existing).
Run: `npm run build` → `tsc` exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/tools.ts src/server.ts test/greenlight-tools.test.ts
git commit -m "feat(greenlight): greenlight_run + greenlight_lint MCP tools"
```

---

## Self-Review (completed during planning)

**Spec coverage:** spec validation ✓ (T1), all ~20 predicates incl. json_path/regex parity ✓ (T2), subprocess runner + timeout + only ✓ (T3), GREEN decision + human/json renderers w/ 1200-char tails ✓ (T4), strict shallow-gate linter + strict_exempt ✓ (T5), `greenlight_run`/`greenlight_lint` tools ✓ (T6). Conformance via ported Python tests in every task. **Out of scope (Plan 3):** the `semkeep greenlight run/lint/init` CLI subcommands and updating the greenlight SKILL.md.

**Placeholder scan:** the `...` markers in `spec.ts`/`report.ts`/`strict.ts`/`predicates.ts` are deliberate **port-from-source** points, each pinned by a ported Python test file that defines exact behavior — not vague placeholders. The implementer reads the named `.py` module + makes the ported `test_*.py` pass. Every other step has complete code/commands.

**Type consistency:** `Spec`/`Check`/`Assertion`/`RunResult`/`AssertionResult`/`CheckResult`/`Report` defined once in `types.ts` and consumed identically by `spec`/`predicates`/`runner`/`report`/`strict`/tools. `runSpec` returns `Report`; `renderHuman`/`renderJson`/`isGreen`/`lintSpec` consume it; `evaluateAssertion(a, ctx)` signature matches its use in `runner.ts`. Tool handler arg names (`spec`/`spec_path`/`cwd`/`only`/`strict`) match the zod schemas.

**Implementer note:** the Python source is the source of truth wherever this plan and the source disagree. Do not add predicates, flags, or behaviors not present in `predicates.py`/`spec.py`/`strict.py`. Keep zero runtime dependencies.
