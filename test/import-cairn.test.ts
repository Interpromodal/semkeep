import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importCairn } from "../src/cli/import-cairn.js";
import { OperationalStore } from "../src/operational/store.js";

const dirs: string[] = [];
function tempDir() {
  const d = mkdtempSync(join(tmpdir(), "semkeep-cairn-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  process.exitCode = undefined;
});

describe("importCairn", () => {
  it("imports markers from a fake cairn.json into the operational store", async () => {
    const dir = tempDir();
    const cairnPath = join(dir, "cairn.json");
    const opsPath = join(dir, "operational.json");
    const ts = "2025-01-01T00:00:00.000Z";
    writeFileSync(
      cairnPath,
      JSON.stringify({
        version: 1,
        projects: {
          "/p": {
            markers: [
              {
                id: "rcp_testid",
                kind: "recipe",
                title: "run tests",
                command: "npm test",
                exitCode: 0,
                createdAt: ts,
                updatedAt: ts,
                verifiedAt: ts,
              },
            ],
          },
        },
      }),
    );

    await importCairn(["--from", cairnPath, "--into", opsPath]);

    const store = new OperationalStore(opsPath);
    const markers = store.recall("/p");
    expect(markers).toHaveLength(1);
    expect(markers[0].id).toBe("rcp_testid");
    expect(markers[0].title).toBe("run tests");
    expect(markers[0].command).toBe("npm test");
    expect(markers[0].verifiedAt).toBe(ts);
    expect(markers[0].createdAt).toBe(ts);
    expect(process.exitCode).toBeUndefined();
  });

  it("does not duplicate a marker already in the destination store", async () => {
    const dir = tempDir();
    const cairnPath = join(dir, "cairn.json");
    const opsPath = join(dir, "operational.json");
    const ts = "2025-06-01T00:00:00.000Z";

    const marker = {
      id: "rcp_dup",
      kind: "recipe",
      title: "build",
      command: "npm run build",
      exitCode: 0,
      createdAt: ts,
      updatedAt: ts,
      verifiedAt: ts,
    };

    // Pre-populate the destination with the same marker
    writeFileSync(opsPath, JSON.stringify({ version: 1, projects: { "/p": { markers: [marker] } } }));

    writeFileSync(
      cairnPath,
      JSON.stringify({ version: 1, projects: { "/p": { markers: [marker] } } }),
    );

    await importCairn(["--from", cairnPath, "--into", opsPath]);

    const store = new OperationalStore(opsPath);
    const markers = store.recall("/p");
    // Should still be only 1 marker (no duplicate)
    expect(markers).toHaveLength(1);
  });

  it("sets exitCode 1 when the cairn source file does not exist", async () => {
    const dir = tempDir();
    await importCairn(["--from", join(dir, "missing.json"), "--into", join(dir, "ops.json")]);
    expect(process.exitCode).toBe(1);
  });

  it("imports from multiple projects", async () => {
    const dir = tempDir();
    const cairnPath = join(dir, "cairn.json");
    const opsPath = join(dir, "operational.json");
    const ts = "2025-01-01T00:00:00.000Z";

    writeFileSync(
      cairnPath,
      JSON.stringify({
        version: 1,
        projects: {
          "/proj1": {
            markers: [
              { id: "not_a1", kind: "note", title: "proj1 note", createdAt: ts, updatedAt: ts },
            ],
          },
          "/proj2": {
            markers: [
              { id: "gca_b2", kind: "gotcha", title: "proj2 gotcha", body: "careful!", createdAt: ts, updatedAt: ts },
            ],
          },
        },
      }),
    );

    await importCairn(["--from", cairnPath, "--into", opsPath]);

    const store = new OperationalStore(opsPath);
    expect(store.recall("/proj1")).toHaveLength(1);
    expect(store.recall("/proj2")).toHaveLength(1);
    expect(store.recall("/proj2")[0].body).toBe("careful!");
  });
});
