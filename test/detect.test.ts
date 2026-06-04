import { test, expect } from "vitest";
import { detect } from "../src/embeddings/detect.js";

const base = { dataDir: ".", ollamaHost: "http://localhost:11434" };

test("falls back to lexical when nothing is available", async () => {
  const { provider, degraded } = await detect(
    { ...base, ollamaHost: "http://127.0.0.1:1" },
    async () => {
      throw new Error("offline");
    },
  );
  expect(provider.name).toBe("lexical");
  expect(degraded).toBe(true);
});

test("uses ollama when reachable", async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => ({ models: [] }) });
  const { provider, degraded } = await detect({ ...base }, fakeFetch as any);
  expect(provider.name).toBe("ollama");
  expect(degraded).toBe(false);
});

test("prefers openai when key present (before ollama)", async () => {
  const { provider, degraded } = await detect(
    { ...base, openaiKey: "sk-test" },
    async () => {
      throw new Error("ollama should not be probed");
    },
  );
  expect(provider.name).toBe("openai");
  expect(degraded).toBe(false);
});

test("forced lexical wins even with a key present", async () => {
  const { provider, degraded } = await detect(
    { ...base, forced: "lexical", openaiKey: "sk-test" },
    (async () => ({ ok: true, json: async () => ({}) })) as any,
  );
  expect(provider.name).toBe("lexical");
  expect(degraded).toBe(true);
});
