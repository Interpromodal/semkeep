import { test, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";

test("notes anchor to a symbol/file and are queryable", async () => {
  const s = await Store.load(mkdtempSync(join(tmpdir(), "mp-na-")));
  s.setEmbedderMeta("lexical", 3);
  s.addNote("retry path drops events", ["bug"], [1, 0, 0], { symbol: "backoffScheduler", file: "/r/net.ts" });
  expect(s.notesForSymbol("backoffScheduler")[0].text).toContain("retry path");
  expect(s.notesForFile("/r/net.ts", [])[0].text).toContain("retry path"); // by file
  expect(s.notesForFile("/other.ts", ["backoffScheduler"])[0].text).toContain("retry path"); // by symbol-in-file
  expect(s.notesForSymbol("nope")).toHaveLength(0);
});

test("re-remembering the same text with a new anchor re-anchors (no duplicate)", async () => {
  const s = await Store.load(mkdtempSync(join(tmpdir(), "mp-na2-")));
  s.setEmbedderMeta("lexical", 3);
  const r1 = s.addNote("flaky under load", [], [1, 0, 0], { symbol: "alpha" });
  const r2 = s.addNote("flaky under load", [], [1, 0, 0], { symbol: "beta" });
  expect(r2.deduped).toBe(true);
  expect(r2.id).toBe(r1.id);
  expect(s.notesForSymbol("beta")).toHaveLength(1); // re-anchored
  expect(s.notesForSymbol("alpha")).toHaveLength(0);
  expect(s.stats().noteCount).toBe(1);
});

test("searchNotes returns the anchor", async () => {
  const s = await Store.load(mkdtempSync(join(tmpdir(), "mp-na3-")));
  s.setEmbedderMeta("lexical", 3);
  s.addNote("auth uses JWT", [], [1, 0, 0], { symbol: "login" });
  expect(s.searchNotes([1, 0, 0], 1)[0].anchor?.symbol).toBe("login");
});
