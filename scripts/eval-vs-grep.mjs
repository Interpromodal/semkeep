// Honest eval: semantic search (mind-palace) vs what Grep would do, on an
// UNFAMILIAR real codebase (the MCP SDK's compiled source). Queries are
// committed up front and ALL are reported — wins, losses, ties.
import { loadConfig } from "../dist/config.js";
import { detect } from "../dist/embeddings/detect.js";
import { Store } from "../dist/store.js";
import { indexPath } from "../dist/indexer.js";
import { search } from "../dist/search.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Stage a corpus first, e.g.:
//   cp -r node_modules/@modelcontextprotocol/sdk/dist/esm/. /tmp/mp-eval-sdk
//   (drop *.d.ts and *.map so both tools search the same implementation files)
// Then: node scripts/eval-vs-grep.mjs /tmp/mp-eval-sdk
const CORPUS = process.argv[2] || "F:/Dreams/mp-eval-sdk";

// Pre-committed: natural-language INTENT, no exact identifiers. The Grep keyword
// a developer would naturally try first is noted for the head-to-head.
const QUERIES = [
  { q: "negotiate which capabilities the client and server support during initialization", grep: "capabilit" },
  { q: "handle a request that times out and reject it", grep: "timeout" },
  { q: "parse an incoming JSON-RPC message and route it to the right handler", grep: "handler" },
  { q: "validate tool arguments against the input schema before invoking the tool", grep: "schema" },
  { q: "read and buffer messages from standard input in the stdio transport", grep: "stdin" },
  { q: "cancel an in-flight request that is still pending", grep: "cancel" },
  { q: "reconnect with exponential backoff after the connection drops", grep: "backoff" },
  { q: "enforce a maximum message size or rate limit on outgoing notifications", grep: "rate" },
];

const config = loadConfig();
const { provider, degraded } = await detect(config);
const store = await Store.load(mkdtempSync(join(tmpdir(), "mp-eval-")));
store.setEmbedderMeta(provider.name, provider.dim);
const r = await indexPath(store, provider, CORPUS);
console.log(`# Embedder: ${provider.name} (dim ${provider.dim}) degraded=${degraded}`);
console.log(`# Indexed ${r.filesIndexed} files / ${r.chunksAdded} chunks in ${(r.elapsedMs / 1000).toFixed(1)}s\n`);

for (let i = 0; i < QUERIES.length; i++) {
  const { q, grep } = QUERIES[i];
  const hits = await search(store, provider, q, { k: 3 });
  console.log(`## Q${i + 1}: ${q}`);
  console.log(`   (natural grep keyword: "${grep}")`);
  hits.forEach((h, j) => {
    const rel = h.file.replace(CORPUS, ".").replace(/\\/g, "/");
    console.log(`   [${j + 1}] ${rel}:${h.startLine}-${h.endLine}  (score ${h.score.toFixed(3)})`);
  });
  console.log("");
}
