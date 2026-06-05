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

/** A durable working note written by the agent. */
export interface Note {
  id: string; // `n_<sha1[0..10]>`
  text: string;
  tags: string[];
  vector: number[]; // L2-normalized
  createdAt: number; // Date.now()
}

/** On-disk store shape. */
export interface StoreData {
  meta: { embedder: string; dim: number; version: number };
  files: Record<string, string>; // path -> contentHash, for skip-unchanged
  chunks: Chunk[];
  notes: Note[];
}

/** A ranked code search result. */
export interface SearchHit {
  file: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
}
