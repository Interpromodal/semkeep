/**
 * Greenlight strict linter — static analysis for shallow gates.
 *
 * Ported from C:/Users/john/.claude/tools/greenlight/greenlight/strict.py
 *
 * This is the direct counter to the tool's worst failure mode: a shallow gate
 * that reports GREEN while the feature is broken. The linter cannot read intent,
 * so it cannot prove a gate is *strong* — it can only point at shapes that are
 * *usually* too weak and make you look again.
 */
import type { Spec, Assertion } from "./types.js";

export const ONLY_EXIT_CODE = "only_exit_code";
export const TRIVIAL_PATTERN = "trivial_pattern";
export const EMPTY_SUBSTRING = "empty_substring";
export const ALL_NEGATIVE = "all_negative";

export interface StrictWarning {
  check: string;
  rule: string;
  message: string;
}

// Assertion types that only confirm the command *ran*, not that it was *correct*.
const EFFECTLESS = new Set(["exit_code", "duration_under_ms"]);

// Positive regex-matching assertions (a trivial pattern here always passes).
const POSITIVE_MATCH = new Set(["stdout_matches", "stderr_matches", "file_matches"]);

// Positive substring assertions (an empty value here always passes).
const POSITIVE_CONTAINS = new Set(["stdout_contains", "stderr_contains", "file_contains"]);

// Negative assertions (pass when something is *absent*).
const NEGATIVE = new Set([
  "stdout_not_contains",
  "stderr_not_contains",
  "stdout_not_matches",
  "stderr_not_matches",
  "file_not_matches",
]);

/**
 * Build a regex flags bitmask from an assertion's flag fields.
 * Mirrors strict.py's _flags().
 */
function regexFlags(a: Record<string, unknown>): string {
  let f = "";
  if (a["ignore_case"]) f += "i";
  if (a["multiline"]) f += "m";
  if (a["dotall"]) f += "s";
  return f;
}

/**
 * True if the pattern matches the empty string (i.e., matches ~anything).
 * Mirrors strict.py's _matches_empty().
 */
function matchesEmpty(pattern: string, a: Record<string, unknown>): boolean {
  try {
    const flags = regexFlags(a);
    const re = new RegExp(pattern, flags);
    return re.test("");
  } catch {
    // Invalid regex is the runner's problem, not the linter's.
    return false;
  }
}

/**
 * True if some exit_code assertion *requires* a non-zero exit (an error-path
 * check), i.e. it does not accept success.
 * Mirrors strict.py's _has_deliberate_nonzero_exit().
 */
function hasDeliberateNonzeroExit(assertions: Assertion[]): boolean {
  for (const a of assertions) {
    if (typeof a !== "object" || a === null) continue;
    const obj = a as Record<string, unknown>;
    if (obj["type"] !== "exit_code") continue;
    if ("equals" in obj && obj["equals"] !== 0) return true;
    if ("in" in obj) {
      const arr = obj["in"];
      if (Array.isArray(arr) && !arr.includes(0)) return true;
    }
  }
  return false;
}

/**
 * Lint a spec for shallow gates.
 * Returns an array of StrictWarning (empty = no issues found).
 * Mirrors strict.py's lint_spec().
 */
export function lintSpec(spec: Spec): StrictWarning[] {
  const warnings: StrictWarning[] = [];

  for (const check of spec.checks) {
    // An explicit author vouch (strict_exempt: true or a non-empty reason string)
    // suppresses linting for this check.
    if (check.strict_exempt) continue;

    const name = check.name;
    const assertions = check.assert;
    const types = assertions
      .filter((a): a is Record<string, unknown> & Assertion => typeof a === "object" && a !== null)
      .map((a) => (a as Record<string, unknown>)["type"] as string);

    // R1: a run-check whose every assertion only confirms it ran successfully.
    // Asserting a specific non-zero exit code is a deliberate error-path check,
    // not a shallow one, so it is exempt.
    if (check.run !== undefined && types.length > 0 && types.every((t) => EFFECTLESS.has(t))) {
      if (!hasDeliberateNonzeroExit(assertions)) {
        warnings.push({
          check: name,
          rule: ONLY_EXIT_CODE,
          message:
            "only checks the command ran (exit code/duration); it can't tell a " +
            "correct result from a wrong one. Assert something about its output, " +
            "a file it produces, or a JSON value.",
        });
      }
    }

    // R3: a run-check whose only content assertions are negative.
    if (check.run !== undefined && types.length > 0 && types.every((t) => NEGATIVE.has(t))) {
      warnings.push({
        check: name,
        rule: ALL_NEGATIVE,
        message:
          "every assertion is negative (checks something is absent); a command " +
          "that produces no output would still pass. Add a positive assertion.",
      });
    }

    // R2 / R4: per-assertion triviality.
    for (const a of assertions) {
      if (typeof a !== "object" || a === null) continue;
      const obj = a as Record<string, unknown>;
      const t = obj["type"] as string;

      if (POSITIVE_MATCH.has(t) && "pattern" in obj && matchesEmpty(obj["pattern"] as string, obj)) {
        warnings.push({
          check: name,
          rule: TRIVIAL_PATTERN,
          message:
            `pattern /${obj["pattern"] as string}/ matches the empty string, so it passes on ` +
            "almost any output (including empty). Tighten it.",
        });
      }

      if (POSITIVE_CONTAINS.has(t) && obj["value"] === "") {
        warnings.push({
          check: name,
          rule: EMPTY_SUBSTRING,
          message:
            "checks for an empty substring, which is always present. " +
            "Use a meaningful value.",
        });
      }
    }
  }

  return warnings;
}
