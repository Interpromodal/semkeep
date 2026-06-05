// Structural-win demo: index an unfamiliar codebase and answer questions that
// grep ("schema"=1039 hits) and plain semantic (false leads) both flailed on.
// Uses the lexical embedder (fast) — structural tools query symbols, not vectors.
import { loadConfig } from "../dist/config.js";
import { Store } from "../dist/store.js";
import { indexPath } from "../dist/indexer.js";
import { LexicalEmbedder } from "../dist/embeddings/lexical.js";
import { defineTool, callersTool, importsTool } from "../dist/tools.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CORPUS = process.argv[2] || "F:/Dreams/mp-eval-sdk";
const store = await Store.load(mkdtempSync(join(tmpdir(), "mp-struct-")));
const emb = new LexicalEmbedder(256);
store.setEmbedderMeta(emb.name, emb.dim);
const ctx = { store, embedder: emb, degraded: true, config: loadConfig() };

const r = await indexPath(store, emb, CORPUS);
console.log(`Indexed ${r.filesIndexed} files / ${r.symbolsAdded} symbols / ${r.chunksAdded} chunks in ${(r.elapsedMs / 1000).toFixed(1)}s\n`);

const rel = (s) => s.replaceAll(CORPUS, ".").replaceAll("\\", "/");

console.log("Q: where is validateToolInput defined?");
console.log("→ define:\n" + rel(await defineTool(ctx, { name: "validateToolInput" })) + "\n");

console.log("Q: who calls validateToolInput?");
console.log("→ callers:\n" + rel(await callersTool(ctx, { name: "validateToolInput" })) + "\n");

console.log("Q: what does server/mcp.js import?");
console.log("→ imports (out, first 6):\n" + rel(await importsTool(ctx, { path: join(CORPUS, "server", "mcp.js"), direction: "out" })).split("\n").slice(0, 7).join("\n"));
