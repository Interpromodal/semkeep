// Acceptance: anchor a note to a symbol; it surfaces in define and stays recallable.
import { Store } from "../dist/store.js";
import { LexicalEmbedder } from "../dist/embeddings/lexical.js";
import { indexPathTool, rememberTool, defineTool, recallTool } from "../dist/tools.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "semkeep-notes-data-"));
const store = await Store.load(dataDir);
const emb = new LexicalEmbedder(256);
store.setEmbedderMeta(emb.name, emb.dim);
const ctx = { store, embedder: emb, degraded: true, config: { dataDir, ollamaHost: "http://localhost:11434", autoRefresh: false, refreshDebounceMs: 0 } };

const repo = mkdtempSync(join(tmpdir(), "semkeep-notes-repo-"));
writeFileSync(join(repo, "net.ts"), "export function backoffScheduler(){ return retry() }\n");
await indexPathTool(ctx, { path: repo });

console.log("remember (anchored to @backoffScheduler):");
console.log("  " + (await rememberTool(ctx, { text: "drops events under load; needs jitter", tags: ["bug"], symbol: "backoffScheduler" })));
console.log("\ndefine backoffScheduler:");
console.log((await defineTool(ctx, { name: "backoffScheduler" })).replace(/^/gm, "  "));
console.log("\nrecall 'flaky retry under load':");
console.log((await recallTool(ctx, { query: "flaky retry under load" })).replace(/^/gm, "  "));
console.log("\ndefine unrelated (should show no note):");
console.log("  " + (await defineTool(ctx, { name: "unrelated" })));
