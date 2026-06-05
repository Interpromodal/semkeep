import { join } from "node:path";

export interface SemkeepConfig {
  dataDir: string;
  forced?: string; // SEMKEEP_EMBEDDER: lexical|openai|voyage|ollama|local
  openaiKey?: string;
  voyageKey?: string;
  ollamaHost: string;
  model?: string;
  autoRefresh: boolean; // freshen-on-query (SEMKEEP_AUTO_REFRESH=0 to disable)
  refreshDebounceMs: number; // skip re-scan if freshened more recently than this
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
    autoRefresh: env.SEMKEEP_AUTO_REFRESH !== "0" && env.SEMKEEP_AUTO_REFRESH !== "false",
    refreshDebounceMs: Number(env.SEMKEEP_REFRESH_DEBOUNCE_MS) || 1500,
  };
}
