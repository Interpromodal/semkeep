import { test, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { indexPath } from "../src/indexer.js";
import { freshen } from "../src/freshen.js";
import { LexicalEmbedder } from "../src/embeddings/lexical.js";

async function setup() {
  const repo = mkdtempSync(join(tmpdir(), "mp-frq-repo-"));
  writeFileSync(join(repo, "a.ts"), "export function alpha(){ return 1 }\n");
  const store = await Store.load(mkdtempSync(join(tmpdir(), "mp-frq-data-")));
  const emb = new LexicalEmbedder(256);
  store.setEmbedderMeta(emb.name, emb.dim);
  await indexPath(store, emb, repo);
  return { repo, store, emb };
}

test("freshen indexes a NEW file", async () => {
  const { repo, store, emb } = await setup();
  writeFileSync(join(repo, "b.ts"), "export function beta(){ return 2 }\n");
  const r = await freshen(store, emb);
  expect(r.added).toBe(1);
  expect(store.findDefinitions("beta")).toHaveLength(1);
});

test("freshen re-indexes a CHANGED file", async () => {
  const { repo, store, emb } = await setup();
  writeFileSync(
    join(repo, "a.ts"),
    "export function alpha(){ return 1 }\nexport function gamma(){ return 3 }\n",
  );
  const r = await freshen(store, emb);
  expect(r.reindexed).toBe(1);
  expect(store.findDefinitions("gamma")).toHaveLength(1);
});

test("freshen PRUNES a deleted file", async () => {
  const { repo, store, emb } = await setup();
  rmSync(join(repo, "a.ts"));
  const r = await freshen(store, emb);
  expect(r.pruned).toBe(1);
  expect(store.findDefinitions("alpha")).toHaveLength(0);
});

test("freshen is a no-op when nothing changed", async () => {
  const { store, emb } = await setup();
  const r = await freshen(store, emb);
  expect(r.added).toBe(0);
  expect(r.reindexed).toBe(0);
  expect(r.pruned).toBe(0);
});
