/**
 * Greenlight type definitions — the shared data model for the entire engine.
 *
 * Ported from the Python greenlight package (spec.py, predicates.py, report.py).
 * Field names and semantics match the Python source exactly.
 */

export interface RegexFlags {
  ignore_case?: boolean;
  multiline?: boolean;
  dotall?: boolean;
}

/**
 * Discriminated union of all assertion types.
 * Type strings match the Python REGISTRY keys in predicates.py exactly.
 * NOTE: json_path uses `query` (not `path`) — this matches predicates.py's
 *       required=("query", "equals") and _json_path implementation.
 */
export type Assertion =
  | ({ type: "exit_code" } & { equals?: number; in?: number[] })
  | ({ type: "stdout_contains" | "stderr_contains" } & { value: string; ignore_case?: boolean })
  | ({ type: "stdout_not_contains" | "stderr_not_contains" } & { value: string; ignore_case?: boolean })
  | ({ type: "stdout_matches" | "stderr_matches" | "stdout_not_matches" | "stderr_not_matches"; pattern: string } & RegexFlags)
  | ({ type: "file_contains"; path: string; value: string } & { ignore_case?: boolean })
  | ({ type: "file_matches" | "file_not_matches"; path: string; pattern: string } & RegexFlags)
  | { type: "duration_under_ms"; value: number }
  | { type: "file_exists" | "file_absent"; path: string }
  | { type: "json_path"; query: string; equals: unknown; source?: "stdout" | "stderr" | "file"; path?: string };

export interface Check {
  name: string;
  run?: string | string[];
  optional?: boolean;        // default false
  timeout_ms?: number;       // default 120000
  cwd?: string;              // relative to base cwd
  strict_exempt?: boolean | string;
  assert: Assertion[];       // required, non-empty
}

export interface Spec {
  name?: string;
  checks: Check[];
}

export interface RunResult {
  exit_code: number | null;  // null on timeout/spawn failure
  stdout: string;
  stderr: string;
  duration_ms: number;
  timed_out: boolean;
}

export interface AssertionResult {
  type: string;
  ok: boolean;
  summary: string;
  detail?: string;
}

export interface CheckResult {
  name: string;
  optional: boolean;
  skipped: boolean;
  run?: string | string[];
  run_cmd?: string;          // display string for the command (matches Python run_cmd)
  result?: RunResult;        // absent if no `run`
  assertions: AssertionResult[];
  passed: boolean;           // all assertions ok AND not timed_out
  note?: string;             // timeout / spawn-error message (matches Python CheckResult.note)
}

export interface Report {
  name?: string;
  checks: CheckResult[];
  required_total: number;
  required_passed: number;
  green: boolean;
  cwd: string;               // resolved base cwd (matches Python Report.cwd)
}
