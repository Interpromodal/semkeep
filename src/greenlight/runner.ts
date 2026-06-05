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
 * Execute a command and return a RunResult.
 * Never throws for normal failures (exit code, timeout, missing binary).
 *
 * Mirrors runner.py's _execute().
 */
function execute(run: string | string[], cwd: string, timeoutMs: number): RunResult {
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
  if (err?.code === "ETIMEDOUT") {
    return {
      exit_code: -1,    // matches Python's TimeoutExpired handler (exit_code=-1)
      stdout: (r.stdout as string) ?? "",
      stderr: (r.stderr as string) ?? "",
      duration_ms,
      timed_out: true,
    };
  }

  // ENOENT / other spawn error: command not found or could not start
  if (err) {
    return {
      exit_code: err.code === "ENOENT" ? 127 : 126,
      stdout: "",
      stderr: err.message,
      duration_ms,
      timed_out: false,
    };
  }

  return {
    exit_code: r.status,    // null on signal termination (matches plan type)
    stdout: (r.stdout as string) ?? "",
    stderr: (r.stderr as string) ?? "",
    duration_ms,
    timed_out: false,
  };
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
    const result: RunResult | undefined =
      c.run !== undefined
        ? execute(c.run, checkCwd, c.timeout_ms ?? DEFAULT_TIMEOUT_MS)
        : undefined;

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
      result,
      assertions,
      passed,
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
  };
}
