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
const DEFINITION_WEIGHT = 0.25;
const DEFINITION_KINDS = new Set(["function", "class", "method", "interface", "type", "enum"]);

const PATH_PENALTY = 0.15;
// Example/test/demo/fixture code demonstrates or uses implementations rather than
// being them, so it should not out-rank real source for "where is X" queries.
const DEPRIORITIZED_PATH =
  /(^|[\\/])(examples?|tests?|__tests__|__mocks__|specs?|fixtures?|demos?|mocks?)[\\/]|\.(test|spec)\.[a-z0-9]+$/i;
function isDeprioritizedPath(file: string): boolean {
  return DEPRIORITIZED_PATH.test(file);
}

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

  if (candidates.length === 0) return [];

  const strip = (c: ScoredChunk): SearchHit => {
    const { text, ...hit } = c;
    return hit;
  };

  // Hybrid (default) re-ranks with keyword + definition signals; the path
  // de-weight applies in every mode.
  const qTokens = mode === "hybrid" ? new Set(tokenize(query)) : new Set<string>();

  for (const c of candidates) {
    if (isDeprioritizedPath(c.file)) c.score -= PATH_PENALTY;
    if (qTokens.size === 0) continue;

    // Keyword boost over the FULL chunk text — an exact term deep in a chunk is a
    // strong signal the semantic vector may under-weight.
    const cTokens = new Set(tokenize(c.text));
    let shared = 0;
    for (const t of qTokens) if (cTokens.has(t)) shared++;
    c.score += (shared / qTokens.size) * KEYWORD_WEIGHT;

    // Definition boost: a chunk that DEFINES a query-matching symbol is more
    // likely the real answer than a chunk that merely uses it.
    if (c.kind && DEFINITION_KINDS.has(c.kind) && c.symbolName) {
      const symTokens = tokenize(c.symbolName);
      let symShared = 0;
      for (const t of symTokens) if (qTokens.has(t)) symShared++;
      if (symShared > 0) {
        c.score += DEFINITION_WEIGHT * (symShared / Math.max(1, symTokens.length));
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, k).map(strip);
}
