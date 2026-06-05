/**
 * Greenlight runner — execute a check's command, capture evidence, evaluate assertions.
 *
 * Ported from C:/Users/john/.claude/tools/greenlight/greenlight/runner.py
 *
 * Filesystem assertions are evaluated *after* the command runs and against the
 * check's working directory, so a check can build an artifact and then assert
 * it exists in a single step.
 */
import { spawnSync } from "node:child_process";
import { resolve, join, isAbsolute } from "node:path";
import type { Check, CheckResult, Report, RunResult, Spec } from "./types.js";
import { evaluateAssertion } from "./predicates.js";

export interface RunOpts {
  cwd?: string;
  only?: string[];
}

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Build the display string for a command — mirrors runner.py's _display_cmd().
 * Array commands are joined with spaces; string commands are returned as-is.
 */
function displayCmd(run: string | string[]): string {
  if (Array.isArray(run)) return run.join(" ");
  return run || "";
}

/**
 * Execute a command and return [RunResult, note].
 * Never throws for normal failures (exit code, timeout, missing binary).
 *
 * Mirrors runner.py's _execute(), including exact note strings.
 */
function execute(run: string | string[], cwd: string, timeoutMs: number): [RunResult, string] {
  const t0 = Date.now();
  const isStr = typeof run === "string";

  const r = spawnSync(isStr ? run : run[0], isStr ? [] : run.slice(1), {
    cwd,
    shell: isStr,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });

  const duration_ms = Date.now() - t0;
  const err = r.error as NodeJS.ErrnoException | undefined;

  // ETIMEDOUT: spawnSync killed the process because timeout expired
  // note: "timed out after <ms>ms"  — matches Python's TimeoutExpired handler
  if (err?.code === "ETIMEDOUT") {
    return [
      {
        exit_code: -1,    // matches Python's TimeoutExpired handler (exit_code=-1)
        stdout: (r.stdout as string) ?? "",
        stderr: (r.stderr as string) ?? "",
        duration_ms,
        timed_out: true,
      },
      `timed out after ${Math.round(timeoutMs)}ms`,
    ];
  }

  // ENOENT: command not found — matches Python's FileNotFoundError handler
  // note: "command not found"
  if (err?.code === "ENOENT") {
    return [
      {
        exit_code: 127,
        stdout: "",
        stderr: err.message,
        duration_ms,
        timed_out: false,
      },
      "command not found",
    ];
  }

  // Other spawn error — matches Python's OSError handler
  // note: "could not start command: <message>"
  if (err) {
    return [
      {
        exit_code: 126,
        stdout: "",
        stderr: err.message,
        duration_ms,
        timed_out: false,
      },
      `could not start command: ${err.message}`,
    ];
  }

  return [
    {
      exit_code: r.status,    // null on signal termination (matches plan type)
      stdout: (r.stdout as string) ?? "",
      stderr: (r.stderr as string) ?? "",
      duration_ms,
      timed_out: false,
    },
    "",
  ];
}

/**
 * Run a spec, executing each check's command and evaluating its assertions.
 * Returns a Report with the GREEN decision.
 */
export function runSpec(spec: Spec, opts: RunOpts = {}): Report {
  const baseCwd = resolve(opts.cwd ?? ".");

  const checks: CheckResult[] = spec.checks.map((c: Check) => {
    // If only filter is active and this check is not included, skip it.
    const skipped = opts.only ? !opts.only.includes(c.name) : false;
    if (skipped) {
      return {
        name: c.name,
        optional: c.optional ?? false,
        skipped: true,
        run: c.run,
        assertions: [],
        passed: true,   // skipped checks do not count as failures
      };
    }

    // Resolve the check's working directory.
    let checkCwd = baseCwd;
    if (c.cwd) {
      checkCwd = isAbsolute(c.cwd) ? c.cwd : join(baseCwd, c.cwd);
    }

    // Execute the command (if any).
    let result: RunResult | undefined;
    let note = "";
    if (c.run !== undefined) {
      [result, note] = execute(c.run, checkCwd, c.timeout_ms ?? DEFAULT_TIMEOUT_MS);
    }

    // Evaluate all assertions.
    const assertions = c.assert.map((a) =>
      evaluateAssertion(a, { result, cwd: checkCwd })
    );

    // A check passes iff it did not time out AND all assertions are ok.
    const passed = !result?.timed_out && assertions.every((a) => a.ok);

    return {
      name: c.name,
      optional: c.optional ?? false,
      skipped: false,
      run: c.run,
      run_cmd: c.run !== undefined ? displayCmd(c.run) : "",
      result,
      assertions,
      passed,
      note,
    };
  });

  // Compute the report's GREEN decision from required (non-optional, non-skipped) checks.
  const required = checks.filter((c) => !c.optional && !c.skipped);
  const requiredPassed = required.filter((c) => c.passed);

  return {
    name: spec.name,
    checks,
    required_total: required.length,
    required_passed: requiredPassed.length,
    green: requiredPassed.length === required.length,
    cwd: baseCwd,
  };
}
