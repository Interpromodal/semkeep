import { test, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";

test("roots dedupe by path and persist; fileStats persist", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mp-fr-"));
  const s = await Store.load(dir);
  s.setEmbedderMeta("lexical", 3);
  s.setRoot("/repo", { include: ["ts"] });
  s.setRoot("/repo", { exclude: ["dist"] }); // dedupe by path
  s.setFileStat("/repo/a.ts", { mtime: 111, size: 9 });
  expect(s.roots()).toHaveLength(1);
  expect(s.roots()[0].exclude).toEqual(["dist"]);
  await s.save();
  const s2 = await Store.load(dir);
  expect(s2.roots()[0].path).toBe("/repo");
  expect(s2.fileStat("/repo/a.ts")).toEqual({ mtime: 111, size: 9 });
});

test("pruneFile removes every record type", async () => {
  const s = await Store.load(mkdtempSync(join(tmpdir(), "mp-pr-")));
  s.setEmbedderMeta("lexical", 3);
  s.replaceFileChunks("/r/a.ts", [
    { id: "c", file: "/r/a.ts", startLine: 1, endLine: 1, text: "x", vector: [1, 0, 0] },
  ]);
  s.replaceFileSymbols(
    "/r/a.ts",
    [{ id: "s", file: "/r/a.ts", name: "f", kind: "function", startLine: 1, endLine: 1, exported: true }],
    [{ file: "/r/a.ts", source: "./b.js", names: ["x"] }],
    [{ file: "/r/a.ts", name: "x", line: 1 }],
  );
  s.setFileHash("/r/a.ts", "h");
  s.setFileStat("/r/a.ts", { mtime: 1, size: 1 });

  s.pruneFile("/r/a.ts");
  expect(s.stats().chunkCount).toBe(0);
  expect(s.stats().symbolCount).toBe(0);
  expect(s.stats().importCount).toBe(0);
  expect(s.allIndexedFiles()).not.toContain("/r/a.ts");
  expect(s.fileStat("/r/a.ts")).toBeUndefined();
});
