import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { Chunk, CodeSymbol, EmbeddingProvider, ImportEdge, Reference } from "./types.js";
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
 * Index a directory (recursively) or a single file. For each (re-)indexed file:
 * parse → extract symbols/imports/references → store them, then chunk on symbol
 * boundaries (line-window fallback when unparseable). Unchanged files are skipped.
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
  let symbolsAdded = 0;

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
    symbolsAdded += symbols.length;

    const raw = symbolChunks(text, symbols); // line-window fallback when no symbols
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
    filesIndexed++;
    chunksAdded += chunks.length;
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
