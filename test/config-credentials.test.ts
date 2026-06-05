import { describe, it, expect, afterEach } from "vitest";
import { loadConfig } from "../src/config.js";

const saved = { ...process.env };
afterEach(() => { Object.assign(process.env, saved); Object.keys(process.env).forEach(k => { if (!(k in saved)) delete process.env[k]; }); });

describe("credential isolation", () => {
  it("uses SEMKEEP_OPENAI_API_KEY and ignores an ambient OPENAI_API_KEY by default", () => {
    process.env.OPENAI_API_KEY = "ambient";
    process.env.SEMKEEP_OPENAI_API_KEY = "scoped";
    delete process.env.SEMKEEP_INHERIT_ENV_KEYS;
    delete process.env.SEMKEEP_EMBEDDER;
    expect(loadConfig().openaiKey).toBe("scoped");
  });
  it("does NOT read a bare OPENAI_API_KEY when no namespaced key and no opt-in", () => {
    process.env.OPENAI_API_KEY = "ambient";
    delete process.env.SEMKEEP_OPENAI_API_KEY;
    delete process.env.SEMKEEP_INHERIT_ENV_KEYS;
    delete process.env.SEMKEEP_EMBEDDER;
    expect(loadConfig().openaiKey).toBeUndefined();
  });
  it("reads the bare key when SEMKEEP_INHERIT_ENV_KEYS=1", () => {
    process.env.OPENAI_API_KEY = "ambient";
    process.env.SEMKEEP_INHERIT_ENV_KEYS = "1";
    delete process.env.SEMKEEP_OPENAI_API_KEY;
    expect(loadConfig().openaiKey).toBe("ambient");
  });
  it("reads the bare key when SEMKEEP_EMBEDDER=openai (explicit intent)", () => {
    process.env.OPENAI_API_KEY = "ambient";
    process.env.SEMKEEP_EMBEDDER = "openai";
    delete process.env.SEMKEEP_OPENAI_API_KEY;
    delete process.env.SEMKEEP_INHERIT_ENV_KEYS;
    expect(loadConfig().openaiKey).toBe("ambient");
  });
});
