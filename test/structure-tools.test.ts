import { test, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { LexicalEmbedder } from "../src/embeddings/lexical.js";
import {
  type Context,
  callersTool,
  defineTool,
  importsTool,
  indexPathTool,
  outlineTool,
} from "../src/tools.js";

async function makeCtx(): Promise<Context> {
  const dataDir = mkdtempSync(join(tmpdir(), "mp-tools-data-"));
  const store = await Store.load(dataDir);
  const embedder = new LexicalEmbedder(256);
  store.setEmbedderMeta(embedder.name, embedder.dim);
  return {
    store,
    embedder,
    degraded: true,
    config: { dataDir, ollamaHost: "http://localhost:11434", autoRefresh: true, refreshDebounceMs: 0 },
  };
}

test("define / outline / callers / imports work through the handlers", async () => {
  const c = await makeCtx();
  const repo = mkdtempSync(join(tmpdir(), "mp-tools-repo-"));
  writeFileSync(join(repo, "lib.ts"), "export function validateToolInput(x){ return x }\n");
  writeFileSync(
    join(repo, "app.ts"),
    `import { validateToolInput } from "./lib.js";\nexport function run(){ return validateToolInput(1); }\n`,
  );
  await indexPathTool(c, { path: repo });

  const def = await defineTool(c, { name: "validateToolInput" });
  expect(def).toContain("lib.ts");
  expect(def).toContain("function validateToolInput");

  expect(await outlineTool(c, { path: join(repo, "lib.ts") })).toContain("validateToolInput");

  // app.ts calls validateToolInput; lib.ts only defines it (def excluded).
  const callers = await callersTool(c, { name: "validateToolInput" });
  expect(callers).toContain("app.ts");
  expect(callers).not.toContain("lib.ts:1");

  expect(await importsTool(c, { path: join(repo, "app.ts"), direction: "out" })).toContain("./lib.js");
});

test("auto-freshen reflects a deleted file on the next query", async () => {
  const c = await makeCtx();
  const repo = mkdtempSync(join(tmpdir(), "mp-fresh-repo-"));
  writeFileSync(join(repo, "keep.ts"), "export function kept(){ return 1 }\n");
  writeFileSync(join(repo, "gone.ts"), "export function removed(){ return 2 }\n");
  await indexPathTool(c, { path: repo });
  expect(await defineTool(c, { name: "removed" })).toContain("gone.ts");

  rmSync(join(repo, "gone.ts"));
  // next query auto-freshens (autoRefresh on, debounce 0) -> prunes the deleted file
  expect(await defineTool(c, { name: "removed" })).toContain("No definition");
  expect(await defineTool(c, { name: "kept" })).toContain("keep.ts");
});
