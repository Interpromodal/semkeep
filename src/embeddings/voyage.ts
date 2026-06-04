import type { EmbeddingProvider } from "../types.js";
import { normalize } from "./util.js";

/** Voyage AI embeddings (voyage-3 by default). Strong for code/retrieval. */
export class VoyageEmbedder implements EmbeddingProvider {
  readonly name = "voyage";
  readonly dim = 1024;
  constructor(
    private readonly key: string,
    private readonly model = "voyage-3",
  ) {}

  async embed(texts: string[]): Promise<Float32Array[]> {
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.key}`,
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) {
      throw new Error(`Voyage embeddings failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
    return json.data.map((d) => normalize(d.embedding));
  }
}
