import { test, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { search } from "../src/search.js";

test("definition chunks are re-ranked above usage-only chunks", async () => {
  // Stub embedder: any query -> [1,0,0]. Chunk vectors set directly below.
  const stub = {
    name: "stub",
    dim: 3,
    async embed(texts: string[]) {
      return texts.map(() => Float32Array.from([1, 0, 0]));
    },
  };
  const store = await Store.load(mkdtempSync(join(tmpdir(), "mp-def-")));
  store.setEmbedderMeta(stub.name, stub.dim);

  // U: a usage, higher cosine (1.0), but not a definition.
  store.replaceFileChunks("/r/u.ts", [
    { id: "u", file: "/r/u.ts", startLine: 1, endLine: 1, text: "call alpha here", vector: [1, 0, 0] },
  ]);
  // D: the definition, lower cosine (0.85), tagged as a function named alpha.
  store.replaceFileChunks("/r/d.ts", [
    { id: "d", file: "/r/d.ts", startLine: 1, endLine: 1, text: "function alpha", vector: [0.85, 0, 0], symbolName: "alpha", kind: "function" },
  ]);

  const hits = await search(store, stub as any, "alpha", { k: 2, mode: "hybrid" });
  expect(hits[0].file).toBe("/r/d.ts"); // definition boost overtakes the higher-cosine usage
});

test("example/test paths are de-weighted below real source at equal relevance", async () => {
  const stub = {
    name: "stub",
    dim: 3,
    async embed(texts: string[]) {
      return texts.map(() => Float32Array.from([1, 0, 0]));
    },
  };
  const store = await Store.load(mkdtempSync(join(tmpdir(), "mp-dw-")));
  store.setEmbedderMeta(stub.name, stub.dim);
  store.replaceFileChunks("/repo/examples/demo.ts", [
    { id: "e", file: "/repo/examples/demo.ts", startLine: 1, endLine: 1, text: "retry backoff logic", vector: [1, 0, 0] },
  ]);
  store.replaceFileChunks("/repo/src/net.ts", [
    { id: "s", file: "/repo/src/net.ts", startLine: 1, endLine: 1, text: "retry backoff logic", vector: [1, 0, 0] },
  ]);
  const hits = await search(store, stub as any, "retry backoff logic", { k: 2, mode: "hybrid" });
  expect(hits[0].file).toBe("/repo/src/net.ts"); // example demo de-weighted below src
});
