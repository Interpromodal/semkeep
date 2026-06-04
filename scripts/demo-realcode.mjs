// Demo: index this project's own src/ and run natural-language queries against
// real code (forced lexical = the honest current backend; offline).
import { Store } from "../dist/store.js";
import { LexicalEmbedder } from "../dist/embeddings/lexical.js";
import { indexPath } from "../dist/indexer.js";
import { search } from "../dist/search.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const store = await Store.load(mkdtempSync(join(tmpdir(), "mp-demo-")));
const emb = new LexicalEmbedder(512);
store.setEmbedderMeta(emb.name, emb.dim);

const r = await indexPath(store, emb, "src");
console.log(`Indexed ${r.filesIndexed} files / ${r.chunksAdded} chunks from src/\n`);

const queries = [
  "how do we avoid storing duplicate notes",
  "the fallback used when no embedding backend is available",
  "split code identifiers like camelCase into separate words",
  "atomic write of the json store to disk",
];

for (const q of queries) {
  const hits = await search(store, emb, q, { k: 1 });
  const h = hits[0];
  console.log(`Q: "${q}"`);
  console.log(`→ ${h.file.replace(process.cwd(), ".")}:${h.startLine}-${h.endLine}  (score ${h.score.toFixed(3)})`);
  console.log(`   ${h.snippet.split("\n")[0].trim()}\n`);
}
