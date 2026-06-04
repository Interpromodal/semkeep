import { test, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { LexicalEmbedder } from "../src/embeddings/lexical.js";
import {
  type Context,
  ensureEmbedder,
  forgetTool,
  indexPathTool,
  recallTool,
  rememberTool,
  searchTool,
  statusTool,
} from "../src/tools.js";

async function ctx(): Promise<Context> {
  const dataDir = mkdtempSync(join(tmpdir(), "mp-int-data-"));
  const store = await Store.load(dataDir);
  const embedder = new LexicalEmbedder(512);
  store.setEmbedderMeta(embedder.name, embedder.dim);
  return {
    store,
    embedder,
    degraded: true,
    config: {
      dataDir,
      ollamaHost: "http://localhost:11434",
    },
  };
}

function sampleRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "mp-int-repo-"));
  mkdirSync(join(repo, "src"));
  writeFileSync(
    join(repo, "src", "net.ts"),
    "export function backoffScheduler(){ /* exponential retry after failures */ }\n",
  );
  writeFileSync(
    join(repo, "src", "ui.ts"),
    "export function renderLoginButton(){ /* paints the button blue */ }\n",
  );
  return repo;
}

test("full flow: index -> meaning-based search -> notes round-trip -> status", async () => {
  const c = await ctx();
  const repo = sampleRepo();

  const indexMsg = await indexPathTool(c, { path: repo });
  expect(indexMsg).toMatch(/Indexed 2 file/);

  // Natural-language query (not the literal identifier) finds the right file.
  const hits = await searchTool(c, { query: "where is the retry backoff logic", k: 2 });
  expect(hits).toContain("net.ts");
  expect(hits.indexOf("net.ts")).toBeLessThan(hits.indexOf("ui.ts"));

  const remembered = await rememberTool(c, { text: "auth uses JWT in the api layer", tags: ["auth"] });
  expect(remembered).toMatch(/Remembered as (n_\w+)/);
  const id = remembered.match(/n_\w+/)![0];

  const recalled = await recallTool(c, { query: "how does login authentication work" });
  expect(recalled).toContain("JWT");

  expect(await forgetTool(c, { id })).toContain("Forgot");

  const status = statusTool(c);
  expect(status).toContain("DEGRADED"); // lexical fallback advertised honestly
  expect(status).toContain("protocol:");
});

test("never-fail: changing the embedder dimension rebuilds instead of crashing", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "mp-mig-"));
  const store = await Store.load(dataDir);
  store.setEmbedderMeta("lexical", 3); // old, tiny dimension
  store.addNote("database is postgres on Neon", ["db"], [1, 0, 0]);
  expect(store.stats().dim).toBe(3);

  // New run with a 512-dim embedder must not throw; it re-embeds notes.
  await ensureEmbedder(store, new LexicalEmbedder(512));
  expect(store.stats().dim).toBe(512);
  expect(store.stats().noteCount).toBe(1);
  expect(store.exportNotes()[0].vector).toHaveLength(512);
  expect(store.stats().chunkCount).toBe(0); // code index dropped for rebuild
});
