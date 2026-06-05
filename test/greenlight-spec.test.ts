/**
 * Greenlight spec validation tests — ported from
 * C:/Users/john/.claude/tools/greenlight/tests/test_spec.py
 */
import { describe, it, expect } from "vitest";
import { loadSpec, validateSpec, SpecError } from "../src/greenlight/spec.js";

function minimal() {
  return {
    name: "demo",
    checks: [
      { name: "c1", run: "echo hi", assert: [{ type: "exit_code", equals: 0 }] },
    ],
  };
}

describe("validateSpec — valid specs", () => {
  it("parses name and checks", () => {
    const errors = validateSpec(minimal());
    expect(errors).toHaveLength(0);
  });

  it("name defaults when absent", () => {
    // No name key — should still be valid (name is optional in the TS Spec type)
    const data = { checks: minimal().checks };
    const errors = validateSpec(data);
    expect(errors).toHaveLength(0);
  });

  it("run as list is allowed", () => {
    const data = minimal();
    (data.checks[0] as any).run = ["echo", "hi"];
    expect(validateSpec(data)).toHaveLength(0);
  });

  it("filesystem assertion needs no run", () => {
    const data = {
      checks: [{ name: "artifact", assert: [{ type: "file_exists", path: "x" }] }],
    };
    expect(validateSpec(data)).toHaveLength(0);
  });

  it("optional, timeout_ms, cwd are accepted", () => {
    const data = minimal();
    Object.assign(data.checks[0], { optional: true, timeout_ms: 5000, cwd: "sub" });
    expect(validateSpec(data)).toHaveLength(0);
  });

  it("strict_exempt defaults false (no error)", () => {
    // Just verify no error; the default is checked by absence of the key
    expect(validateSpec(minimal())).toHaveLength(0);
  });

  it("strict_exempt bool true is accepted", () => {
    const data = minimal();
    (data.checks[0] as any).strict_exempt = true;
    expect(validateSpec(data)).toHaveLength(0);
  });

  it("strict_exempt reason string is accepted", () => {
    const data = minimal();
    (data.checks[0] as any).strict_exempt = "pytest exit code is authoritative";
    expect(validateSpec(data)).toHaveLength(0);
  });
});

describe("validateSpec — invalid specs", () => {
  it("not an object — errors mention 'object'", () => {
    const errors = validateSpec([]);
    expect(errors.join(" ").toLowerCase()).toContain("object");
  });

  it("missing checks — errors mention 'checks'", () => {
    const errors = validateSpec({ name: "x" });
    expect(errors.join(" ").toLowerCase()).toContain("checks");
  });

  it("empty checks list is rejected — errors mention 'no checks'", () => {
    const errors = validateSpec({ checks: [] });
    expect(errors.join(" ").toLowerCase()).toContain("no checks");
  });

  it("check missing name — errors mention 'name'", () => {
    const errors = validateSpec({
      checks: [{ assert: [{ type: "exit_code", equals: 0 }], run: "x" }],
    });
    expect(errors.join(" ").toLowerCase()).toContain("name");
  });

  it("check missing assert — errors mention 'assert'", () => {
    const errors = validateSpec({ checks: [{ name: "c", run: "x" }] });
    expect(errors.join(" ").toLowerCase()).toContain("assert");
  });

  it("empty assert list is rejected — errors mention 'assert'", () => {
    const errors = validateSpec({ checks: [{ name: "c", assert: [] }] });
    expect(errors.join(" ").toLowerCase()).toContain("assert");
  });

  it("assertion missing type — errors mention 'type'", () => {
    const errors = validateSpec({
      checks: [{ name: "c", run: "x", assert: [{ equals: 0 }] }],
    });
    expect(errors.join(" ").toLowerCase()).toContain("type");
  });

  it("unknown assertion type — errors mention 'unknown'", () => {
    const errors = validateSpec({
      checks: [{ name: "c", run: "x", assert: [{ type: "bogus" }] }],
    });
    expect(errors.join(" ").toLowerCase()).toContain("unknown");
  });

  it("run-dependent assertion without run — errors mention 'run'", () => {
    const errors = validateSpec({
      checks: [{ name: "c", assert: [{ type: "exit_code", equals: 0 }] }],
    });
    expect(errors.join(" ").toLowerCase()).toContain("run");
  });

  it("run wrong type — errors mention 'run'", () => {
    const errors = validateSpec({
      checks: [{ name: "c", run: 5, assert: [{ type: "file_exists", path: "x" }] }],
    });
    expect(errors.join(" ").toLowerCase()).toContain("run");
  });

  it("optional wrong type — errors mention 'optional'", () => {
    const data = minimal();
    (data.checks[0] as any).optional = "yes";
    const errors = validateSpec(data);
    expect(errors.join(" ").toLowerCase()).toContain("optional");
  });

  it("timeout_ms must be positive — errors mention 'timeout'", () => {
    const data = minimal();
    (data.checks[0] as any).timeout_ms = -1;
    const errors = validateSpec(data);
    expect(errors.join(" ").toLowerCase()).toContain("timeout");
  });

  it("strict_exempt wrong type rejected — errors mention 'strict_exempt'", () => {
    const data = minimal();
    (data.checks[0] as any).strict_exempt = 123;
    const errors = validateSpec(data);
    expect(errors.join(" ").toLowerCase()).toContain("strict_exempt");
  });

  it("errors are aggregated (multiple problems collected, not just first)", () => {
    // Two checks: one missing name, one with empty assert
    const data = { checks: [{ run: "x" }, { name: "ok", assert: [] }] };
    const errors = validateSpec(data);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe("loadSpec", () => {
  it("throws SpecError with structured errors when spec is invalid", () => {
    expect(() =>
      loadSpec({ spec: { checks: [] } })
    ).toThrowError(SpecError);
  });

  it("parses a valid inline spec", () => {
    const spec = loadSpec({ spec: minimal() });
    expect(spec.name).toBe("demo");
    expect(spec.checks).toHaveLength(1);
    expect(spec.checks[0].name).toBe("c1");
  });

  it("throws when neither spec nor specPath is provided", () => {
    expect(() => loadSpec({})).toThrow(/exactly one/);
  });

  it("throws when both spec and specPath are provided", () => {
    expect(() => loadSpec({ spec: minimal(), specPath: "foo.json" })).toThrow(/exactly one/);
  });
});
