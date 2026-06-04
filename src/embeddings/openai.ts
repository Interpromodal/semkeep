import type { EmbeddingProvider } from "../types.js";
import { normalize } from "./util.js";

/** OpenAI embeddings (text-embedding-3-small by default). Highest quality tier. */
export class OpenAIEmbedder implements EmbeddingProvider {
  readonly name = "openai";
  readonly dim = 1536;
  constructor(
    private readonly key: string,
    private readonly model = "text-embedding-3-small",
  ) {}

  async embed(texts: string[]): Promise<Float32Array[]> {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.key}`,
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) {
      throw new Error(`OpenAI embeddings failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
    return json.data.map((d) => normalize(d.embedding));
  }
}
