import type { EmbeddingProvider } from "../types.js";
import { normalize } from "./util.js";

/** Local Ollama embeddings (nomic-embed-text by default). No API key, fully local. */
export class OllamaEmbedder implements EmbeddingProvider {
  readonly name = "ollama";
  readonly dim = 768;
  constructor(
    private readonly host: string,
    private readonly model = "nomic-embed-text",
  ) {}

  async embed(texts: string[]): Promise<Float32Array[]> {
    const out: Float32Array[] = [];
    for (const text of texts) {
      const res = await fetch(`${this.host}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, prompt: text }),
      });
      if (!res.ok) {
        throw new Error(`Ollama embeddings failed: ${res.status} ${await res.text()}`);
      }
      const json = (await res.json()) as { embedding: number[] };
      out.push(normalize(json.embedding));
    }
    return out;
  }
}
