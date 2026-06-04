import type { EmbeddingProvider } from "../types.js";
import { normalize } from "./util.js";

// Non-literal specifier so tsc/vite don't require this optional package at
// build time. It is only present if the user installed @huggingface/transformers.
const TRANSFORMERS = "@huggingface/transformers";

/**
 * Local embeddings via transformers.js (all-MiniLM-L6-v2, 384-dim). No API key,
 * fully offline after the model downloads once. The model pipeline is created
 * lazily on first embed so detection stays cheap.
 */
export class LocalEmbedder implements EmbeddingProvider {
  readonly name = "local";
  readonly dim = 384;
  private pipe: ((text: string, opts: object) => Promise<{ data: ArrayLike<number> }>) | null = null;

  constructor(private readonly model = "Xenova/all-MiniLM-L6-v2") {}

  private async ensure() {
    if (!this.pipe) {
      const mod: any = await import(/* @vite-ignore */ TRANSFORMERS);
      this.pipe = await mod.pipeline("feature-extraction", this.model);
    }
    return this.pipe!;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    const pipe = await this.ensure();
    const out: Float32Array[] = [];
    for (const text of texts) {
      const res = await pipe(text, { pooling: "mean", normalize: true });
      out.push(normalize(Array.from(res.data))); // already ~unit; re-normalize defensively
    }
    return out;
  }
}

/** Returns a LocalEmbedder iff the optional transformers package is installed. */
export async function loadLocalEmbedder(model?: string): Promise<LocalEmbedder | null> {
  try {
    await import(/* @vite-ignore */ TRANSFORMERS);
    return new LocalEmbedder(model);
  } catch {
    return null;
  }
}
