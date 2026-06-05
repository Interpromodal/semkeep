import { describe, it, expect, afterEach } from "vitest";
import { statusTool, type Context } from "../src/tools.js";
import { LexicalEmbedder } from "../src/embeddings/lexical.js";
import { Store } from "../src/store.js";
import { loadConfig } from "../src/config.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeCtx(dir: string, config = loadConfig()): Context {
  const store = new (Store as any)(dir, {});
  const emb = new LexicalEmbedder(256);
  // minimal synchronous Store-like object for status tests
  const fakeStore = {
    stats: () => ({ fileCount: 0, chunkCount: 0, symbolCount: 0, importCount: 0, noteCount: 0, dim: 256, embedder: "lexical" }),
    roots: () => [],
    notesForFile: () => [],
    notesForSymbol: () => [],
  } as any;
  return { store: fakeStore, embedder: emb, degraded: false, config };
}

describe("statusTool", () => {
  const dirs: string[] = [];
  afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

  it("reports the operational store path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "semkeep-status-"));
    const opsDir = mkdtempSync(join(tmpdir(), "semkeep-ops-"));
    dirs.push(dir, opsDir);
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
    }
  });

  it("shows 'credentials: none' when no key is set", () => {
    const saved = { ...process.env };
    delete process.env.OPENAI_API_KEY;
    delete process.env.SEMKEEP_OPENAI_API_KEY;
    delete process.env.SEMKEEP_VOYAGE_API_KEY;
    delete process.env.SEMKEEP_INHERIT_ENV_KEYS;
    delete process.env.SEMKEEP_EMBEDDER;
    try {
      const config = loadConfig();
      const dir = mkdtempSync(join(tmpdir(), "semkeep-status-"));
      dirs.push(dir);
      const store = { stats: () => ({ fileCount: 0, chunkCount: 0, symbolCount: 0, importCount: 0, noteCount: 0, dim: 0, embedder: "" }), roots: () => [], notesForFile: () => [], notesForSymbol: () => [] } as any;
      const emb = new LexicalEmbedder(256);
      const ctx: Context = { store, embedder: emb, degraded: false, config };
      const out = statusTool(ctx);
      expect(out).toContain("credentials:");
      expect(out).toContain("none");
    } finally {
      Object.assign(process.env, saved);
      Object.keys(process.env).forEach((k) => { if (!(k in saved)) delete process.env[k]; });
    }
  });

  it("shows scoped-env source when SEMKEEP_OPENAI_API_KEY is set, without leaking the key", () => {
    const saved = { ...process.env };
    process.env.SEMKEEP_OPENAI_API_KEY = "secret-key-value";
    delete process.env.SEMKEEP_INHERIT_ENV_KEYS;
    try {
      const config = loadConfig();
      const store = { stats: () => ({ fileCount: 0, chunkCount: 0, symbolCount: 0, importCount: 0, noteCount: 0, dim: 0, embedder: "" }), roots: () => [], notesForFile: () => [], notesForSymbol: () => [] } as any;
      const emb = new LexicalEmbedder(256);
      const ctx: Context = { store, embedder: emb, degraded: false, config };
      const out = statusTool(ctx);
      expect(out).toContain("credentials:");
      expect(out).toContain("scoped");
      // Must NOT contain the actual key value
      expect(out).not.toContain("secret-key-value");
    } finally {
      Object.assign(process.env, saved);
      Object.keys(process.env).forEach((k) => { if (!(k in saved)) delete process.env[k]; });
    }
  });

  it("shows inherited source when SEMKEEP_INHERIT_ENV_KEYS=1 with ambient key", () => {
    const saved = { ...process.env };
    process.env.OPENAI_API_KEY = "ambient-secret";
    process.env.SEMKEEP_INHERIT_ENV_KEYS = "1";
    delete process.env.SEMKEEP_OPENAI_API_KEY;
    try {
      const config = loadConfig();
      const store = { stats: () => ({ fileCount: 0, chunkCount: 0, symbolCount: 0, importCount: 0, noteCount: 0, dim: 0, embedder: "" }), roots: () => [], notesForFile: () => [], notesForSymbol: () => [] } as any;
      const emb = new LexicalEmbedder(256);
      const ctx: Context = { store, embedder: emb, degraded: false, config };
      const out = statusTool(ctx);
      expect(out).toContain("credentials:");
      expect(out).toContain("inherited");
      expect(out).not.toContain("ambient-secret");
    } finally {
      Object.assign(process.env, saved);
      Object.keys(process.env).forEach((k) => { if (!(k in saved)) delete process.env[k]; });
    }
  });
});
