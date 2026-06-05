import type { EmbeddingProvider, SearchHit } from "./types.js";
import { Store, type ScoredChunk } from "./store.js";
import { tokenize } from "./embeddings/lexical.js";

export interface SearchOptions {
  k?: number;
  pathPrefix?: string;
  ext?: string[];
  mode?: "semantic" | "hybrid";
}

const KEYWORD_WEIGHT = 0.3;

/**
 * Semantic search over indexed chunks. In "hybrid" mode (default) a small
 * keyword-overlap boost is added on top of the semantic score so exact term
 * matches surface — this matters most for real embedders, where a query term
 * appearing verbatim in a chunk is a strong signal the vector may under-weight.
 * Scoping (`pathPrefix`, `ext`) narrows the corpus before ranking.
 */
export async function search(
  store: Store,
  embedder: EmbeddingProvider,
  query: string,
  opts: SearchOptions = {},
): Promise<SearchHit[]> {
  const k = opts.k ?? 8;
  const mode = opts.mode ?? "hybrid";
  const [qv] = await embedder.embed([query]);

  // Over-fetch so the keyword re-rank can promote strong lexical matches.
  const candidates = store.searchChunkCandidates(qv, k * 4, {
    pathPrefix: opts.pathPrefix,
    ext: opts.ext,
  });

  const strip = (c: ScoredChunk): SearchHit => {
    const { text, ...hit } = c;
    return hit;
  };

  if (mode === "semantic" || candidates.length === 0) {
    return candidates.slice(0, k).map(strip);
  }

  const qTokens = new Set(tokenize(query));
  if (qTokens.size === 0) return candidates.slice(0, k).map(strip);

  for (const c of candidates) {
    // Scan the FULL chunk text, not just the snippet — an exact keyword match
    // deep in a chunk is a strong signal the semantic vector may under-weight.
    const cTokens = new Set(tokenize(c.text));
    let shared = 0;
    for (const t of qTokens) if (cTokens.has(t)) shared++;
    c.score += (shared / qTokens.size) * KEYWORD_WEIGHT;
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, k).map(strip);
}
