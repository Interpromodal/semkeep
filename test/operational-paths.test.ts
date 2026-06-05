import { describe, it, expect, afterEach } from "vitest";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { resolveProject, defaultOpsStorePath } from "../src/operational/paths.js";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("resolveProject", () => {
  it("uses the explicit arg first, resolved to absolute", () => {
    expect(resolveProject("foo/bar")).toBe(resolve("foo/bar"));
  });
  it("falls back to SEMKEEP_PROJECT, then CLAUDE_PROJECT_DIR, then cwd", () => {
    delete process.env.SEMKEEP_PROJECT;
    process.env.CLAUDE_PROJECT_DIR = resolve("/tmp/claudeproj");
    expect(resolveProject()).toBe(resolve("/tmp/claudeproj"));
    process.env.SEMKEEP_PROJECT = resolve("/tmp/semkeepproj");
    expect(resolveProject()).toBe(resolve("/tmp/semkeepproj"));
  });
});

describe("defaultOpsStorePath", () => {
  it("defaults to ~/.semkeep/operational.json", () => {
    delete process.env.SEMKEEP_OPS_STORE;
    expect(defaultOpsStorePath()).toBe(join(homedir(), ".semkeep", "operational.json"));
  });
  it("honors SEMKEEP_OPS_STORE, resolved to absolute", () => {
    process.env.SEMKEEP_OPS_STORE = "rel/ops.json";
    expect(defaultOpsStorePath()).toBe(resolve("rel/ops.json"));
  });
});
