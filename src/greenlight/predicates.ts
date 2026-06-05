/**
 * Greenlight predicate engine — pure assertions over a command's result and filesystem.
 *
 * Ported from C:/Users/john/.claude/tools/greenlight/greenlight/predicates.py
 *
 * Predicates never throw for *expected* failures (a mismatch, a missing file, a
 * bad regex) — they fold those into a failing AssertionResult with human-readable
 * evidence in `detail`. The only thing that throws is an *unknown* predicate type.
 */
import { existsSync, statSync, readFileSync } from "node:fs";
import { resolve, isAbsolute, join } from "node:path";
import type { Assertion, AssertionResult, RunResult } from "./types.js";

export interface AssertCtx {
  result?: RunResult;
  cwd: string;
}

export class UnknownPredicate extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnknownPredicate";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolvePath(ctx: AssertCtx, path: string): string {
  return isAbsolute(path) ? path : join(ctx.cwd, path);
}

function readFile(ctx: AssertCtx, path: string): { content: string | null; error: string | null } {
  const full = resolvePath(ctx, path);
  try {
    const content = readFileSync(full, "utf8");
    return { content, error: null };
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { content: null, error: `file does not exist: ${path}` };
    }
    return { content: null, error: `could not read file ${path}: ${(e as Error).message}` };
  }
}

function buildRegex(pattern: string, a: Record<string, unknown>): { rx: RegExp | null; error: string | null } {
  let flags = "";
  if (a["ignore_case"]) flags += "i";
  if (a["multiline"]) flags += "m";
  if (a["dotall"]) flags += "s";
  try {
    return { rx: new RegExp(pattern, flags), error: null };
  } catch (e: unknown) {
    return { rx: null, error: `invalid regex ${JSON.stringify(pattern)}: ${(e as Error).message}` };
  }
}

function containsStr(needle: string, haystack: string, ignoreCase: boolean): boolean {
  if (ignoreCase) return haystack.toLowerCase().includes(needle.toLowerCase());
  return haystack.includes(needle);
}

function noRun(atype: string): AssertionResult {
  return {
    type: atype,
    ok: false,
    summary: atype,
    detail: "no command was run, so there is no output to assert on",
  };
}

// ---------------------------------------------------------------------------
// json_path helpers (strict typed equality, int/float coercion, bool excluded)
// ---------------------------------------------------------------------------

function getByPath(root: unknown, query: string): { value: unknown; error: string | null } {
  if (query === "") return { value: root, error: null };
  let cur: unknown = root;
  for (const seg of query.split(".")) {
    if (cur == null) return { value: undefined, error: `cannot descend into null/undefined at '${seg}'` };
    if (Array.isArray(cur)) {
      const idx = parseInt(seg, 10);
      if (Number.isNaN(idx)) return { value: undefined, error: `segment '${seg}' is not a valid list index` };
      if (idx < 0 || idx >= cur.length) return { value: undefined, error: `index ${idx} out of range at '${seg}'` };
      cur = cur[idx];
    } else if (typeof cur === "object") {
      const obj = cur as Record<string, unknown>;
      if (!(seg in obj)) return { value: undefined, error: `key '${seg}' not found` };
      cur = obj[seg];
    } else {
      return { value: undefined, error: `cannot descend into ${typeof cur} at '${seg}'` };
    }
  }
  return { value: cur, error: null };
}

/**
 * Strict typed equality, key-order-independent for objects:
 * - bool is identity only (true !== 1, false !== 0)
 * - number === number (int/float unified in JS, so 1 === 1.0 naturally)
 * - string/null: by value
 * - arrays: same length AND each element recursively deep-equal (order matters)
 * - objects: same set of keys AND each value recursively deep-equal (key order ignored)
 *
 * Mirrors Python's == on dicts/lists, which is structural and key-order-independent.
 */
function jsonEquals(actual: unknown, expected: unknown): boolean {
  // bool: identity only (bool is NOT numeric)
  if (typeof actual === "boolean" || typeof expected === "boolean") {
    return actual === expected;
  }
  // number === number (unified in JS)
  if (typeof actual === "number" && typeof expected === "number") {
    return actual === expected;
  }
  // null
  if (actual === null || expected === null) {
    return actual === expected;
  }
  // string
  if (typeof actual === "string" || typeof expected === "string") {
    return actual === expected;
  }
  // arrays: order matters, recurse element-by-element
  if (Array.isArray(actual) && Array.isArray(expected)) {
    if (actual.length !== expected.length) return false;
    for (let i = 0; i < actual.length; i++) {
      if (!jsonEquals(actual[i], expected[i])) return false;
    }
    return true;
  }
  // if one is array and the other is not, they differ
  if (Array.isArray(actual) || Array.isArray(expected)) return false;
  // objects: same key set, recurse per value (key-order-independent)
  if (typeof actual === "object" && typeof expected === "object") {
    const aObj = actual as Record<string, unknown>;
    const eObj = expected as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const eKeys = Object.keys(eObj);
    if (aKeys.length !== eKeys.length) return false;
    for (const key of aKeys) {
      if (!(key in eObj)) return false;
      if (!jsonEquals(aObj[key], eObj[key])) return false;
    }
    return true;
  }
  // fallback (should not be reached for valid JSON values)
  return actual === expected;
}

// ---------------------------------------------------------------------------
// Individual predicate evaluators
// ---------------------------------------------------------------------------

function evalExitCode(a: Record<string, unknown>, ctx: AssertCtx): AssertionResult {
  if (!ctx.result) return noRun("exit_code");
  const actual = ctx.result.exit_code;
  if ("in" in a) {
    const allowed = a["in"] as number[];
    const ok = actual !== null && allowed.includes(actual);
    return {
      type: "exit_code",
      ok,
      summary: `exit_code in ${JSON.stringify(allowed)}`,
      detail: ok ? "" : `expected one of ${JSON.stringify(allowed)}, got ${actual}`,
    };
  }
  const expected = "equals" in a ? (a["equals"] as number) : 0;
  const ok = actual === expected;
  return {
    type: "exit_code",
    ok,
    summary: `exit_code == ${expected}`,
    detail: ok ? "" : `expected exit code ${expected}, got ${actual}`,
  };
}

function makeContainsEval(atype: string, stream: "stdout" | "stderr") {
  return function evalContains(a: Record<string, unknown>, ctx: AssertCtx): AssertionResult {
    if (!ctx.result) return noRun(atype);
    const text = ctx.result[stream];
    const value = a["value"] as string;
    const ok = containsStr(value, text, !!(a["ignore_case"]));
    return {
      type: atype,
      ok,
      summary: `${atype} ${JSON.stringify(value)}`,
      detail: ok ? "" : `substring ${JSON.stringify(value)} not found`,
    };
  };
}

function makeNotContainsEval(atype: string, stream: "stdout" | "stderr") {
  return function evalNotContains(a: Record<string, unknown>, ctx: AssertCtx): AssertionResult {
    if (!ctx.result) return noRun(atype);
    const text = ctx.result[stream];
    const value = a["value"] as string;
    const ok = !containsStr(value, text, !!(a["ignore_case"]));
    return {
      type: atype,
      ok,
      summary: `${atype} ${JSON.stringify(value)}`,
      detail: ok ? "" : `unexpected substring ${JSON.stringify(value)} found`,
    };
  };
}

function makeMatchesEval(atype: string, stream: "stdout" | "stderr") {
  return function evalMatches(a: Record<string, unknown>, ctx: AssertCtx): AssertionResult {
    if (!ctx.result) return noRun(atype);
    const text = ctx.result[stream];
    const pattern = a["pattern"] as string;
    const { rx, error } = buildRegex(pattern, a);
    if (error) return { type: atype, ok: false, summary: `${atype} /${pattern}/`, detail: error };
    const matched = rx!.test(text);
    return {
      type: atype,
      ok: matched,
      summary: `${atype} /${pattern}/`,
      detail: matched ? "" : `pattern /${pattern}/ did not match`,
    };
  };
}

function makeNotMatchesEval(atype: string, stream: "stdout" | "stderr") {
  return function evalNotMatches(a: Record<string, unknown>, ctx: AssertCtx): AssertionResult {
    if (!ctx.result) return noRun(atype);
    const text = ctx.result[stream];
    const pattern = a["pattern"] as string;
    const { rx, error } = buildRegex(pattern, a);
    if (error) return { type: atype, ok: false, summary: `${atype} /${pattern}/`, detail: error };
    const matched = rx!.test(text);
    return {
      type: atype,
      ok: !matched,
      summary: `${atype} /${pattern}/`,
      detail: !matched ? "" : `pattern /${pattern}/ unexpectedly matched`,
    };
  };
}

function evalDurationUnderMs(a: Record<string, unknown>, ctx: AssertCtx): AssertionResult {
  if (!ctx.result) return noRun("duration_under_ms");
  const limit = a["value"] as number;
  const actual = ctx.result.duration_ms;
  const ok = actual < limit;
  return {
    type: "duration_under_ms",
    ok,
    summary: `duration < ${limit}ms`,
    detail: ok ? "" : `took ${actual.toFixed(1)}ms, limit is ${limit}ms`,
  };
}

function evalFileExists(a: Record<string, unknown>, ctx: AssertCtx): AssertionResult {
  const path = a["path"] as string;
  const full = resolvePath(ctx, path);
  let ok = false;
  try {
    ok = statSync(full).isFile();
  } catch {
    ok = false;
  }
  return {
    type: "file_exists",
    ok,
    summary: `file exists: ${path}`,
    detail: ok ? "" : `file not found: ${path}`,
  };
}

function evalFileAbsent(a: Record<string, unknown>, ctx: AssertCtx): AssertionResult {
  const path = a["path"] as string;
  const full = resolvePath(ctx, path);
  const exists = existsSync(full);
  const ok = !exists;
  return {
    type: "file_absent",
    ok,
    summary: `file absent: ${path}`,
    detail: ok ? "" : `file unexpectedly exists: ${path}`,
  };
}

function evalFileContains(a: Record<string, unknown>, ctx: AssertCtx): AssertionResult {
  const path = a["path"] as string;
  const value = a["value"] as string;
  const { content, error } = readFile(ctx, path);
  if (error) return { type: "file_contains", ok: false, summary: `file_contains ${path}`, detail: error };
  const ok = containsStr(value, content!, !!(a["ignore_case"]));
  return {
    type: "file_contains",
    ok,
    summary: `${path} contains ${JSON.stringify(value)}`,
    detail: ok ? "" : `${JSON.stringify(value)} not found in ${path}`,
  };
}

function evalFileMatches(a: Record<string, unknown>, ctx: AssertCtx): AssertionResult {
  const path = a["path"] as string;
  const pattern = a["pattern"] as string;
  const { content, error } = readFile(ctx, path);
  if (error) return { type: "file_matches", ok: false, summary: `file_matches ${path}`, detail: error };
  const { rx, error: rerr } = buildRegex(pattern, a);
  if (rerr) return { type: "file_matches", ok: false, summary: `file_matches ${path}`, detail: rerr };
  const matched = rx!.test(content!);
  return {
    type: "file_matches",
    ok: matched,
    summary: `${path} matches /${pattern}/`,
    detail: matched ? "" : `/${pattern}/ did not match ${path}`,
  };
}

function evalFileNotMatches(a: Record<string, unknown>, ctx: AssertCtx): AssertionResult {
  const path = a["path"] as string;
  const pattern = a["pattern"] as string;
  const { content, error } = readFile(ctx, path);
  if (error) {
    // If the file does not exist, the forbidden pattern certainly is not in it.
    // Treat "absent file" as a pass for the negative assertion.
    // (Mirrors predicates.py's exact behavior.)
    if (error.includes("does not exist")) {
      return { type: "file_not_matches", ok: true, summary: `${path} !~ /${pattern}/`, detail: "" };
    }
    return { type: "file_not_matches", ok: false, summary: `file_not_matches ${path}`, detail: error };
  }
  const { rx, error: rerr } = buildRegex(pattern, a);
  if (rerr) return { type: "file_not_matches", ok: false, summary: `file_not_matches ${path}`, detail: rerr };
  const matched = rx!.test(content!);
  return {
    type: "file_not_matches",
    ok: !matched,
    summary: `${path} !~ /${pattern}/`,
    detail: !matched ? "" : `forbidden /${pattern}/ matched ${path}`,
  };
}

function evalJsonPath(a: Record<string, unknown>, ctx: AssertCtx): AssertionResult {
  const source = (a["source"] as string | undefined) ?? "stdout";
  const query = a["query"] as string;
  const expected = a["equals"];
  const summary = `json ${JSON.stringify(query)} == ${JSON.stringify(expected)}`;

  let raw: string;
  if (source === "file") {
    const { content, error } = readFile(ctx, a["path"] as string);
    if (error) return { type: "json_path", ok: false, summary, detail: error };
    raw = content!;
  } else {
    if (!ctx.result) return noRun("json_path");
    raw = ctx.result[source as "stdout" | "stderr"];
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e: unknown) {
    return {
      type: "json_path",
      ok: false,
      summary,
      detail: `could not parse ${source} as JSON: ${(e as Error).message}`,
    };
  }

  const { value, error } = getByPath(data, query);
  if (error) {
    return { type: "json_path", ok: false, summary, detail: `query failed: ${error}` };
  }

  const ok = jsonEquals(value, expected);
  return {
    type: "json_path",
    ok,
    summary,
    detail: ok ? "" : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(value)}`,
  };
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

type EvalFn = (a: Record<string, unknown>, ctx: AssertCtx) => AssertionResult;

const REGISTRY: Record<string, EvalFn> = {
  exit_code: evalExitCode,
  stdout_contains: makeContainsEval("stdout_contains", "stdout"),
  stdout_not_contains: makeNotContainsEval("stdout_not_contains", "stdout"),
  stdout_matches: makeMatchesEval("stdout_matches", "stdout"),
  stdout_not_matches: makeNotMatchesEval("stdout_not_matches", "stdout"),
  stderr_contains: makeContainsEval("stderr_contains", "stderr"),
  stderr_not_contains: makeNotContainsEval("stderr_not_contains", "stderr"),
  stderr_matches: makeMatchesEval("stderr_matches", "stderr"),
  stderr_not_matches: makeNotMatchesEval("stderr_not_matches", "stderr"),
  duration_under_ms: evalDurationUnderMs,
  file_exists: evalFileExists,
  file_absent: evalFileAbsent,
  file_contains: evalFileContains,
  file_matches: evalFileMatches,
  file_not_matches: evalFileNotMatches,
  json_path: evalJsonPath,
};

export function evaluateAssertion(a: Assertion, ctx: AssertCtx): AssertionResult {
  const atype = (a as Record<string, unknown>)["type"] as string;
  const fn = REGISTRY[atype];
  if (!fn) throw new UnknownPredicate(`unknown assertion type: ${JSON.stringify(atype)}`);
  return fn(a as unknown as Record<string, unknown>, ctx);
}
