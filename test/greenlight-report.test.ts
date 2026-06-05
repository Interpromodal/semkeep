/**
 * Greenlight report tests — ported from:
 * C:/Users/john/.claude/tools/greenlight/tests/test_report.py
 *
 * Tests the GREEN decision logic and the human/json renderers,
 * built from synthetic CheckResults so they're independent of subprocess.
 */
import { describe, it, expect } from "vitest";
import { renderHuman, renderJson, isGreen } from "../src/greenlight/report.js";
import type { Report, CheckResult, AssertionResult, RunResult } from "../src/greenlight/types.js";

// ---------------------------------------------------------------------------
// Helpers — mirror the Python test helpers
// ---------------------------------------------------------------------------

function passingAssertion(): AssertionResult {
  return { type: "exit_code", ok: true, summary: "exit_code == 0" };
}

function failingAssertion(): AssertionResult {
  return {
    type: "stdout_matches",
    ok: false,
    summary: "stdout_matches /x/",
    detail: "pattern /x/ did not match",
  };
}

function passingRun(): RunResult {
  return { exit_code: 0, stdout: "hi", stderr: "", duration_ms: 12, timed_out: false };
}

function failingRun(): RunResult {
  return { exit_code: 0, stdout: "nope", stderr: "", duration_ms: 8, timed_out: false };
}

function passingCheck(name = "c", optional = false): CheckResult {
  return {
    name,
    optional,
    skipped: false,
    run: "echo hi",
    result: passingRun(),
    assertions: [passingAssertion()],
    passed: true,
  };
}

function failingCheck(name = "c", optional = false): CheckResult {
  return {
    name,
    optional,
    skipped: false,
    run: "echo nope",
    result: failingRun(),
    assertions: [failingAssertion()],
    passed: false,
  };
}

function skippedCheck(name = "s"): CheckResult {
  return {
    name,
    optional: false,
    skipped: true,
    assertions: [],
    passed: true,
  };
}

function makeReport(checks: CheckResult[], name = "demo"): Report {
  const required = checks.filter((c) => !c.optional && !c.skipped);
  const requiredPassed = required.filter((c) => c.passed);
  return {
    name,
    checks,
    required_total: required.length,
    required_passed: requiredPassed.length,
    green: requiredPassed.length === required.length,
    cwd: ".",
  };
}

// ---------------------------------------------------------------------------
// GREEN decision tests
// ---------------------------------------------------------------------------

describe("GREEN decision (isGreen)", () => {
  it("all required pass → GREEN", () => {
    const r = makeReport([passingCheck("a"), passingCheck("b")]);
    expect(r.green).toBe(true);
    expect(isGreen(r)).toBe(true);
    expect(r.required_total).toBe(2);
    expect(r.required_passed).toBe(2);
  });

  it("one required failure → NOT GREEN", () => {
    const r = makeReport([passingCheck("a"), failingCheck("b")]);
    expect(r.green).toBe(false);
    expect(isGreen(r)).toBe(false);
    expect(r.required_passed).toBe(1);
  });

  it("optional failure does not break GREEN", () => {
    const r = makeReport([passingCheck("a"), failingCheck("b", true)]);
    expect(r.green).toBe(true);
    expect(isGreen(r)).toBe(true);
  });

  it("skipped checks excluded from required counts", () => {
    const r = makeReport([passingCheck("a"), skippedCheck("s")]);
    expect(r.green).toBe(true);
    expect(r.required_total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Human render tests
// ---------------------------------------------------------------------------

describe("renderHuman", () => {
  it("lists check names and status tags", () => {
    const r = makeReport([passingCheck("alpha"), failingCheck("beta")]);
    const out = renderHuman(r);
    expect(out).toContain("alpha");
    expect(out).toContain("beta");
    expect(out).toContain("[PASS]");
    expect(out).toContain("[FAIL]");
  });

  it("shows failure detail", () => {
    const r = makeReport([failingCheck("beta")]);
    const out = renderHuman(r);
    expect(out).toContain("did not match");
  });

  it("footer says NOT GREEN", () => {
    const r = makeReport([failingCheck("beta")]);
    const out = renderHuman(r);
    expect(out).toContain("NOT GREEN");
  });

  it("footer says GREEN (not NOT GREEN) when passing", () => {
    const r = makeReport([passingCheck("alpha")]);
    const out = renderHuman(r);
    expect(out).toContain("GREEN");
    expect(out).not.toContain("NOT GREEN");
  });

  it("optional failure marked [WARN] at check level", () => {
    const r = makeReport([passingCheck("a"), failingCheck("b", true)]);
    const out = renderHuman(r);
    // The check-level tag for an optional failure is [WARN] (not [FAIL])
    expect(out).toContain("[WARN]");
    // The check-level line should not contain [FAIL] as the check tag
    // (assertion detail lines may still use [FAIL] for individual assertions)
    expect(out).toMatch(/\[WARN\] b \(optional\)/);
    expect(out).not.toMatch(/\[FAIL\] b/);
  });

  it("skipped check marked [SKIP]", () => {
    const r = makeReport([passingCheck("a"), skippedCheck("s")]);
    const out = renderHuman(r);
    expect(out).toContain("[SKIP]");
  });

  it("shows report name in header", () => {
    const r = makeReport([passingCheck()], "my-gate");
    const out = renderHuman(r);
    expect(out).toContain("my-gate");
  });

  it("optional failed footer line appears when optional checks fail", () => {
    const r = makeReport([passingCheck("a"), failingCheck("b", true)]);
    const out = renderHuman(r);
    expect(out).toContain("optional");
    expect(out).toContain("not blocking");
  });

  it("human output chrome is ASCII (no emoji / non-ASCII from format strings)", () => {
    const r = makeReport([
      passingCheck("a"),
      failingCheck("b"),
      failingCheck("c", true),
      skippedCheck("d"),
    ], "ascii-only-name");
    const out = renderHuman(r);
    // Should encode cleanly to ASCII — any non-ASCII from greenlight's own template would throw
    expect(() => Buffer.from(out, "ascii").toString("ascii")).not.toThrow();
    // More precisely: all chars in the output that came from greenlight's template are ASCII
    // (user content from check names is ASCII here, so the whole string must be ASCII)
    for (const ch of out) {
      expect(ch.charCodeAt(0)).toBeLessThan(128);
    }
  });

  it("stdout/stderr tail truncated to 1200 chars on failure", () => {
    const longOutput = "x".repeat(2000);
    const checkWithLongOutput: CheckResult = {
      name: "long",
      optional: false,
      skipped: false,
      run: "cmd",
      result: { exit_code: 1, stdout: longOutput, stderr: "", duration_ms: 5, timed_out: false },
      assertions: [{ type: "exit_code", ok: false, summary: "exit_code == 0", detail: "got 1" }],
      passed: false,
    };
    const r = makeReport([checkWithLongOutput]);
    const out = renderHuman(r);
    // The tail should be at most 1200 chars plus the truncation marker
    expect(out).toContain("...(truncated)...");
    // Should show the last 1200 chars (all "x")
    const tail = "x".repeat(1200);
    expect(out).toContain(tail.slice(-20)); // At least the end is there
  });
});

// ---------------------------------------------------------------------------
// JSON render tests
// ---------------------------------------------------------------------------

describe("renderJson", () => {
  it("is parseable and has required top-level fields", () => {
    const r = makeReport([passingCheck("a"), failingCheck("b")]);
    const data = renderJson(r) as Record<string, unknown>;
    expect(data["name"]).toBe("demo");
    expect(data["green"]).toBe(false);
    expect(data["required_total"]).toBe(2);
    expect(data["required_passed"]).toBe(1);
    const results = data["results"] as unknown[];
    expect(results).toHaveLength(2);
  });

  it("includes assertion detail in results", () => {
    const r = makeReport([failingCheck("b")]);
    const data = renderJson(r) as Record<string, unknown>;
    const results = data["results"] as Record<string, unknown>[];
    const check = results[0];
    expect(check["name"]).toBe("b");
    expect(check["ok"]).toBe(false);
    const assertions = check["assertions"] as Record<string, unknown>[];
    expect(assertions[0]["type"]).toBe("stdout_matches");
    expect(assertions[0]["ok"]).toBe(false);
    expect(assertions[0]["detail"]).toContain("did not match");
  });

  it("includes run metadata (exit_code, duration_ms)", () => {
    const r = makeReport([passingCheck("a")]);
    const data = renderJson(r) as Record<string, unknown>;
    const results = data["results"] as Record<string, unknown>[];
    const run = results[0]["run"] as Record<string, unknown>;
    expect(run["exit_code"]).toBe(0);
    expect(run).toHaveProperty("duration_ms");
  });

  it("stdout/stderr tails truncated to 1200 chars", () => {
    const longStdout = "a".repeat(2000);
    const longStderr = "b".repeat(2000);
    const check: CheckResult = {
      name: "c",
      optional: false,
      skipped: false,
      result: { exit_code: 0, stdout: longStdout, stderr: longStderr, duration_ms: 1, timed_out: false },
      assertions: [passingAssertion()],
      passed: true,
    };
    const r = makeReport([check]);
    const data = renderJson(r) as Record<string, unknown>;
    const results = data["results"] as Record<string, unknown>[];
    const run = results[0]["run"] as Record<string, unknown>;
    // Tail fields should be <= 1200 chars of content (plus possible truncation prefix)
    const stdoutTail = run["stdout_tail"] as string;
    const stderrTail = run["stderr_tail"] as string;
    expect(stdoutTail.endsWith("a".repeat(1200))).toBe(true);
    expect(stderrTail.endsWith("b".repeat(1200))).toBe(true);
    expect(stdoutTail).toContain("...(truncated)...");
    expect(stderrTail).toContain("...(truncated)...");
  });

  it("null run when check has no command", () => {
    const check: CheckResult = {
      name: "file-check",
      optional: false,
      skipped: false,
      assertions: [passingAssertion()],
      passed: true,
    };
    const r = makeReport([check]);
    const data = renderJson(r) as Record<string, unknown>;
    const results = data["results"] as Record<string, unknown>[];
    expect(results[0]["run"]).toBeNull();
  });
});
