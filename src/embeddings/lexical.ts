import type { EmbeddingProvider } from "../types.js";

/**
 * Split text into lowercase tokens, breaking identifiers apart so code is
 * searchable: `backoffScheduler` -> ["backoff","scheduler"], `retry_count`
 * -> ["retry","count"]. This is what makes the lexical tier usable for code.
 */
export function tokenize(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // camelCase boundary
    .split(/[^A-Za-z0-9]+/) // non-alphanumeric (incl. _ . - / etc.)
    .filter(Boolean)
    .map((t) => t.toLowerCase());
}

/** FNV-1a hash of a token into [0, dim). */
function hashToken(tok: string, dim: number): number {
  let h = 2166136261;
  for (let i = 0; i < tok.length; i++) {
    h ^= tok.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % dim;
}

/**
 * Deterministic, dependency-free embedding: a hashed bag-of-identifiers with
 * sublinear term frequency, L2-normalized. Cosine over these vectors reflects
 * weighted token overlap — lexical, but ranked. This is the always-works
 * fallback tier and the embedder all tests force (no network, no model).
 */
export class LexicalEmbedder implements EmbeddingProvider {
  readonly name = "lexical";
  constructor(readonly dim = 512) {}

  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((text) => {
      const v = new Float32Array(this.dim);
      for (const tok of tokenize(text)) v[hashToken(tok, this.dim)] += 1;
      for (let i = 0; i < this.dim; i++) {
        if (v[i] > 0) v[i] = 1 + Math.log(v[i]); // sublinear tf
      }
      let norm = 0;
      for (let i = 0; i < this.dim; i++) norm += v[i] * v[i];
      norm = Math.sqrt(norm) || 1; // empty text -> divide by 1, stays zero
      for (let i = 0; i < this.dim; i++) v[i] /= norm;
      return v;
    });
  }
}
