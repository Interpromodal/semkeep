import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, readFileSync } from "node:fs";

export interface SemkeepConfig {
  dataDir: string;
  forced?: string; // SEMKEEP_EMBEDDER: lexical|openai|voyage|ollama|local
  openaiKey?: string;
  voyageKey?: string;
  ollamaHost: string;
  model?: string;
  autoRefresh: boolean; // freshen-on-query (SEMKEEP_AUTO_REFRESH=0 to disable)
  refreshDebounceMs: number; // skip re-scan if freshened more recently than this
  /** Where the active API key came from (for status display). */
  credentialSource: "scoped-env" | "config-file" | "inherited-env" | "none";
}

function readUserConfig(): { openaiKey?: string; voyageKey?: string } {
  const p = join(homedir(), ".semkeep", "config.json");
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return {}; }
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): SemkeepConfig {
  const fileCfg = readUserConfig();
  const inheritEnv =
    env.SEMKEEP_INHERIT_ENV_KEYS === "1" ||
    env.SEMKEEP_EMBEDDER === "openai" ||
    env.SEMKEEP_EMBEDDER === "voyage";

  const openaiKey = env.SEMKEEP_OPENAI_API_KEY ?? fileCfg.openaiKey ?? (inheritEnv ? env.OPENAI_API_KEY : undefined);
  const voyageKey = env.SEMKEEP_VOYAGE_API_KEY ?? fileCfg.voyageKey ?? (inheritEnv ? env.VOYAGE_API_KEY : undefined);

  let credentialSource: SemkeepConfig["credentialSource"] = "none";
  if (env.SEMKEEP_OPENAI_API_KEY || env.SEMKEEP_VOYAGE_API_KEY) {
    credentialSource = "scoped-env";
  } else if (fileCfg.openaiKey || fileCfg.voyageKey) {
    credentialSource = "config-file";
  } else if (inheritEnv && (env.OPENAI_API_KEY || env.VOYAGE_API_KEY)) {
    credentialSource = "inherited-env";
  }

  return {
    dataDir: env.SEMKEEP_DATA_DIR || join(cwd, ".semkeep"),
    forced: env.SEMKEEP_EMBEDDER,
    openaiKey,
    voyageKey,
    ollamaHost: env.OLLAMA_HOST || "http://localhost:11434",
    model: env.SEMKEEP_MODEL,
    autoRefresh: env.SEMKEEP_AUTO_REFRESH !== "0" && env.SEMKEEP_AUTO_REFRESH !== "false",
    refreshDebounceMs: Number(env.SEMKEEP_REFRESH_DEBOUNCE_MS) || 1500,
    credentialSource,
  };
}
