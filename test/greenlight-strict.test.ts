/**
 * Greenlight strict linter tests — ported from:
 * C:/Users/john/.claude/tools/greenlight/tests/test_strict.py
 *
 * The linter runs static analysis on specs to flag shallow gates.
 * It never executes anything — pure structural analysis.
 */
import { describe, it, expect } from "vitest";
import { lintSpec } from "../src/greenlight/strict.js";
import { loadSpec } from "../src/greenlight/spec.js";
import type { Spec } from "../src/greenlight/types.js";

// ---------------------------------------------------------------------------
// Helper — mirrors the Python test helper spec() + rules()
// ---------------------------------------------------------------------------

function makeSpec(checks: unknown[]): Spec {
  return loadSpec({ spec: { name: "t", checks } });
}

function rules(warnings: { rule: string }[]): Set<string> {
  return new Set(warnings.map((w) => w.rule));
}

// Rule name constants (must match strict.ts exactly)
const ONLY_EXIT_CODE = "only_exit_code";
const TRIVIAL_PATTERN = "trivial_pattern";
const EMPTY_SUBSTRING = "empty_substring";
const ALL_NEGATIVE = "all_negative";

// ---------------------------------------------------------------------------
// R1: only_exit_code
// ---------------------------------------------------------------------------

describe("only_exit_code rule", () => {
  it("single exit_code equals 0 is flagged", () => {
    const s = makeSpec([{ name: "c", run: "x", assert: [{ type: "exit_code", equals: 0 }] }]);
    const w = lintSpec(s);
    expect(rules(w)).toContain(ONLY_EXIT_CODE);
    expect(w[0].check).toBe("c");
  });

  it("exit_code plus duration_under_ms still flagged", () => {
    const s = makeSpec([{
      name: "c", run: "x", assert: [
        { type: "exit_code", equals: 0 },
        { type: "duration_under_ms", value: 1000 },
      ],
    }]);
    expect(rules(lintSpec(s))).toContain(ONLY_EXIT_CODE);
  });

  it("exit_code plus output assertion is ok", () => {
    const s = makeSpec([{
      name: "c", run: "x", assert: [
        { type: "exit_code", equals: 0 },
        { type: "stdout_contains", value: "done" },
      ],
    }]);
    expect(rules(lintSpec(s))).not.toContain(ONLY_EXIT_CODE);
  });

  it("specific nonzero exit code is not flagged (deliberate error-path check)", () => {
    const s = makeSpec([{ name: "err path", run: "x", assert: [{ type: "exit_code", equals: 2 }] }]);
    expect(rules(lintSpec(s))).not.toContain(ONLY_EXIT_CODE);
  });

  it("exit_code in set including 0 is still flagged", () => {
    const s = makeSpec([{ name: "c", run: "x", assert: [{ type: "exit_code", in: [0, 1] }] }]);
    expect(rules(lintSpec(s))).toContain(ONLY_EXIT_CODE);
  });

  it("exit_code plus file_exists (build artifact) is ok", () => {
    const s = makeSpec([{
      name: "build", run: "make", assert: [
        { type: "exit_code", equals: 0 },
        { type: "file_exists", path: "out.bin" },
      ],
    }]);
    expect(rules(lintSpec(s))).not.toContain(ONLY_EXIT_CODE);
  });

  it("no run check is not flagged", () => {
    const s = makeSpec([{ name: "c", assert: [{ type: "file_exists", path: "x" }] }]);
    expect(lintSpec(s)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// R2: trivial_pattern
// ---------------------------------------------------------------------------

describe("trivial_pattern rule", () => {
  it("dot-star pattern is flagged", () => {
    const s = makeSpec([{ name: "c", run: "x", assert: [{ type: "stdout_matches", pattern: ".*" }] }]);
    expect(rules(lintSpec(s))).toContain(TRIVIAL_PATTERN);
  });

  it("optional group matching empty is flagged", () => {
    const s = makeSpec([{ name: "c", run: "x", assert: [{ type: "stdout_matches", pattern: "a?" }] }]);
    expect(rules(lintSpec(s))).toContain(TRIVIAL_PATTERN);
  });

  it("real pattern with required content is ok", () => {
    const s = makeSpec([{ name: "c", run: "x", assert: [{ type: "stdout_matches", pattern: "\\d+ passed" }] }]);
    expect(rules(lintSpec(s))).not.toContain(TRIVIAL_PATTERN);
  });

  it("negative match with trivial pattern is not trivial (it would always FAIL, not pass)", () => {
    const s = makeSpec([{
      name: "c", run: "x", assert: [
        { type: "exit_code", equals: 0 },
        { type: "stdout_not_matches", pattern: ".*" },
      ],
    }]);
    expect(rules(lintSpec(s))).not.toContain(TRIVIAL_PATTERN);
  });

  it("invalid regex does not crash the linter", () => {
    const s = makeSpec([{
      name: "c", run: "x", assert: [
        { type: "exit_code", equals: 0 },
        { type: "stdout_matches", pattern: "(" },
      ],
    }]);
    // Must not throw
    expect(() => lintSpec(s)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// R4: empty_substring
// ---------------------------------------------------------------------------

describe("empty_substring rule", () => {
  it("empty stdout_contains value is flagged", () => {
    const s = makeSpec([{ name: "c", run: "x", assert: [{ type: "stdout_contains", value: "" }] }]);
    expect(rules(lintSpec(s))).toContain(EMPTY_SUBSTRING);
  });

  it("nonempty stdout_contains is ok", () => {
    const s = makeSpec([{ name: "c", run: "x", assert: [{ type: "stdout_contains", value: "x" }] }]);
    expect(rules(lintSpec(s))).not.toContain(EMPTY_SUBSTRING);
  });

  it("empty stderr_contains is flagged", () => {
    const s = makeSpec([{ name: "c", run: "x", assert: [{ type: "stderr_contains", value: "" }] }]);
    expect(rules(lintSpec(s))).toContain(EMPTY_SUBSTRING);
  });

  it("empty file_contains is flagged", () => {
    const s = makeSpec([{
      name: "c", assert: [{ type: "file_contains", path: "x.txt", value: "" }],
    }]);
    expect(rules(lintSpec(s))).toContain(EMPTY_SUBSTRING);
  });
});

// ---------------------------------------------------------------------------
// R3: all_negative
// ---------------------------------------------------------------------------

describe("all_negative rule", () => {
  it("only negative assertions are flagged", () => {
    const s = makeSpec([{
      name: "c", run: "x", assert: [
        { type: "stdout_not_matches", pattern: "FAIL" },
      ],
    }]);
    expect(rules(lintSpec(s))).toContain(ALL_NEGATIVE);
  });

  it("negative with exit_code is ok", () => {
    const s = makeSpec([{
      name: "c", run: "x", assert: [
        { type: "exit_code", equals: 0 },
        { type: "stdout_not_matches", pattern: "FAIL" },
      ],
    }]);
    expect(rules(lintSpec(s))).not.toContain(ALL_NEGATIVE);
  });
});

// ---------------------------------------------------------------------------
// strict_exempt opt-out
// ---------------------------------------------------------------------------

describe("strict_exempt opt-out", () => {
  it("strict_exempt: true suppresses all warnings", () => {
    const s = makeSpec([{
      name: "tool", run: "pytest", strict_exempt: true,
      assert: [{ type: "exit_code", equals: 0 }],
    }]);
    expect(lintSpec(s)).toEqual([]);
  });

  it("strict_exempt reason string suppresses warnings", () => {
    const s = makeSpec([{
      name: "tool", run: "pytest",
      strict_exempt: "pytest exit code is authoritative",
      assert: [{ type: "exit_code", equals: 0 }],
    }]);
    expect(lintSpec(s)).toEqual([]);
  });

  it("strict_exempt empty string does NOT suppress (falsy)", () => {
    const s = makeSpec([{
      name: "tool", run: "pytest", strict_exempt: "",
      assert: [{ type: "exit_code", equals: 0 }],
    }]);
    expect(rules(lintSpec(s))).toContain(ONLY_EXIT_CODE);
  });

  it("strict_exempt suppresses all rules for that check (even trivial pattern)", () => {
    const s = makeSpec([{
      name: "tool", run: "x", strict_exempt: true,
      assert: [{ type: "stdout_matches", pattern: ".*" }],
    }]);
    expect(lintSpec(s)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Clean spec / warning structure
// ---------------------------------------------------------------------------

describe("clean spec and warning structure", () => {
  it("meaningful gate produces no warnings", () => {
    const s = makeSpec([
      {
        name: "tests", run: "pytest", assert: [
          { type: "exit_code", equals: 0 },
          { type: "stdout_matches", pattern: "\\d+ passed" },
        ],
      },
      {
        name: "artifact",
        assert: [{ type: "file_exists", path: "dist/app.js" }],
      },
    ]);
    expect(lintSpec(s)).toEqual([]);
  });

  it("warnings carry check name, rule, and message", () => {
    const s = makeSpec([{
      name: "weak", run: "x", assert: [{ type: "exit_code", equals: 0 }],
    }]);
    const w = lintSpec(s)[0];
    expect(w.check).toBe("weak");
    expect(w.rule).toBeTruthy();
    expect(w.message).toBeTruthy();
  });
});
