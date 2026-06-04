import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Chunk, Note, SearchHit, StoreData } from "./types.js";

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
      data.meta ??= { embedder: "", dim: 0, version: STORE_VERSION };
    } else {
      data = { meta: { embedder: "", dim: 0, version: STORE_VERSION }, files: {}, chunks: [], notes: [] };
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

  searchChunks(
    q: number[] | Float32Array,
    k: number,
    filter?: { pathPrefix?: string; ext?: string[] },
  ): SearchHit[] {
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
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
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

  stats(): { chunkCount: number; noteCount: number; fileCount: number; embedder: string; dim: number } {
    return {
      chunkCount: this.data.chunks.length,
      noteCount: this.data.notes.length,
      fileCount: Object.keys(this.data.files).length,
      embedder: this.data.meta.embedder,
      dim: this.data.meta.dim,
    };
  }
}
