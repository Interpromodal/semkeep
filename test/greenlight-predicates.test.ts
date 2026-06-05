/**
 * Greenlight predicate engine tests — ported from
 * C:/Users/john/.claude/tools/greenlight/tests/test_predicates.py
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateAssertion, UnknownPredicate } from "../src/greenlight/predicates.js";
import type { AssertCtx } from "../src/greenlight/predicates.js";
import type { RunResult } from "../src/greenlight/types.js";

function makeRunResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    stdout: "",
    stderr: "",
    exit_code: 0,
    duration_ms: 0,
    timed_out: false,
    ...overrides,
  };
}

function ctx(
  opts: { stdout?: string; stderr?: string; exit_code?: number; duration_ms?: number; cwd?: string } = {}
): AssertCtx {
  return {
    result: makeRunResult({
      stdout: opts.stdout ?? "",
      stderr: opts.stderr ?? "",
      exit_code: opts.exit_code ?? 0,
      duration_ms: opts.duration_ms ?? 0,
    }),
    cwd: opts.cwd ?? ".",
  };
}

function noRunCtx(cwd = "."): AssertCtx {
  return { result: undefined, cwd };
}

// ---- exit_code -------------------------------------------------------

describe("exit_code", () => {
  it("equals pass", () => {
    const r = evaluateAssertion({ type: "exit_code", equals: 0 } as any, ctx({ exit_code: 0 }));
    expect(r.ok).toBe(true);
  });

  it("equals fail — actual value surfaced in detail", () => {
    const r = evaluateAssertion({ type: "exit_code", equals: 0 } as any, ctx({ exit_code: 1 }));
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("1");
  });

  it("in pass", () => {
    const r = evaluateAssertion({ type: "exit_code", in: [0, 2] } as any, ctx({ exit_code: 2 }));
    expect(r.ok).toBe(true);
  });

  it("in fail", () => {
    const r = evaluateAssertion({ type: "exit_code", in: [0, 2] } as any, ctx({ exit_code: 1 }));
    expect(r.ok).toBe(false);
  });

  it("without run is failure — detail mentions 'no command'", () => {
    const r = evaluateAssertion({ type: "exit_code", equals: 0 } as any, noRunCtx());
    expect(r.ok).toBe(false);
    expect(r.detail!.toLowerCase()).toContain("no command");
  });
});

// ---- stdout_contains / stdout_not_contains ---------------------------

describe("stdout_contains", () => {
  it("pass", () => {
    expect(evaluateAssertion({ type: "stdout_contains", value: "ok" } as any, ctx({ stdout: "all ok" })).ok).toBe(true);
  });

  it("fail", () => {
    expect(evaluateAssertion({ type: "stdout_contains", value: "ok" } as any, ctx({ stdout: "nope" })).ok).toBe(false);
  });

  it("ignore_case", () => {
    expect(evaluateAssertion({ type: "stdout_contains", value: "OK", ignore_case: true } as any, ctx({ stdout: "all ok" })).ok).toBe(true);
  });
});

describe("stdout_not_contains", () => {
  it("pass", () => {
    expect(evaluateAssertion({ type: "stdout_not_contains", value: "error" } as any, ctx({ stdout: "fine" })).ok).toBe(true);
  });

  it("fail", () => {
    expect(evaluateAssertion({ type: "stdout_not_contains", value: "error" } as any, ctx({ stdout: "error: bad" })).ok).toBe(false);
  });
});

// ---- stdout_matches / stdout_not_matches ----------------------------

describe("stdout_matches", () => {
  it("pass", () => {
    expect(evaluateAssertion({ type: "stdout_matches", pattern: "\\d+ passed" } as any, ctx({ stdout: "42 passed" })).ok).toBe(true);
  });

  it("fail", () => {
    expect(evaluateAssertion({ type: "stdout_matches", pattern: "\\d+ passed" } as any, ctx({ stdout: "none" })).ok).toBe(false);
  });

  it("ignore_case", () => {
    expect(evaluateAssertion({ type: "stdout_matches", pattern: "passed", ignore_case: true } as any, ctx({ stdout: "PASSED" })).ok).toBe(true);
  });

  it("multiline anchor", () => {
    // ^ should match start of a line when multiline is on
    expect(evaluateAssertion({ type: "stdout_matches", pattern: "^done$", multiline: true } as any, ctx({ stdout: "start\ndone\nend" })).ok).toBe(true);
  });

  it("invalid regex is reported not thrown", () => {
    const r = evaluateAssertion({ type: "stdout_matches", pattern: "(" } as any, ctx({ stdout: "x" }));
    expect(r.ok).toBe(false);
    expect(r.detail!.toLowerCase()).toContain("regex");
  });
});

describe("stdout_not_matches", () => {
  it("pass", () => {
    expect(evaluateAssertion({ type: "stdout_not_matches", pattern: "FAIL" } as any, ctx({ stdout: "all green" })).ok).toBe(true);
  });

  it("fail", () => {
    expect(evaluateAssertion({ type: "stdout_not_matches", pattern: "FAIL" } as any, ctx({ stdout: "1 FAIL" })).ok).toBe(false);
  });
});

// ---- stderr_contains / stderr_matches --------------------------------

describe("stderr", () => {
  it("stderr_contains", () => {
    expect(evaluateAssertion({ type: "stderr_contains", value: "warn" } as any, ctx({ stderr: "warn: x" })).ok).toBe(true);
  });

  it("stderr_matches", () => {
    expect(evaluateAssertion({ type: "stderr_matches", pattern: "line \\d+" } as any, ctx({ stderr: "line 7" })).ok).toBe(true);
  });
});

// ---- duration_under_ms ----------------------------------------------

describe("duration_under_ms", () => {
  it("under pass", () => {
    expect(evaluateAssertion({ type: "duration_under_ms", value: 1000 } as any, ctx({ duration_ms: 10 })).ok).toBe(true);
  });

  it("under fail — actual value surfaced in detail", () => {
    const r = evaluateAssertion({ type: "duration_under_ms", value: 5 } as any, ctx({ duration_ms: 10 }));
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("10");
  });
});

// ---- file predicates -------------------------------------------------

describe("file predicates", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "gl-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function write(name: string, content: string) {
    writeFileSync(join(tmpDir, name), content, "utf8");
  }

  function fctx(): AssertCtx {
    return noRunCtx(tmpDir);
  }

  it("file_exists pass", () => {
    write("a.txt", "hi");
    expect(evaluateAssertion({ type: "file_exists", path: "a.txt" } as any, fctx()).ok).toBe(true);
  });

  it("file_exists fail", () => {
    expect(evaluateAssertion({ type: "file_exists", path: "missing.txt" } as any, fctx()).ok).toBe(false);
  });

  it("file_absent pass", () => {
    expect(evaluateAssertion({ type: "file_absent", path: "nope.txt" } as any, fctx()).ok).toBe(true);
  });

  it("file_absent fail", () => {
    write("here.txt", "x");
    expect(evaluateAssertion({ type: "file_absent", path: "here.txt" } as any, fctx()).ok).toBe(false);
  });

  it("file_contains pass", () => {
    write("c.txt", "hello world");
    expect(evaluateAssertion({ type: "file_contains", path: "c.txt", value: "world" } as any, fctx()).ok).toBe(true);
  });

  it("file_contains missing file fails clearly — detail mentions 'not'", () => {
    const r = evaluateAssertion({ type: "file_contains", path: "ghost.txt", value: "x" } as any, fctx());
    expect(r.ok).toBe(false);
    expect(r.detail!.toLowerCase()).toContain("not");
  });

  it("file_matches pass", () => {
    write("v.txt", "version = 1.2.3");
    expect(evaluateAssertion({ type: "file_matches", path: "v.txt", pattern: "\\d+\\.\\d+\\.\\d+" } as any, fctx()).ok).toBe(true);
  });

  it("file_not_matches pass", () => {
    write("prod.json", '{"debug": false}');
    expect(evaluateAssertion({ type: "file_not_matches", path: "prod.json", pattern: '"debug"\\s*:\\s*true' } as any, fctx()).ok).toBe(true);
  });

  it("file_not_matches fail", () => {
    write("prod.json", '{"debug": true}');
    expect(evaluateAssertion({ type: "file_not_matches", path: "prod.json", pattern: '"debug"\\s*:\\s*true' } as any, fctx()).ok).toBe(false);
  });

  // file_not_matches with absent file should PASS (the forbidden pattern can't be in a non-existent file)
  it("file_not_matches with absent file is a pass", () => {
    const r = evaluateAssertion({ type: "file_not_matches", path: "absent.json", pattern: "anything" } as any, fctx());
    expect(r.ok).toBe(true);
  });
});

// ---- json_path -------------------------------------------------------

describe("json_path", () => {
  it("stdout json_path pass", () => {
    const r = evaluateAssertion(
      { type: "json_path", query: "status", equals: "ok" } as any,
      ctx({ stdout: '{"status": "ok"}' })
    );
    expect(r.ok).toBe(true);
  });

  it("stdout json_path nested and index", () => {
    const r = evaluateAssertion(
      { type: "json_path", query: "data.items.1.id", equals: 7 } as any,
      ctx({ stdout: '{"data": {"items": [{"id": 3}, {"id": 7}]}}' })
    );
    expect(r.ok).toBe(true);
  });

  it("json_path value mismatch fails — detail mentions actual value", () => {
    const r = evaluateAssertion(
      { type: "json_path", query: "status", equals: "ok" } as any,
      ctx({ stdout: '{"status": "bad"}' })
    );
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("bad");
  });

  it("json_path type sensitivity: number 1 must not equal string '1'", () => {
    const r = evaluateAssertion(
      { type: "json_path", query: "n", equals: "1" } as any,
      ctx({ stdout: '{"n": 1}' })
    );
    expect(r.ok).toBe(false);
  });

  it("json_path invalid JSON fails clearly — detail mentions 'json'", () => {
    const r = evaluateAssertion(
      { type: "json_path", query: "x", equals: 1 } as any,
      ctx({ stdout: "not json" })
    );
    expect(r.ok).toBe(false);
    expect(r.detail!.toLowerCase()).toContain("json");
  });

  it("json_path missing key fails clearly", () => {
    const r = evaluateAssertion(
      { type: "json_path", query: "a.b.c", equals: 1 } as any,
      ctx({ stdout: '{"a": {}}' })
    );
    expect(r.ok).toBe(false);
  });

  it("json_path from file", () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-json-"));
    try {
      writeFileSync(join(dir, "r.json"), '{"ok": true}', "utf8");
      const r = evaluateAssertion(
        { type: "json_path", source: "file", path: "r.json", query: "ok", equals: true } as any,
        noRunCtx(dir)
      );
      expect(r.ok).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Typed equality: int vs float coercion — in JS all numbers are floats so 1 === 1.0
  it("json_path int/float coercion: 1 equals 1.0 (both are numbers in JS)", () => {
    const r = evaluateAssertion(
      { type: "json_path", query: "n", equals: 1.0 } as any,
      ctx({ stdout: '{"n": 1}' })
    );
    expect(r.ok).toBe(true);
  });

  // bool is NOT numeric — true must not equal 1
  it("json_path bool is NOT numeric: true does NOT equal 1", () => {
    const r = evaluateAssertion(
      { type: "json_path", query: "n", equals: 1 } as any,
      ctx({ stdout: '{"n": true}' })
    );
    expect(r.ok).toBe(false);
  });

  it("json_path bool is NOT numeric: 1 does NOT equal true", () => {
    const r = evaluateAssertion(
      { type: "json_path", query: "b", equals: true } as any,
      ctx({ stdout: '{"b": 1}' })
    );
    expect(r.ok).toBe(false);
  });

  it("json_path bool true equals bool true (identity)", () => {
    const r = evaluateAssertion(
      { type: "json_path", query: "b", equals: true } as any,
      ctx({ stdout: '{"b": true}' })
    );
    expect(r.ok).toBe(true);
  });

  it("json_path empty query returns root value", () => {
    // Empty query string returns the root — "42" string in JSON => actual "42", not 42
    const r = evaluateAssertion(
      { type: "json_path", query: "", equals: 42 } as any,
      ctx({ stdout: "42" })
    );
    expect(r.ok).toBe(true);
  });

  it("json_path object equality is key-order-independent: {b:2,a:1} equals {a:1,b:2}", () => {
    // Positive case: key order in 'equals' differs from key order in actual JSON — must still pass
    const r = evaluateAssertion(
      { type: "json_path", query: "", equals: { b: 2, a: 1 } } as any,
      ctx({ stdout: '{"a":1,"b":2}' })
    );
    expect(r.ok).toBe(true);
  });

  it("json_path object equality fails when a nested value differs", () => {
    // Negative case: same keys but one nested value differs
    const r = evaluateAssertion(
      { type: "json_path", query: "", equals: { a: 1, b: 99 } } as any,
      ctx({ stdout: '{"a":1,"b":2}' })
    );
    expect(r.ok).toBe(false);
  });
});

// ---- dispatch -------------------------------------------------------

describe("dispatch", () => {
  it("unknown predicate throws UnknownPredicate", () => {
    expect(() =>
      evaluateAssertion({ type: "no_such_predicate" } as any, ctx())
    ).toThrow(UnknownPredicate);
  });

  it("result carries type and non-empty summary", () => {
    const r = evaluateAssertion({ type: "exit_code", equals: 0 } as any, ctx({ exit_code: 0 }));
    expect(r.type).toBe("exit_code");
    expect(r.summary).toBeTruthy();
  });
});
