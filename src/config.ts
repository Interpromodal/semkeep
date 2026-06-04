import { join } from "node:path";

export interface MindPalaceConfig {
  dataDir: string;
  forced?: string; // MIND_PALACE_EMBEDDER: lexical|openai|voyage|ollama|local
  openaiKey?: string;
  voyageKey?: string;
  ollamaHost: string;
  model?: string;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): MindPalaceConfig {
  return {
    dataDir: env.MIND_PALACE_DATA_DIR || join(cwd, ".mindpalace"),
    forced: env.MIND_PALACE_EMBEDDER,
    openaiKey: env.OPENAI_API_KEY,
    voyageKey: env.VOYAGE_API_KEY,
    ollamaHost: env.OLLAMA_HOST || "http://localhost:11434",
    model: env.MIND_PALACE_MODEL,
  };
}
