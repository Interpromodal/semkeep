import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { markTool, markersTool, unmarkTool } from "../src/tools.js";

const dirs: string[] = [];
function opsFile(): string {
  const d = mkdtempSync(join(tmpdir(), "semkeep-opstool-"));
  dirs.push(d);
  return join(d, "operational.json");
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  delete process.env.SEMKEEP_OPS_STORE;
  delete process.env.SEMKEEP_PROJECT;
});

describe("operational tools", () => {
  it("mark → markers → unmark round-trip via the resolved project", async () => {
    process.env.SEMKEEP_OPS_STORE = opsFile();
    process.env.SEMKEEP_PROJECT = "/proj/x";

    const made = await markTool({ kind: "recipe", title: "run tests", command: "npm test", exitCode: 0 });
    expect(made).toMatch(/Added recipe/);

    const list = await markersTool({});
    expect(list).toContain("run tests");
    expect(list).toContain("`npm test`");

    const idMatch = made.match(/`([a-z]{3}_[^`]+)`/);
    expect(idMatch).toBeTruthy();
    const gone = await unmarkTool({ id: idMatch![1] });
    expect(gone).toMatch(/Forgot|Unmarked/);
    expect(await markersTool({})).toMatch(/No operational markers/);
  });

  it("markers is silent-friendly and respects kind filter", async () => {
    process.env.SEMKEEP_OPS_STORE = opsFile();
    await markTool({ kind: "gotcha", title: "flaky", project: "/proj/y" });
    const recipes = await markersTool({ project: "/proj/y", kind: "recipe" });
    expect(recipes).toMatch(/No operational markers/);
    const gotchas = await markersTool({ project: "/proj/y", kind: "gotcha" });
    expect(gotchas).toContain("flaky");
  });
});
