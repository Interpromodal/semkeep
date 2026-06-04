import { test, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, dot } from "../src/store.js";

const tmp = () => mkdtempSync(join(tmpdir(), "mp-"));

test("dot of unit vectors behaves like cosine", () => {
  expect(dot([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  expect(dot([1, 0, 0], [0, 1, 0])).toBeCloseTo(0);
});

test("searchChunks ranks by similarity and respects pathPrefix", async () => {
  const s = await Store.load(tmp());
  s.setEmbedderMeta("lexical", 3);
  s.replaceFileChunks("/repo/a.ts", [
    { id: "a1", file: "/repo/a.ts", startLine: 1, endLine: 2, text: "retry backoff", vector: [1, 0, 0] },
  ]);
  s.replaceFileChunks("/repo/b.ts", [
    { id: "b1", file: "/repo/b.ts", startLine: 1, endLine: 2, text: "blue button", vector: [0, 1, 0] },
  ]);
  const hits = s.searchChunks([1, 0, 0], 5);
  expect(hits[0].file).toBe("/repo/a.ts");
  expect(hits[0].snippet).toContain("retry");

  const scoped = s.searchChunks([1, 0, 0], 5, { pathPrefix: "/repo/b" });
  expect(scoped).toHaveLength(1);
  expect(scoped[0].file).toBe("/repo/b.ts");
});

test("replaceFileChunks drops a file's old chunks", async () => {
  const s = await Store.load(tmp());
  s.setEmbedderMeta("lexical", 3);
  s.replaceFileChunks("/repo/a.ts", [
    { id: "a1", file: "/repo/a.ts", startLine: 1, endLine: 2, text: "old", vector: [1, 0, 0] },
  ]);
  s.replaceFileChunks("/repo/a.ts", [
    { id: "a2", file: "/repo/a.ts", startLine: 1, endLine: 2, text: "new", vector: [1, 0, 0] },
  ]);
  expect(s.stats().chunkCount).toBe(1);
  expect(s.searchChunks([1, 0, 0], 5)[0].snippet).toContain("new");
});

test("addNote dedups near-identical vectors", async () => {
  const s = await Store.load(tmp());
  s.setEmbedderMeta("lexical", 3);
  const r1 = s.addNote("auth uses JWT", [], [1, 0, 0]);
  const r2 = s.addNote("auth uses JWT", [], [1, 0, 0]);
  expect(r1.deduped).toBe(false);
  expect(r2.deduped).toBe(true);
  expect(r2.id).toBe(r1.id);
  expect(s.stats().noteCount).toBe(1);
});

test("setEmbedderMeta rejects a dimension change once set", async () => {
  const s = await Store.load(tmp());
  s.setEmbedderMeta("lexical", 3);
  expect(() => s.setEmbedderMeta("openai", 1536)).toThrow();
});

test("save then load round-trips chunks and notes", async () => {
  const dir = tmp();
  const s = await Store.load(dir);
  s.setEmbedderMeta("lexical", 3);
  s.addNote("remember me", ["x"], [0, 1, 0]);
  s.replaceFileChunks("/r/a.ts", [
    { id: "a1", file: "/r/a.ts", startLine: 1, endLine: 1, text: "hi", vector: [1, 0, 0] },
  ]);
  s.setFileHash("/r/a.ts", "deadbeef");
  await s.save();

  const s2 = await Store.load(dir);
  expect(s2.stats().noteCount).toBe(1);
  expect(s2.stats().chunkCount).toBe(1);
  expect(s2.fileHash("/r/a.ts")).toBe("deadbeef");
});
