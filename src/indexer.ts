import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type {
  Chunk,
  CodeSymbol,
  EmbeddingProvider,
  FileStat,
  ImportEdge,
  Reference,
} from "./types.js";
import { Store } from "./store.js";
import { DEFAULT_INCLUDE, hashContent, walk } from "./chunker.js";
import { parseFile } from "./structure/parser.js";
import { extractImports, extractReferences, extractSymbols } from "./structure/symbols.js";
import { symbolChunks } from "./structure/chunkBySymbol.js";

export interface IndexOptions {
  include?: string[];
  exclude?: string[];
  force?: boolean;
}

export interface IndexResult {
  filesIndexed: number;
  filesSkipped: number;
  chunksAdded: number;
  symbolsAdded: number;
  embedder: string;
  elapsedMs: number;
}

/**
 * Index one file's content: parse → symbols/imports/references → symbol-aligned
 * chunks → embed → store, plus the content hash and stat signature. Shared by
 * `indexPath` and `freshen` (DRY).
 */
export async function indexFile(
  store: Store,
  embedder: EmbeddingProvider,
  file: string,
  text: string,
  hash: string,
  sig: FileStat,
): Promise<{ chunksAdded: number; symbolsAdded: number }> {
  let symbols: CodeSymbol[] = [];
  let imports: ImportEdge[] = [];
  let references: Reference[] = [];
  const parsed = await parseFile(file, text);
  if (parsed) {
    symbols = extractSymbols(parsed.tree, file, hash);
    imports = extractImports(parsed.tree, file);
    references = extractReferences(parsed.tree, file);
  }
  store.replaceFileSymbols(file, symbols, imports, references);

  const raw = symbolChunks(text, symbols);
  const vectors = raw.length ? await embedder.embed(raw.map((c) => c.text)) : [];
  const chunks: Chunk[] = raw.map((c, i) => ({
    id: `${hash.slice(0, 12)}:${c.startLine}`,
    file,
    startLine: c.startLine,
    endLine: c.endLine,
    text: c.text,
    vector: Array.from(vectors[i]),
    symbolName: c.symbolName,
    kind: c.kind,
  }));
  store.replaceFileChunks(file, chunks);
  store.setFileHash(file, hash);
  store.setFileStat(file, sig);
  return { chunksAdded: chunks.length, symbolsAdded: symbols.length };
}

/**
 * Index a directory (recursively) or a single file. Records the root for later
 * freshening, and skips files whose content hash is unchanged (unless `force`).
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
  store.setRoot(root, { include: opts.include, exclude: opts.exclude });

  let filesIndexed = 0;
  let filesSkipped = 0;
  let chunksAdded = 0;
  let symbolsAdded = 0;

  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue; // unreadable mid-walk; skip
    }
    let st;
    try {
      st = statSync(file);
    } catch {
      continue;
    }
    const sig: FileStat = { mtime: st.mtimeMs, size: st.size };
    const hash = hashContent(text);
    if (!force && store.fileHash(file) === hash) {
      store.setFileStat(file, sig); // keep stat current so freshen's fast path holds
      filesSkipped++;
      continue;
    }
    const r = await indexFile(store, embedder, file, text, hash, sig);
    filesIndexed++;
    chunksAdded += r.chunksAdded;
    symbolsAdded += r.symbolsAdded;
  }

  return {
    filesIndexed,
    filesSkipped,
    chunksAdded,
    symbolsAdded,
    embedder: embedder.name,
    elapsedMs: Date.now() - started,
  };
}
