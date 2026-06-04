import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { Chunk, EmbeddingProvider } from "./types.js";
import { Store } from "./store.js";
import { chunkText, DEFAULT_INCLUDE, hashContent, walk } from "./chunker.js";

export interface IndexOptions {
  include?: string[];
  exclude?: string[];
  force?: boolean;
}

export interface IndexResult {
  filesIndexed: number;
  filesSkipped: number;
  chunksAdded: number;
  embedder: string;
  elapsedMs: number;
}

/**
 * Index a directory (recursively) or a single file into the store. Files whose
 * content hash is unchanged since last index are skipped unless `force` is set.
 */
export async function indexPath(
  store: Store,
  embedder: EmbeddingProvider,
  path: string,
  opts: IndexOptions = {},
): Promise<IndexResult> {
  const started = Date.now();
  const include = opts.include ?? DEFAULT_INCLUDE;
  const exclude = opts.exclude ?? [];
  const force = opts.force ?? false;
  const root = resolve(path);

  let files: string[];
  try {
    files = statSync(root).isFile() ? [root] : walk(root, { include, exclude });
  } catch {
    throw new Error(`Path not found or unreadable: ${path}`);
  }

  let filesIndexed = 0;
  let filesSkipped = 0;
  let chunksAdded = 0;

  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue; // unreadable mid-walk; skip
    }
    const hash = hashContent(text);
    if (!force && store.fileHash(file) === hash) {
      filesSkipped++;
      continue;
    }
    const raw = chunkText(text);
    const vectors = raw.length ? await embedder.embed(raw.map((c) => c.text)) : [];
    const chunks: Chunk[] = raw.map((c, i) => ({
      id: `${hash.slice(0, 12)}:${c.startLine}`,
      file,
      startLine: c.startLine,
      endLine: c.endLine,
      text: c.text,
      vector: Array.from(vectors[i]),
    }));
    store.replaceFileChunks(file, chunks);
    store.setFileHash(file, hash);
    filesIndexed++;
    chunksAdded += chunks.length;
  }

  return {
    filesIndexed,
    filesSkipped,
    chunksAdded,
    embedder: embedder.name,
    elapsedMs: Date.now() - started,
  };
}
