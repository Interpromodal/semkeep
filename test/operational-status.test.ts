import { describe, it, expect } from "vitest";
import { statusTool, type Context } from "../src/tools.js";
import { LexicalEmbedder } from "../src/embeddings/lexical.js";
import { Store } from "../src/store.js";
import { loadConfig } from "../src/config.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("statusTool", () => {
  it("reports the operational store path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "semkeep-status-"));
    const opsDir = mkdtempSync(join(tmpdir(), "semkeep-ops-"));
    const prev = process.env.SEMKEEP_OPS_STORE;
    process.env.SEMKEEP_OPS_STORE = join(opsDir, "operational.json");
    try {
      const store = await Store.load(dir);
      const emb = new LexicalEmbedder(256);
      store.setEmbedderMeta(emb.name, emb.dim);
      const ctx: Context = { store, embedder: emb, degraded: true, config: loadConfig() };
      const out = statusTool(ctx);
      expect(out).toMatch(/operational: 0 marker\(s\)/);
    } finally {
      if (prev === undefined) delete process.env.SEMKEEP_OPS_STORE;
      else process.env.SEMKEEP_OPS_STORE = prev;
      rmSync(dir, { recursive: true, force: true });
      rmSync(opsDir, { recursive: true, force: true });
    }
  });
});
