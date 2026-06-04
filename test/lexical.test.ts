import { test, expect } from "vitest";
import { LexicalEmbedder, tokenize } from "../src/embeddings/lexical.js";

test("tokenize splits identifiers (camelCase + snake_case)", () => {
  expect(tokenize("backoffScheduler retry_count")).toEqual([
    "backoff",
    "scheduler",
    "retry",
    "count",
  ]);
});

test("embeddings are deterministic and L2-normalized", async () => {
  const e = new LexicalEmbedder(256);
  const [a] = await e.embed(["retry backoff logic"]);
  const [b] = await e.embed(["retry backoff logic"]);
  expect(Array.from(a)).toEqual(Array.from(b)); // deterministic
  const norm = Math.hypot(...Array.from(a));
  expect(norm).toBeCloseTo(1, 5); // unit length
});

test("closer text scores higher (cosine via dot)", async () => {
  const e = new LexicalEmbedder(512);
  const [q] = await e.embed(["retry logic with backoff"]);
  const [near] = await e.embed(["the backoffScheduler handles retry attempts"]);
  const [far] = await e.embed(["render the login button in blue"]);
  const dot = (x: Float32Array, y: Float32Array) =>
    x.reduce((s, v, i) => s + v * y[i], 0);
  expect(dot(q, near)).toBeGreaterThan(dot(q, far));
});

test("empty text yields a zero (but finite) vector", async () => {
  const e = new LexicalEmbedder(64);
  const [v] = await e.embed([""]);
  expect(v).toHaveLength(64);
  expect(Array.from(v).every((x) => Number.isFinite(x))).toBe(true);
});
