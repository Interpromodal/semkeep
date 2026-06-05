import { test, expect } from "vitest";
import { parseFile } from "../src/structure/parser.js";
import { langIdFor } from "../src/structure/grammars.js";

test("langIdFor maps extensions", () => {
  expect(langIdFor("a.ts")).toBe("typescript");
  expect(langIdFor("a.tsx")).toBe("tsx");
  expect(langIdFor("a.js")).toBe("javascript");
  expect(langIdFor("a.mjs")).toBe("javascript");
  expect(langIdFor("a.md")).toBeNull();
  expect(langIdFor("noext")).toBeNull();
});

test("parseFile returns a tree for TS, null for non-code", async () => {
  const ok = await parseFile("x.ts", "export function f(){ return 1 }");
  expect(ok).not.toBeNull();
  expect(ok!.lang).toBe("typescript");
  expect(ok!.tree.rootNode.namedChildren.length).toBeGreaterThan(0);
  expect(await parseFile("x.md", "# hi")).toBeNull();
});
