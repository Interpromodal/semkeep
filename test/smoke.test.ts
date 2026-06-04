import { test, expect } from "vitest";
import type { StoreData } from "../src/types.js";

test("types compile & smoke", () => {
  const s: StoreData = {
    meta: { embedder: "x", dim: 1, version: 1 },
    files: {},
    chunks: [],
    notes: [],
  };
  expect(s.chunks).toHaveLength(0);
});
