import { test, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { indexPath } from "../src/indexer.js";
import { LexicalEmbedder } from "../src/embeddings/lexical.js";

test("indexes files then skips unchanged on re-run", async () => {
  const d = mkdtempSync(join(tmpdir(), "mp-idx-"));
  writeFileSync(join(d, "x.ts"), "function retryWithBackoff() {}\n");
  const store = await Store.load(mkdtempSync(join(tmpdir(), "mp-data-")));
  const emb = new LexicalEmbedder(256);
  store.setEmbedderMeta(emb.name, emb.dim);

  const r1 = await indexPath(store, emb, d);
  expect(r1.filesIndexed).toBe(1);
  expect(r1.chunksAdded).toBeGreaterThan(0);
  expect(store.stats().chunkCount).toBeGreaterThan(0);

  const r2 = await indexPath(store, emb, d);
  expect(r2.filesIndexed).toBe(0); // unchanged -> skipped
  expect(r2.filesSkipped).toBe(1);
});

test("re-indexes a file after its content changes", async () => {
  const d = mkdtempSync(join(tmpdir(), "mp-idx2-"));
  const f = join(d, "y.ts");
  writeFileSync(f, "const a = 1\n");
  const store = await Store.load(mkdtempSync(join(tmpdir(), "mp-data2-")));
  const emb = new LexicalEmbedder(256);
  store.setEmbedderMeta(emb.name, emb.dim);

  await indexPath(store, emb, d);
  writeFileSync(f, "const a = 1\nconst b = 2\n");
  const r = await indexPath(store, emb, d);
  expect(r.filesIndexed).toBe(1);
});

test("indexing a single file works too", async () => {
  const d = mkdtempSync(join(tmpdir(), "mp-idx3-"));
  const f = join(d, "z.ts");
  writeFileSync(f, "export const hello = 'world'\n");
  const store = await Store.load(mkdtempSync(join(tmpdir(), "mp-data3-")));
  const emb = new LexicalEmbedder(128);
  store.setEmbedderMeta(emb.name, emb.dim);
  const r = await indexPath(store, emb, f);
  expect(r.filesIndexed).toBe(1);
});

test("indexing extracts symbols queryable via the store", async () => {
  const d = mkdtempSync(join(tmpdir(), "mp-idx-sym-"));
  writeFileSync(
    join(d, "net.ts"),
    "export function retryWithBackoff(){ return 1 }\nexport class Scheduler { tick(){} }\n",
  );
  const store = await Store.load(mkdtempSync(join(tmpdir(), "mp-data-sym-")));
  const emb = new LexicalEmbedder(128);
  store.setEmbedderMeta(emb.name, emb.dim);
  const r = await indexPath(store, emb, d);
  expect(r.symbolsAdded).toBeGreaterThanOrEqual(2);
  const def = store.findDefinitions("retryWithBackoff");
  expect(def).toHaveLength(1);
  expect(def[0].kind).toBe("function");
  expect(store.outline(def[0].file).map((s) => s.name)).toContain("Scheduler");
});
