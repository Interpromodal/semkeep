import { test, expect } from "vitest";
import { parseFile } from "../src/structure/parser.js";
import { extractSymbols, extractImports } from "../src/structure/symbols.js";

const SRC = `import { foo } from "./bar.js";
export function alpha(x){ return x; }
class Beta { gamma(){ return 1; } }
export const eps = 42;
interface Delta { id: string }
type Zeta = string;
enum Eta { A, B }
`;

test("extracts symbols with kinds, lines, exported, container", async () => {
  const { tree } = (await parseFile("m.ts", SRC))!;
  const syms = extractSymbols(tree, "/m.ts", "deadbeefcafe");
  const by = (n: string) => syms.find((s) => s.name === n)!;
  expect(by("alpha").kind).toBe("function");
  expect(by("alpha").exported).toBe(true);
  expect(by("alpha").startLine).toBe(2);
  expect(by("Beta").kind).toBe("class");
  expect(by("Beta").exported).toBe(false);
  expect(by("gamma").kind).toBe("method");
  expect(by("gamma").container).toBe("Beta");
  expect(by("eps").kind).toBe("const");
  expect(by("eps").exported).toBe(true);
  expect(by("Delta").kind).toBe("interface");
  expect(by("Zeta").kind).toBe("type");
  expect(by("Eta").kind).toBe("enum");
});

test("extracts import edges", async () => {
  const { tree } = (await parseFile("m.ts", SRC))!;
  const imps = extractImports(tree, "/m.ts");
  expect(imps).toHaveLength(1);
  expect(imps[0].source).toBe("./bar.js");
  expect(imps[0].names).toContain("foo");
});
