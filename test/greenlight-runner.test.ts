/**
 * Greenlight runner tests — ported from
 * C:/Users/john/.claude/tools/greenlight/tests/test_runner.py
 *
 * Commands use `node -e "..."` instead of `python -c "..."` for portability
 * on Windows.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSpec } from "../src/greenlight/runner.js";
import type { Spec } from "../src/greenlight/types.js";

function makeSpec(checks: Spec["checks"], name = "t"): Spec {
  return { name, checks };
}

// ---------------------------------------------------------------------------
// Basic execution
// ---------------------------------------------------------------------------

describe("runner — basic execution", () => {
  it("exit zero passes", () => {
    const spec = makeSpec([
      {
        name: "c",
        run: `node -e "process.exit(0)"`,
        assert: [{ type: "exit_code", equals: 0 }],
      },
    ]);
    const rep = runSpec(spec);
    expect(rep.checks[0].passed).toBe(true);
    expect(rep.checks[0].result?.exit_code).toBe(0);
  });

  it("stdout is captured and asserted", () => {
    const spec = makeSpec([
      {
        name: "c",
        run: `node -e "process.stdout.write('the-token')"`,
        assert: [{ type: "stdout_contains", value: "the-token" }],
      },
    ]);
    const rep = runSpec(spec);
    expect(rep.checks[0].passed).toBe(true);
    expect(rep.checks[0].result?.stdout).toContain("the-token");
  });

  it("nonzero exit is captured", () => {
    const spec = makeSpec([
      {
        name: "c",
        run: `node -e "process.exit(3)"`,
        assert: [{ type: "exit_code", equals: 3 }],
      },
    ]);
    const rep = runSpec(spec);
    expect(rep.checks[0].passed).toBe(true);
    expect(rep.checks[0].result?.exit_code).toBe(3);
  });

  it("failed assertion makes check fail", () => {
    const spec = makeSpec([
      {
        name: "c",
        run: `node -e "process.stdout.write('x')"`,
        assert: [{ type: "stdout_contains", value: "not-there" }],
      },
    ]);
    const rep = runSpec(spec);
    expect(rep.checks[0].passed).toBe(false);
  });

  it("string command runs via shell", () => {
    // A string command uses shell: true
    const spec = makeSpec([
      {
        name: "c",
        run: `node -e "process.stdout.write('123')"`,
        assert: [{ type: "stdout_contains", value: "123" }],
      },
    ]);
    const rep = runSpec(spec);
    expect(rep.checks[0].passed).toBe(true);
  });

  it("duration is recorded (>= 0)", () => {
    const spec = makeSpec([
      {
        name: "c",
        run: ["node", "-e", ""],
        assert: [{ type: "exit_code", equals: 0 }],
      },
    ]);
    const rep = runSpec(spec);
    expect(rep.checks[0].result?.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("timeout marks check failed and timed_out", () => {
    const spec = makeSpec([
      {
        name: "c",
        run: ["node", "-e", "setTimeout(() => {}, 10000)"],
        assert: [{ type: "exit_code", equals: 0 }],
        timeout_ms: 300,
      },
    ]);
    const rep = runSpec(spec, { cwd: "." });
    expect(rep.checks[0].passed).toBe(false);
    expect(rep.checks[0].result?.timed_out).toBe(true);
    // note must mention timeout — mirrors test_runner.py L82-83
    expect(rep.checks[0].note?.toLowerCase()).toMatch(/time/);
  }, 5000);

  it("run_cmd is recorded for display (argv-list command)", () => {
    // Mirrors test_runner.py test_run_cmd_is_recorded_for_display (L93-96)
    const spec = makeSpec([
      {
        name: "c",
        run: ["node", "-e", "console.log(1)"],
        assert: [{ type: "exit_code", equals: 0 }],
      },
    ]);
    const rep = runSpec(spec);
    expect(rep.checks[0].run_cmd).toContain("-e");
  });

  it("missing command does not throw — check fails", () => {
    const spec = makeSpec([
      {
        name: "c",
        run: ["this_executable_does_not_exist_xyz_42"],
        assert: [{ type: "exit_code", equals: 0 }],
      },
    ]);
    let rep: ReturnType<typeof runSpec> | undefined;
    expect(() => {
      rep = runSpec(spec);
    }).not.toThrow();
    expect(rep?.checks[0].passed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Check with no `run` (filesystem-only assertions)
// ---------------------------------------------------------------------------

describe("runner — no-run checks", () => {
  it("file_exists assertion without run command", () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-runner-"));
    try {
      writeFileSync(join(dir, "present.txt"), "x", "utf8");
      const spec = makeSpec([
        {
          name: "c",
          assert: [{ type: "file_exists", path: "present.txt" }],
        },
      ]);
      const rep = runSpec(spec, { cwd: dir });
      expect(rep.checks[0].passed).toBe(true);
      expect(rep.checks[0].result).toBeUndefined(); // no command was run
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// cwd handling
// ---------------------------------------------------------------------------

describe("runner — cwd", () => {
  it("file assertion resolves against base cwd", () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-runner-"));
    try {
      writeFileSync(join(dir, "present.txt"), "x", "utf8");
      const spec = makeSpec([
        {
          name: "c",
          assert: [{ type: "file_exists", path: "present.txt" }],
        },
      ]);
      const rep = runSpec(spec, { cwd: dir });
      expect(rep.checks[0].passed).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("command runs in check cwd and creates file", () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-runner-"));
    try {
      const sub = join(dir, "build");
      mkdirSync(sub, { recursive: true });
      const spec = makeSpec([
        {
          name: "c",
          run: ["node", "-e", "require('fs').writeFileSync('made.txt', '')"],
          assert: [
            { type: "exit_code", equals: 0 },
            { type: "file_exists", path: "made.txt" },
          ],
          cwd: "build",
        },
      ]);
      const rep = runSpec(spec, { cwd: dir });
      expect(rep.checks[0].passed).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Report aggregation
// ---------------------------------------------------------------------------

describe("runner — report aggregation", () => {
  it("aggregates into report with correct green/required counts", () => {
    const spec = makeSpec([
      {
        name: "a",
        run: ["node", "-e", ""],
        assert: [{ type: "exit_code", equals: 0 }],
      },
      {
        name: "b",
        run: ["node", "-e", "process.exit(1)"],
        assert: [{ type: "exit_code", equals: 0 }],
      },
    ]);
    const rep = runSpec(spec);
    expect(rep.green).toBe(false);
    expect(rep.required_total).toBe(2);
    expect(rep.required_passed).toBe(1);
  });

  it("only filter skips other checks — report is still green", () => {
    const spec = makeSpec([
      {
        name: "a",
        run: ["node", "-e", ""],
        assert: [{ type: "exit_code", equals: 0 }],
      },
      {
        name: "b",
        run: ["node", "-e", "process.exit(1)"],
        assert: [{ type: "exit_code", equals: 0 }],
      },
    ]);
    const rep = runSpec(spec, { only: ["a"] });
    const byName = Object.fromEntries(rep.checks.map((c) => [c.name, c]));
    expect(byName["b"].skipped).toBe(true);
    expect(byName["a"].passed).toBe(true);
    // The only failing check was skipped — should be green
    expect(rep.green).toBe(true);
  });

  it("optional failing check does NOT break green", () => {
    const spec = makeSpec([
      {
        name: "required",
        run: ["node", "-e", ""],
        assert: [{ type: "exit_code", equals: 0 }],
      },
      {
        name: "optional",
        run: ["node", "-e", "process.exit(1)"],
        assert: [{ type: "exit_code", equals: 0 }],
        optional: true,
      },
    ]);
    const rep = runSpec(spec);
    expect(rep.green).toBe(true);
    expect(rep.required_total).toBe(1);
    expect(rep.required_passed).toBe(1);
  });
});
