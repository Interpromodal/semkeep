import { test, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";

test("symbols/imports/references persist and answer structural queries", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mp-st-"));
  const s = await Store.load(dir);
  s.setEmbedderMeta("lexical", 3);

  s.replaceFileSymbols(
    "/r/a.ts",
    [
      { id: "1", file: "/r/a.ts", name: "alpha", kind: "function", startLine: 2, endLine: 4, exported: true },
      { id: "2", file: "/r/a.ts", name: "Beta", kind: "class", startLine: 6, endLine: 8, exported: false },
    ],
    [{ file: "/r/a.ts", source: "./b.js", names: ["foo"] }],
    [{ file: "/r/a.ts", name: "foo", line: 3 }],
  );
  s.replaceFileSymbols(
    "/r/b.ts",
    [{ id: "3", file: "/r/b.ts", name: "foo", kind: "function", startLine: 1, endLine: 2, exported: true }],
    [],
  );

  expect(s.findDefinitions("alpha")[0].file).toBe("/r/a.ts");
  expect(s.outline("/r/a.ts").map((x) => x.name)).toEqual(["alpha", "Beta"]);
  expect(s.importsOf("/r/a.ts")[0].source).toBe("./b.js");
  expect(s.importedBy("/r/b.ts").map((i) => i.file)).toContain("/r/a.ts");

  const refs = s.findReferences("foo");
  expect(refs.map((r) => `${r.file}:${r.line}`)).toContain("/r/a.ts:3"); // call site
  expect(refs.map((r) => `${r.file}:${r.line}`)).not.toContain("/r/b.ts:1"); // def excluded
  expect(s.stats().symbolCount).toBe(3);

  await s.save();
  const s2 = await Store.load(dir);
  expect(s2.stats().symbolCount).toBe(3);
  expect(s2.findDefinitions("Beta")[0].kind).toBe("class");
});
