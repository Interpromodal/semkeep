/**
 * Shared types for semkeep. Defined once, referenced everywhere.
 */

/** A pluggable embedding backend. `embed` MUST return L2-normalized vectors. */
export interface EmbeddingProvider {
  readonly name: string;
  readonly dim: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}

/** One indexed slice of a file. */
export interface Chunk {
  id: string; // stable: `${fileHash.slice(0,12)}:${startLine}`
  file: string; // absolute path
  startLine: number; // 1-based, inclusive
  endLine: number; // 1-based, inclusive
  text: string;
  vector: number[]; // L2-normalized
  symbolName?: string; // owning symbol, when chunked on a symbol boundary
  kind?: SymbolKind;
}

export type SymbolKind =
  | "function"
  | "class"
  | "method"
  | "interface"
  | "type"
  | "enum"
  | "const"
  | "variable";

/** A code symbol (definition) extracted from an AST. Named CodeSymbol to avoid
 * shadowing JavaScript's global `Symbol`. */
export interface CodeSymbol {
  id: string; // `${fileHash.slice(0,12)}:${startLine}:${name}`
  file: string;
  name: string;
  kind: SymbolKind;
  startLine: number; // 1-based inclusive
  endLine: number; // 1-based inclusive
  exported: boolean;
  container?: string; // enclosing symbol (e.g. the class of a method)
  signature?: string; // first source line, trimmed, for display
}

/** A module import edge: `file` imports `names` from `source`. */
export interface ImportEdge {
  file: string; // importing file (absolute)
  source: string; // module specifier, e.g. "./bar.js" or "zod"
  names: string[]; // imported names, or ["*"] / ["default"]
}

/** A call/usage site of a named symbol (for `callers`). Identifier-aware: only
 * collected from call/new expression callees, so strings/comments are excluded. */
export interface Reference {
  file: string;
  name: string;
  line: number; // 1-based
}

/** Optional link from a note to code (name-based, survives edits). */
export interface NoteAnchor {
  symbol?: string; // a symbol name
  file?: string; // absolute path scope (optional)
}

/** A durable working note written by the agent. */
export interface Note {
  id: string; // `n_<sha1[0..10]>`
  text: string;
  tags: string[];
  vector: number[]; // L2-normalized
  createdAt: number; // Date.now()
  anchor?: NoteAnchor;
}

/** On-disk store shape. */
/** An indexed target (passed to index_path) the server keeps fresh. */
export interface IndexRoot {
  path: string; // absolute
  include?: string[];
  exclude?: string[];
}

/** Cheap per-file change signature (no read required). */
export interface FileStat {
  mtime: number; // statSync().mtimeMs
  size: number;
}

export interface StoreData {
  meta: { embedder: string; dim: number; version: number };
  files: Record<string, string>; // path -> contentHash, for skip-unchanged
  fileStats: Record<string, FileStat>; // path -> stat signature, for freshness checks
  chunks: Chunk[];
  notes: Note[];
  symbols: CodeSymbol[];
  imports: ImportEdge[];
  references: Reference[];
  roots: IndexRoot[];
}

/** A ranked code search result. */
export interface SearchHit {
  file: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
}
