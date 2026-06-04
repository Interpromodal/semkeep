import { test, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { LexicalEmbedder } from "../src/embeddings/lexical.js";

async function noteStore() {
  const store = await Store.load(mkdtempSync(join(tmpdir(), "mp-n-")));
  const emb = new LexicalEmbedder(512);
  store.setEmbedderMeta(emb.name, emb.dim);
  return { store, emb };
}

test("recall finds the relevant note by meaning; forget removes it", async () => {
  const { store, emb } = await noteStore();
  for (const t of ["auth uses JWT tokens for sessions", "the logo color is teal", "deploys run on Vercel"]) {
    const [v] = await emb.embed([t]);
    store.addNote(t, [], Array.from(v));
  }
  const [qv] = await emb.embed(["how does authentication work"]);
  const hits = store.searchNotes(Array.from(qv), 1);
  expect(hits[0].text).toContain("JWT");

  expect(store.deleteNote(hits[0].id)).toBe(true);
  expect(store.stats().noteCount).toBe(2);
  expect(store.deleteNote("n_does_not_exist")).toBe(false);
});

test("tags are preserved through recall", async () => {
  const { store, emb } = await noteStore();
  const [v] = await emb.embed(["database is postgres on Neon"]);
  store.addNote("database is postgres on Neon", ["infra", "db"], Array.from(v));
  const [qv] = await emb.embed(["what database do we use"]);
  const hits = store.searchNotes(Array.from(qv), 1);
  expect(hits[0].tags).toEqual(["infra", "db"]);
});
