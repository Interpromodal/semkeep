import { test, expect } from "vitest";
import { parseFile } from "../src/structure/parser.js";
import { extractSymbols } from "../src/structure/symbols.js";
import { symbolChunks } from "../src/structure/chunkBySymbol.js";
import { chunkText } from "../src/chunker.js";

test("one chunk per top-level symbol, tagged with name+kind", async () => {
  const src = "export function a(){ return 1 }\nexport function b(){ return 2 }\n";
  const { tree } = (await parseFile("m.ts", src))!;
  const chunks = symbolChunks(src, extractSymbols(tree, "/m.ts", "h"));
  const names = chunks.map((c) => c.symbolName).filter(Boolean).sort();
  expect(names).toEqual(["a", "b"]);
  expect(chunks.find((c) => c.symbolName === "a")!.kind).toBe("function");
});

test("imports/prologue before the first symbol become a fallback chunk", async () => {
  const src = `import { x } from "./x.js";\n\nexport function a(){ return 1 }\n`;
  const { tree } = (await parseFile("m.ts", src))!;
  const chunks = symbolChunks(src, extractSymbols(tree, "/m.ts", "h"));
  // the import line is covered by an untagged chunk starting at line 1
  expect(chunks.some((c) => !c.symbolName && c.text.includes("import"))).toBe(true);
  expect(chunks.some((c) => c.symbolName === "a")).toBe(true);
});

test("falls back to line windows when there are no symbols", () => {
  const text = Array.from({ length: 120 }, (_, i) => `L${i + 1}`).join("\n");
  expect(symbolChunks(text, [])).toEqual(chunkText(text));
});
