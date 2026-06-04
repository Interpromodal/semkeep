// Demo: auto-detect the embedder (should pick the local all-MiniLM model now
// that @huggingface/transformers is installed), index this project's own src/,
// and run natural-language queries — TRUE semantic search, no API key.
import { loadConfig } from "../dist/config.js";
import { detect } from "../dist/embeddings/detect.js";
import { Store } from "../dist/store.js";
import { indexPath } from "../dist/indexer.js";
import { search } from "../dist/search.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const config = loadConfig();
const { provider, degraded } = await detect(config);
console.log(`Embedder: ${provider.name} (dim ${provider.dim})  degraded=${degraded}\n`);

const store = await Store.load(mkdtempSync(join(tmpdir(), "mp-sem-")));
store.setEmbedderMeta(provider.name, provider.dim);

const r = await indexPath(store, provider, "src");
console.log(`Indexed ${r.filesIndexed} files / ${r.chunksAdded} chunks in ${r.elapsedMs}ms\n`);

const queries = [
  "how do we avoid storing duplicate notes",
  "the fallback used when no embedding backend is available",
  "split code identifiers like camelCase into separate words",
  "atomic write of the json store to disk",
];

for (const q of queries) {
  const hits = await search(store, provider, q, { k: 1 });
  const h = hits[0];
  console.log(`Q: "${q}"`);
  console.log(`→ ${h.file.replace(process.cwd(), ".")}:${h.startLine}-${h.endLine}  (score ${h.score.toFixed(3)})`);
}
