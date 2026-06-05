import { test, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { indexPath } from "../src/indexer.js";
import { search } from "../src/search.js";
import { LexicalEmbedder } from "../src/embeddings/lexical.js";

async function indexedRepo() {
  const d = mkdtempSync(join(tmpdir(), "mp-s-"));
  writeFileSync(join(d, "net.ts"), "export function backoffScheduler(){ /* retry attempts after failure */ }\n");
  writeFileSync(join(d, "ui.ts"), "export function renderLoginButton(){ /* paint it blue */ }\n");
  const store = await Store.load(mkdtempSync(join(tmpdir(), "mp-d-")));
  const emb = new LexicalEmbedder(512);
  store.setEmbedderMeta(emb.name, emb.dim);
  await indexPath(store, emb, d);
  return { store, emb, d };
}

test("natural-language query finds the right code chunk", async () => {
  const { store, emb } = await indexedRepo();
  const hits = await search(store, emb, "where is the retry backoff logic", { k: 3 });
  expect(hits.length).toBeGreaterThan(0);
  expect(hits[0].file.endsWith("net.ts")).toBe(true);
  expect(hits[0].score).toBeGreaterThan(0);
});

test("ext scoping restricts the corpus", async () => {
  const { store, emb, d } = await indexedRepo();
  writeFileSync(join(d, "notes.md"), "retry backoff strategy explained\n");
  await indexPath(store, emb, d);
  const onlyMd = await search(store, emb, "retry backoff", { k: 5, ext: ["md"] });
  expect(onlyMd.length).toBe(1);
  expect(onlyMd[0].file.endsWith("notes.md")).toBe(true);
});

test("empty index returns no hits (no crash)", async () => {
  const store = await Store.load(mkdtempSync(join(tmpdir(), "mp-empty-")));
  const emb = new LexicalEmbedder(64);
  store.setEmbedderMeta(emb.name, emb.dim);
  const hits = await search(store, emb, "anything", { k: 5 });
  expect(hits).toEqual([]);
});

test("hybrid boost scans the FULL chunk text, not just the snippet", async () => {
  // Stub embedder: any query -> [1,0,0]. Chunk vectors are set directly below.
  const stub = {
    name: "stub",
    dim: 3,
    async embed(texts: string[]) {
      return texts.map(() => Float32Array.from([1, 0, 0]));
    },
  };
  const store = await Store.load(mkdtempSync(join(tmpdir(), "mp-hy-")));
  store.setEmbedderMeta(stub.name, stub.dim);
  // B: higher cosine (1.0), but the keyword 'alpha' never appears.
  store.replaceFileChunks("/r/b.ts", [
    { id: "b", file: "/r/b.ts", startLine: 1, endLine: 3, text: "beta gamma\ndelta epsilon\nzeta eta", vector: [1, 0, 0] },
  ]);
  // A: lower cosine (0.8), and 'alpha' appears on line 5 — OUTSIDE the 3-line snippet.
  store.replaceFileChunks("/r/a.ts", [
    { id: "a", file: "/r/a.ts", startLine: 1, endLine: 5, text: "line one\nline two\nline three\nfiller line\nthe alpha keyword here", vector: [0.8, 0, 0] },
  ]);
  const hits = await search(store, stub as any, "alpha", { k: 2, mode: "hybrid" });
  // Full-text boost must lift A (keyword deep in body) above B (higher cosine, no keyword).
  expect(hits[0].file).toBe("/r/a.ts");
});
