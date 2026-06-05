import { join } from "node:path";

export interface SemkeepConfig {
  dataDir: string;
  forced?: string; // SEMKEEP_EMBEDDER: lexical|openai|voyage|ollama|local
  openaiKey?: string;
  voyageKey?: string;
  ollamaHost: string;
  model?: string;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): SemkeepConfig {
  return {
    dataDir: env.SEMKEEP_DATA_DIR || join(cwd, ".semkeep"),
    forced: env.SEMKEEP_EMBEDDER,
    openaiKey: env.OPENAI_API_KEY,
    voyageKey: env.VOYAGE_API_KEY,
    ollamaHost: env.OLLAMA_HOST || "http://localhost:11434",
    model: env.SEMKEEP_MODEL,
  };
}
