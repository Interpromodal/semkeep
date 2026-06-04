import { test, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { walk, chunkText, hashContent, DEFAULT_INCLUDE } from "../src/chunker.js";

function repo() {
  const d = mkdtempSync(join(tmpdir(), "mp-repo-"));
  writeFileSync(join(d, "a.ts"), "line1\nline2\nline3\n");
  mkdirSync(join(d, "node_modules"));
  writeFileSync(join(d, "node_modules", "junk.ts"), "ignored\n");
  writeFileSync(join(d, "pic.png"), Buffer.from([0, 1, 2, 0, 3])); // NUL byte => binary
  return d;
}

test("walk includes code files, ignores node_modules and binaries", () => {
  const files = walk(repo(), { include: DEFAULT_INCLUDE, exclude: [] });
  expect(files.some((f) => f.endsWith("a.ts"))).toBe(true);
  expect(files.some((f) => f.includes("node_modules"))).toBe(false);
  expect(files.some((f) => f.endsWith("pic.png"))).toBe(false);
});

test("walk honors explicit exclude substrings", () => {
  const d = repo();
  writeFileSync(join(d, "skipme.ts"), "x\n");
  const files = walk(d, { include: DEFAULT_INCLUDE, exclude: ["skipme"] });
  expect(files.some((f) => f.endsWith("skipme.ts"))).toBe(false);
  expect(files.some((f) => f.endsWith("a.ts"))).toBe(true);
});

test("chunkText produces line-aware windows with overlap", () => {
  const text = Array.from({ length: 120 }, (_, i) => `L${i + 1}`).join("\n");
  const chunks = chunkText(text, 50, 10);
  expect(chunks[0].startLine).toBe(1);
  expect(chunks[0].endLine).toBe(50);
  expect(chunks[1].startLine).toBe(41); // step = window - overlap = 40
  expect(chunks.at(-1)!.endLine).toBe(120);
  // text content carries the right lines
  expect(chunks[0].text.startsWith("L1\n")).toBe(true);
});

test("chunkText handles short files as a single chunk", () => {
  const chunks = chunkText("a\nb\nc", 50, 10);
  expect(chunks).toHaveLength(1);
  expect(chunks[0].startLine).toBe(1);
  expect(chunks[0].endLine).toBe(3);
});

test("hashContent is stable and sensitive", () => {
  expect(hashContent("abc")).toBe(hashContent("abc"));
  expect(hashContent("abc")).not.toBe(hashContent("abd"));
});
