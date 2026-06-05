import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatSessionStart, formatPreCompact } from "../src/cli/hooks.js";
import { OperationalStore } from "../src/operational/store.js";

const dirs: string[] = [];
function opsFile() {
  const d = mkdtempSync(join(tmpdir(), "semkeep-hook-"));
  dirs.push(d);
  return join(d, "operational.json");
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("hook formatters", () => {
  it("SessionStart is empty string (silent) when no markers", () => {
    const store = new OperationalStore(opsFile());
    expect(formatSessionStart("/p", store)).toBe("");
  });
  it("SessionStart emits hookSpecificOutput JSON with markers", () => {
    const file = opsFile();
    new OperationalStore(file).mark("/p", {
      kind: "recipe",
      title: "run tests",
      command: "npm test",
      exitCode: 0,
    });
    const out = formatSessionStart("/p", new OperationalStore(file));
    const parsed = JSON.parse(out);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("run tests");
  });
  it("PreCompact always emits, listing known titles", () => {
    const file = opsFile();
    new OperationalStore(file).mark("/p", { kind: "note", title: "watch the cache" });
    const parsed = JSON.parse(formatPreCompact("/p", new OperationalStore(file)));
    expect(parsed.hookSpecificOutput.hookEventName).toBe("PreCompact");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("watch the cache");
  });
  it("PreCompact emits even for an empty project (no markers)", () => {
    const store = new OperationalStore(opsFile());
    const out = formatPreCompact("/empty", store);
    const parsed = JSON.parse(out);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("PreCompact");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("Nothing is recorded");
  });
  it("SessionStart includes the preamble text", () => {
    const file = opsFile();
    new OperationalStore(file).mark("/p", { kind: "gotcha", title: "don't use legacy flag" });
    const out = formatSessionStart("/p", new OperationalStore(file));
    const parsed = JSON.parse(out);
    expect(parsed.hookSpecificOutput.additionalContext).toContain("semkeep recalled");
  });
});
