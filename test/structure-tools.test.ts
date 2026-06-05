import { test, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
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
  return { store, embedder, degraded: true, config: { dataDir, ollamaHost: "http://localhost:11434" } };
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

  const def = defineTool(c, { name: "validateToolInput" });
  expect(def).toContain("lib.ts");
  expect(def).toContain("function validateToolInput");

  expect(outlineTool(c, { path: join(repo, "lib.ts") })).toContain("validateToolInput");

  // app.ts calls validateToolInput; lib.ts only defines it (def excluded).
  const callers = callersTool(c, { name: "validateToolInput" });
  expect(callers).toContain("app.ts");
  expect(callers).not.toContain("lib.ts:1");

  expect(importsTool(c, { path: join(repo, "app.ts"), direction: "out" })).toContain("./lib.js");
});
