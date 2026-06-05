/**
 * Greenlight spec loading and validation.
 *
 * Ported from C:/Users/john/.claude/tools/greenlight/greenlight/spec.py
 *
 * Validation is strict and *exhaustive*: validateSpec reports every problem it
 * finds at once, because a half-valid gate is worse than no gate — and an empty
 * or assertion-less check is rejected so the runner can never report GREEN for a
 * gate that actually checks nothing.
 */
import { readFileSync } from "node:fs";
import type { Spec, Assertion } from "./types.js";

// Known predicate types (matches REGISTRY in predicates.py).
// Predicates that do NOT need a `run` command (filesystem predicates).
const FILESYSTEM_TYPES = new Set([
  "file_exists",
  "file_absent",
  "file_contains",
  "file_matches",
  "file_not_matches",
]);

// All known predicate types.
const KNOWN_TYPES = new Set([
  "exit_code",
  "stdout_contains",
  "stdout_not_contains",
  "stdout_matches",
  "stdout_not_matches",
  "stderr_contains",
  "stderr_not_contains",
  "stderr_matches",
  "stderr_not_matches",
  "duration_under_ms",
  "file_exists",
  "file_absent",
  "file_contains",
  "file_matches",
  "file_not_matches",
  "json_path",
]);

// Required keys per type (mirrors REGISTRY[n].required in predicates.py).
const REQUIRED_KEYS: Record<string, string[]> = {
  stdout_contains: ["value"],
  stdout_not_contains: ["value"],
  stderr_contains: ["value"],
  stderr_not_contains: ["value"],
  stdout_matches: ["pattern"],
  stdout_not_matches: ["pattern"],
  stderr_matches: ["pattern"],
  stderr_not_matches: ["pattern"],
  duration_under_ms: ["value"],
  file_exists: ["path"],
  file_absent: ["path"],
  file_contains: ["path", "value"],
  file_matches: ["path", "pattern"],
  file_not_matches: ["path", "pattern"],
  json_path: ["query", "equals"],
};

export class SpecError extends Error {
  constructor(public readonly errors: string[]) {
    super(`Invalid greenlight spec:\n- ${errors.join("\n- ")}`);
    this.name = "SpecError";
  }
}

/**
 * Validate one assertion object. Returns an array of error strings.
 * Mirrors predicates.py's validate_assertion().
 */
function validateAssertion(a: unknown): string[] {
  if (a === null || typeof a !== "object" || Array.isArray(a)) {
    return [`assertion must be an object, got ${Array.isArray(a) ? "array" : typeof a}`];
  }
  const obj = a as Record<string, unknown>;
  const atype = obj["type"];
  if (atype == null) {
    return ["assertion is missing 'type'"];
  }
  if (!KNOWN_TYPES.has(atype as string)) {
    return [`unknown assertion type: ${JSON.stringify(atype)}`];
  }
  const errs: string[] = [];
  // exit_code special: needs 'equals' or 'in'
  if (atype === "exit_code") {
    if (!("equals" in obj) && !("in" in obj)) {
      errs.push("exit_code assertion needs 'equals' or 'in'");
    }
  }
  // json_path with source='file' needs 'path'
  if (atype === "json_path" && obj["source"] === "file" && !("path" in obj)) {
    errs.push("json_path with source 'file' needs 'path'");
  }
  // Check required keys
  for (const key of REQUIRED_KEYS[atype as string] ?? []) {
    if (!(key in obj)) {
      errs.push(`${atype} assertion is missing required key '${key}'`);
    }
  }
  return errs;
}

/**
 * Whether an assertion type requires a command to have been run.
 * Mirrors predicates.py's requires_run().
 */
function requiresRun(a: Record<string, unknown>): boolean {
  const atype = a["type"] as string;
  if (!KNOWN_TYPES.has(atype)) return false;
  if (FILESYSTEM_TYPES.has(atype)) return false;
  if (atype === "json_path") {
    // json_path with source='file' does NOT need run
    return (a["source"] ?? "stdout") !== "file";
  }
  // All remaining types (exit_code, stdout_*, stderr_*, duration_under_ms) need run.
  return true;
}

/**
 * Exhaustively validate a raw spec object, collecting ALL errors.
 * Returns an empty array if valid.
 *
 * Ports spec.py's parse_spec() validation logic.
 */
export function validateSpec(raw: unknown): string[] {
  const errors: string[] = [];

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    const typeName = Array.isArray(raw) ? "array" : raw === null ? "null" : typeof raw;
    return [`spec must be a JSON object, got ${typeName}`];
  }

  const data = raw as Record<string, unknown>;
  const rawChecks = data["checks"];

  if (rawChecks == null) {
    return ["spec is missing 'checks'"];
  }
  if (!Array.isArray(rawChecks)) {
    return ["'checks' must be a list"];
  }
  if (rawChecks.length === 0) {
    return ["spec has no checks (a gate must check at least one thing)"];
  }

  for (let i = 0; i < rawChecks.length; i++) {
    const rc = rawChecks[i];
    let label = `check[${i}]`;

    if (rc === null || typeof rc !== "object" || Array.isArray(rc)) {
      errors.push(`${label} must be an object`);
      continue;
    }

    const checkObj = rc as Record<string, unknown>;
    const cname = checkObj["name"];
    if (typeof cname === "string" && cname) {
      label = `check '${cname}'`;
    }
    if (typeof cname !== "string" || !cname) {
      errors.push(`${label} is missing a non-empty 'name'`);
    }

    // Validate 'run'
    const run = checkObj["run"];
    let runValid = true;
    if (run !== undefined) {
      const isStringRun = typeof run === "string";
      const isArrayRun =
        Array.isArray(run) && (run as unknown[]).every((x) => typeof x === "string");
      if (!isStringRun && !isArrayRun) {
        errors.push(`${label}: 'run' must be a string or a list of strings`);
        runValid = false;
      }
    }

    // Validate 'optional'
    const optional = checkObj["optional"];
    if (optional !== undefined && typeof optional !== "boolean") {
      errors.push(`${label}: 'optional' must be true or false`);
    }

    // Validate 'timeout_ms'
    const timeout_ms = checkObj["timeout_ms"];
    if (timeout_ms !== undefined) {
      const isNumericNonBool =
        typeof timeout_ms === "number" && !Number.isNaN(timeout_ms);
      // bool is not allowed (bool is typeof 'boolean' in JS, but let's be explicit)
      if (typeof timeout_ms === "boolean" || !isNumericNonBool || (timeout_ms as number) <= 0) {
        errors.push(`${label}: 'timeout_ms' must be a positive number`);
      }
    }

    // Validate 'cwd'
    const cwd = checkObj["cwd"];
    if (cwd !== undefined && typeof cwd !== "string") {
      errors.push(`${label}: 'cwd' must be a string`);
    }

    // Validate 'strict_exempt'
    const strict_exempt = checkObj["strict_exempt"];
    if (strict_exempt !== undefined && typeof strict_exempt !== "boolean" && typeof strict_exempt !== "string") {
      errors.push(`${label}: 'strict_exempt' must be true/false or a reason string`);
    }

    // Validate 'assert'
    const assertions = checkObj["assert"];
    if (assertions == null) {
      errors.push(`${label} is missing 'assert' (list of assertions)`);
    } else if (!Array.isArray(assertions)) {
      errors.push(`${label}: 'assert' must be a list`);
    } else if (assertions.length === 0) {
      errors.push(`${label}: 'assert' is empty (a check must assert something)`);
    } else {
      // Validate each assertion
      for (let j = 0; j < assertions.length; j++) {
        const assertObj = assertions[j];
        for (const e of validateAssertion(assertObj)) {
          errors.push(`${label} assert[${j}]: ${e}`);
        }
        // Check that run-dependent assertions have a `run` command
        if (
          runValid &&
          run === undefined &&
          assertObj !== null &&
          typeof assertObj === "object" &&
          !Array.isArray(assertObj) &&
          requiresRun(assertObj as Record<string, unknown>)
        ) {
          const atype = (assertObj as Record<string, unknown>)["type"];
          errors.push(
            `${label} assert[${j}]: '${atype}' needs command output but the check has no 'run'`
          );
        }
      }
    }
  }

  return errors;
}

/**
 * Load a spec from an inline object or a JSON file path.
 * Exactly one of the two must be provided.
 */
export function loadSpec(input: { spec?: unknown; specPath?: string }): Spec {
  if ((input.spec == null) === (input.specPath == null)) {
    throw new Error("greenlight: provide exactly one of spec or spec_path");
  }
  let raw: unknown;
  if (input.specPath) {
    const text = readFileSync(input.specPath, "utf8");
    raw = JSON.parse(text);
  } else {
    raw = input.spec;
  }
  const errors = validateSpec(raw);
  if (errors.length) throw new SpecError(errors);
  return raw as Spec;
}
