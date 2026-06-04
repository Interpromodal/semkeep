import type { EmbeddingProvider } from "../types.js";
import type { MindPalaceConfig } from "../config.js";
import { LexicalEmbedder } from "./lexical.js";
import { OpenAIEmbedder } from "./openai.js";
import { VoyageEmbedder } from "./voyage.js";
import { OllamaEmbedder } from "./ollama.js";
import { loadLocalEmbedder } from "./local.js";

type FetchLike = (url: string, init?: unknown) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

export interface Detection {
  provider: EmbeddingProvider;
  degraded: boolean; // true only when running on the lexical fallback
}

async function ollamaReachable(fetchImpl: FetchLike, host: string): Promise<boolean> {
  try {
    const res = await fetchImpl(`${host}/api/tags`);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Pick the best available embedding backend, tiered and never-failing:
 *   forced env > OpenAI/Voyage key > local Ollama > local model > lexical.
 * Only the lexical fallback is reported as `degraded`.
 */
export async function detect(
  config: MindPalaceConfig,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  loadLocal: (model?: string) => Promise<EmbeddingProvider | null> = loadLocalEmbedder,
): Promise<Detection> {
  const forced = config.forced?.toLowerCase();

  if (forced) {
    if (forced === "lexical") return { provider: new LexicalEmbedder(), degraded: true };
    if (forced === "openai" && config.openaiKey)
      return { provider: new OpenAIEmbedder(config.openaiKey, config.model), degraded: false };
    if (forced === "voyage" && config.voyageKey)
      return { provider: new VoyageEmbedder(config.voyageKey, config.model), degraded: false };
    if (forced === "ollama")
      return { provider: new OllamaEmbedder(config.ollamaHost, config.model), degraded: false };
    if (forced === "local") {
      const local = await loadLocal(config.model);
      if (local) return { provider: local, degraded: false };
    }
    // forced backend unavailable -> fall through to auto-detect
  }

  if (config.openaiKey)
    return { provider: new OpenAIEmbedder(config.openaiKey, config.model), degraded: false };
  if (config.voyageKey)
    return { provider: new VoyageEmbedder(config.voyageKey, config.model), degraded: false };
  if (await ollamaReachable(fetchImpl, config.ollamaHost))
    return { provider: new OllamaEmbedder(config.ollamaHost, config.model), degraded: false };

  const local = await loadLocal(config.model);
  if (local) return { provider: local, degraded: false };

  return { provider: new LexicalEmbedder(), degraded: true };
}
