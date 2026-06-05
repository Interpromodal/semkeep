import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type {
  Chunk,
  CodeSymbol,
  ImportEdge,
  Note,
  Reference,
  SearchHit,
  StoreData,
  SymbolKind,
} from "./types.js";

/** A scored chunk that still carries its full text + symbol tags (for re-rank). */
export type ScoredChunk = SearchHit & { text: string; symbolName?: string; kind?: SymbolKind };

const STORE_VERSION = 1;
const DEFAULT_DEDUP_THRESHOLD = 0.97;

/** Dot product. With L2-normalized inputs this equals cosine similarity. */
export function dot(a: number[] | Float32Array, b: number[] | Float32Array): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function sha1(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

function snippetOf(text: string): string {
  const lines = text.split("\n").slice(0, 3).join("\n").trim();
  return lines.length > 240 ? lines.slice(0, 240) + "…" : lines;
}

function isRelative(spec: string): boolean {
  return spec.startsWith(".") || spec.startsWith("/");
}

/** Basename without extension, lowercased — for loose import resolution. */
function baseNoExt(p: string): string {
  const base = p.replace(/\\/g, "/").split("/").pop() ?? p;
  const dot = base.lastIndexOf(".");
  return (dot === -1 ? base : base.slice(0, dot)).toLowerCase();
}

export class Store {
  private constructor(
    private readonly dataDir: string,
    private readonly file: string,
    private data: StoreData,
  ) {}

  static async load(dataDir: string): Promise<Store> {
    const file = join(dataDir, "store.json");
    let data: StoreData;
    if (existsSync(file)) {
      data = JSON.parse(readFileSync(file, "utf8")) as StoreData;
      data.files ??= {};
      data.chunks ??= [];
      data.notes ??= [];
      data.symbols ??= [];
      data.imports ??= [];
      data.references ??= [];
      data.meta ??= { embedder: "", dim: 0, version: STORE_VERSION };
    } else {
      data = {
        meta: { embedder: "", dim: 0, version: STORE_VERSION },
        files: {},
        chunks: [],
        notes: [],
        symbols: [],
        imports: [],
        references: [],
      };
    }
    return new Store(dataDir, file, data);
  }

  async save(): Promise<void> {
    if (!existsSync(this.dataDir)) mkdirSync(this.dataDir, { recursive: true });
    const tmp = this.file + ".tmp";
    writeFileSync(tmp, JSON.stringify(this.data), "utf8");
    renameSync(tmp, this.file); // atomic on same volume
  }

  /** Set/confirm the active embedder. Throws if the dimension would change. */
  setEmbedderMeta(name: string, dim: number): void {
    if (this.data.meta.dim !== 0 && this.data.meta.dim !== dim) {
      throw new Error(
        `Embedding dimension mismatch: store was built with ${this.data.meta.embedder} (dim ${this.data.meta.dim}), ` +
          `active embedder is ${name} (dim ${dim}). Re-index with force to rebuild.`,
      );
    }
    this.data.meta = { embedder: name, dim, version: STORE_VERSION };
  }

  get embedderName(): string {
    return this.data.meta.embedder;
  }

  fileHash(path: string): string | undefined {
    return this.data.files[path];
  }

  setFileHash(path: string, hash: string): void {
    this.data.files[path] = hash;
  }

  /** Replace all chunks belonging to `path` with `chunks`. */
  replaceFileChunks(path: string, chunks: Chunk[]): void {
    this.data.chunks = this.data.chunks.filter((c) => c.file !== path);
    this.data.chunks.push(...chunks);
  }

  /** Replace all structural records (symbols/imports/references) for a file. */
  replaceFileSymbols(
    file: string,
    symbols: CodeSymbol[],
    imports: ImportEdge[],
    references: Reference[] = [],
  ): void {
    this.data.symbols = this.data.symbols.filter((s) => s.file !== file);
    this.data.symbols.push(...symbols);
    this.data.imports = this.data.imports.filter((i) => i.file !== file);
    this.data.imports.push(...imports);
    this.data.references = this.data.references.filter((r) => r.file !== file);
    this.data.references.push(...references);
  }

  findDefinitions(name: string, pathPrefix?: string): CodeSymbol[] {
    return this.data.symbols.filter(
      (s) => s.name === name && (!pathPrefix || s.file.startsWith(pathPrefix)),
    );
  }

  outline(file: string): CodeSymbol[] {
    return this.data.symbols
      .filter((s) => s.file === file)
      .sort((a, b) => a.startLine - b.startLine);
  }

  importsOf(file: string): ImportEdge[] {
    return this.data.imports.filter((i) => i.file === file);
  }

  /** Files that import `file` — loose basename match on relative specifiers. */
  importedBy(file: string): ImportEdge[] {
    const base = baseNoExt(file);
    return this.data.imports.filter((i) => isRelative(i.source) && baseNoExt(i.source) === base);
  }

  /**
   * Call/usage sites of `name`, ranked so files that import the name come first;
   * the symbol's own definition line is excluded. Heuristic (no type resolution).
   */
  findReferences(name: string, pathPrefix?: string): Reference[] {
    const defLines = new Set(
      this.data.symbols.filter((s) => s.name === name).map((s) => `${s.file}:${s.startLine}`),
    );
    const importers = new Set(
      this.data.imports.filter((i) => i.names.includes(name)).map((i) => i.file),
    );
    return this.data.references
      .filter(
        (r) =>
          r.name === name &&
          !defLines.has(`${r.file}:${r.line}`) &&
          (!pathPrefix || r.file.startsWith(pathPrefix)),
      )
      .sort((a, b) => Number(importers.has(b.file)) - Number(importers.has(a.file)));
  }

  private rankChunks(
    q: number[] | Float32Array,
    k: number,
    filter?: { pathPrefix?: string; ext?: string[] },
  ): ScoredChunk[] {
    const exts = filter?.ext?.map((e) => (e.startsWith(".") ? e : "." + e).toLowerCase());
    let pool = this.data.chunks;
    if (filter?.pathPrefix) pool = pool.filter((c) => c.file.startsWith(filter.pathPrefix!));
    if (exts) pool = pool.filter((c) => exts.some((e) => c.file.toLowerCase().endsWith(e)));
    return pool
      .map((c) => ({
        file: c.file,
        startLine: c.startLine,
        endLine: c.endLine,
        score: dot(q, c.vector),
        snippet: snippetOf(c.text),
        text: c.text,
        symbolName: c.symbolName,
        kind: c.kind,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  /** Top-k chunks by cosine similarity (public result shape — snippet only). */
  searchChunks(
    q: number[] | Float32Array,
    k: number,
    filter?: { pathPrefix?: string; ext?: string[] },
  ): SearchHit[] {
    return this.rankChunks(q, k, filter).map(({ text, ...hit }) => hit);
  }

  /** Top-k chunks WITH full text, so the search layer can re-rank (hybrid). */
  searchChunkCandidates(
    q: number[] | Float32Array,
    k: number,
    filter?: { pathPrefix?: string; ext?: string[] },
  ): ScoredChunk[] {
    return this.rankChunks(q, k, filter);
  }

  addNote(
    text: string,
    tags: string[],
    vector: number[] | Float32Array,
    dedupThreshold = DEFAULT_DEDUP_THRESHOLD,
  ): { id: string; deduped: boolean } {
    const vec = Array.from(vector);
    for (const n of this.data.notes) {
      if (dot(vec, n.vector) > dedupThreshold) return { id: n.id, deduped: true };
    }
    const id = "n_" + sha1(text).slice(0, 10);
    if (!this.data.notes.some((n) => n.id === id)) {
      this.data.notes.push({ id, text, tags, vector: vec, createdAt: Date.now() });
    }
    return { id, deduped: false };
  }

  searchNotes(
    q: number[] | Float32Array,
    k: number,
  ): Array<{ id: string; text: string; tags: string[]; score: number }> {
    return this.data.notes
      .map((n) => ({ id: n.id, text: n.text, tags: n.tags, score: dot(q, n.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  deleteNote(id: string): boolean {
    const before = this.data.notes.length;
    this.data.notes = this.data.notes.filter((n) => n.id !== id);
    return this.data.notes.length < before;
  }

  /** Snapshot of all notes (for re-embedding when the embedder changes). */
  exportNotes(): Note[] {
    return this.data.notes.map((n) => ({ ...n }));
  }

  /**
   * Adopt a new embedder whose dimension differs from the stored one. Code
   * chunks (and the file-hash cache) are dropped so `index_path` rebuilds them;
   * notes are supplied already re-embedded into the new space.
   */
  rebuildForEmbedder(name: string, dim: number, reembeddedNotes: Note[]): void {
    this.data.chunks = [];
    this.data.files = {};
    this.data.notes = reembeddedNotes;
    this.data.symbols = [];
    this.data.imports = [];
    this.data.references = [];
    this.data.meta = { embedder: name, dim, version: STORE_VERSION };
  }

  stats(): {
    chunkCount: number;
    noteCount: number;
    fileCount: number;
    symbolCount: number;
    importCount: number;
    embedder: string;
    dim: number;
  } {
    return {
      chunkCount: this.data.chunks.length,
      noteCount: this.data.notes.length,
      fileCount: Object.keys(this.data.files).length,
      symbolCount: this.data.symbols.length,
      importCount: this.data.imports.length,
      embedder: this.data.meta.embedder,
      dim: this.data.meta.dim,
    };
  }
}
