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
