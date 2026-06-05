import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGreenlightCli } from "../src/cli/greenlight-cli.js";

const dirs: string[] = [];
function tempDir() {
  const d = mkdtempSync(join(tmpdir(), "semkeep-gl-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

// Reset process.exitCode before each test
beforeEach(() => {
  process.exitCode = undefined;
});

describe("runGreenlightCli – init", () => {
  it("writes a starter greenlight.json to the given path", async () => {
    const dir = tempDir();
    const path = join(dir, "greenlight.json");
    await runGreenlightCli(["init", path]);
    expect(existsSync(path)).toBe(true);
    const content = JSON.parse(readFileSync(path, "utf8"));
    expect(content).toHaveProperty("name");
    expect(content).toHaveProperty("checks");
    expect(Array.isArray(content.checks)).toBe(true);
    expect(process.exitCode).toBeUndefined(); // no error
  });

  it("refuses to overwrite an existing file and sets exitCode 2", async () => {
    const dir = tempDir();
    const path = join(dir, "greenlight.json");
    writeFileSync(path, '{"existing":true}');
    await runGreenlightCli(["init", path]);
    expect(process.exitCode).toBe(2);
    // original file unchanged
    expect(JSON.parse(readFileSync(path, "utf8"))).toHaveProperty("existing");
  });
});

describe("runGreenlightCli – lint", () => {
  it("lints a valid spec file and reports no warnings", async () => {
    const dir = tempDir();
    const specPath = join(dir, "spec.json");
    writeFileSync(
      specPath,
      JSON.stringify({
        name: "test-gate",
        checks: [
          {
            name: "echo check",
            run: "echo hello",
            assert: [
              { type: "exit_code", equals: 0 },
              { type: "stdout_contains", value: "hello" },
            ],
          },
        ],
      }),
    );
    await runGreenlightCli(["lint", specPath]);
    // exitCode should not be set to non-zero for a clean lint
    expect(process.exitCode).toBeUndefined();
  });

  it("sets exitCode 2 for a missing spec file", async () => {
    await runGreenlightCli(["lint", "/nonexistent/path/spec.json"]);
    expect(process.exitCode).toBe(2);
  });
});

describe("runGreenlightCli – run", () => {
  it("exits 0 (GREEN) when all checks pass", async () => {
    const dir = tempDir();
    const markerFile = join(dir, "marker.txt");
    writeFileSync(markerFile, "present");
    const specPath = join(dir, "spec.json");
    writeFileSync(
      specPath,
      JSON.stringify({
        name: "test-gate",
        checks: [
          {
            name: "file present",
            assert: [{ type: "file_exists", path: markerFile }],
          },
        ],
      }),
    );
    await runGreenlightCli(["run", specPath]);
    expect(process.exitCode).toBe(0);
  });

  it("exits 1 (NOT GREEN) when a required check fails", async () => {
    const dir = tempDir();
    const specPath = join(dir, "spec.json");
    writeFileSync(
      specPath,
      JSON.stringify({
        name: "test-gate",
        checks: [
          {
            name: "file absent",
            assert: [{ type: "file_exists", path: join(dir, "does-not-exist.txt") }],
          },
        ],
      }),
    );
    await runGreenlightCli(["run", specPath]);
    expect(process.exitCode).toBe(1);
  });

  it("exits 2 for a bad/missing spec", async () => {
    await runGreenlightCli(["run", "/nonexistent/spec.json"]);
    expect(process.exitCode).toBe(2);
  });

  it("exits 2 for unknown subcommand", async () => {
    await runGreenlightCli(["frobnicate"]);
    expect(process.exitCode).toBe(2);
  });

  it("exits 2 when no specPath given", async () => {
    await runGreenlightCli(["run"]);
    expect(process.exitCode).toBe(2);
  });
});
