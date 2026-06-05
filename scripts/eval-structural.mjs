// Structural intelligence vs grep — honest benchmark.
// The structural tools read the AST (symbols/references/imports), so they answer
// "where is X defined", "who calls X", "what does Y import", "outline Y" precisely.
// grep can only match the raw string. This harness prints semkeep's structural
// answers; the companion grep baseline (run separately) shows the noise grep
// returns for the same questions. A blind judge scores precision.
import { loadConfig } from "../dist/config.js";
import { Store } from "../dist/store.js";
import { indexPath } from "../dist/indexer.js";
import { LexicalEmbedder } from "../dist/embeddings/lexical.js";
import { defineTool, callersTool, importsTool, outlineTool } from "../dist/tools.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CORPUS = process.argv[2] || "F:/Dreams/mp-eval-sdk";
const store = await Store.load(mkdtempSync(join(tmpdir(), "mp-struct-")));
const emb = new LexicalEmbedder(256); // structural tools don't use embeddings; lexical = fast index
store.setEmbedderMeta(emb.name, emb.dim);
const ctx = { store, embedder: emb, degraded: true, config: loadConfig() };

const r = await indexPath(store, emb, CORPUS);
console.error(`indexed ${r.filesIndexed} files / ${r.symbolsAdded} symbols / ${r.chunksAdded} chunks`);

const rel = (s) => s.replaceAll(CORPUS, ".").replaceAll("\\", "/");

// Symbols with known single definitions (define + "who calls it")
const SYMBOLS = ["validateToolInput", "setRequestHandler", "mergeCapabilities", "serializeMessage"];
// Files for the import graph (out = what it imports; in = who imports it)
const IMPORTS_OUT = ["server/mcp.js"];
const IMPORTS_IN = ["shared/protocol.js"];
// Files for the symbol skeleton
const OUTLINE = ["shared/stdio.js"];

for (const name of SYMBOLS) {
  console.log(`\n## SYMBOL: ${name}`);
  console.log(`### Q(define ${name}) — "where is ${name} defined?"`);
  console.log(rel(await defineTool(ctx, { name })));
  console.log(`### Q(callers ${name}) — "who calls ${name}?"`);
  console.log(rel(await callersTool(ctx, { name })));
}
for (const f of IMPORTS_OUT) {
  console.log(`\n## IMPORTS-OUT: ${f}`);
  console.log(`### Q(imports out ${f}) — "what does ${f} import?"`);
  console.log(rel(await importsTool(ctx, { path: join(CORPUS, f), direction: "out" })));
}
for (const f of IMPORTS_IN) {
  console.log(`\n## IMPORTS-IN: ${f}`);
  console.log(`### Q(imports in ${f}) — "which files import ${f}?"`);
  console.log(rel(await importsTool(ctx, { path: join(CORPUS, f), direction: "in" })));
}
for (const f of OUTLINE) {
  console.log(`\n## OUTLINE: ${f}`);
  console.log(`### Q(outline ${f}) — "what symbols does ${f} define?"`);
  console.log(rel(await outlineTool(ctx, { path: join(CORPUS, f) })));
}
