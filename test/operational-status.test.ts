import { describe, it, expect } from "vitest";
import { statusTool, type Context } from "../src/tools.js";
import { LexicalEmbedder } from "../src/embeddings/lexical.js";
import { Store } from "../src/store.js";
import { loadConfig } from "../src/config.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("statusTool", () => {
  it("reports the operational store path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "semkeep-status-"));
    const store = await Store.load(dir);
    const emb = new LexicalEmbedder(256);
    store.setEmbedderMeta(emb.name, emb.dim);
    const ctx: Context = { store, embedder: emb, degraded: true, config: loadConfig() };
    const out = statusTool(ctx);
    expect(out).toMatch(/operational:/);
  });
});
