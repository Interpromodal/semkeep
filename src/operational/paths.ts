import { homedir } from "node:os";
import { resolve, join } from "node:path";

/** Resolve the project key: explicit arg → SEMKEEP_PROJECT → CLAUDE_PROJECT_DIR → cwd. */
export function resolveProject(project?: string): string {
  return resolve(
    project ||
      process.env.SEMKEEP_PROJECT ||
      process.env.CLAUDE_PROJECT_DIR ||
      process.cwd(),
  );
}

/** Path to the global operational store. Override with SEMKEEP_OPS_STORE. */
export function defaultOpsStorePath(): string {
  return process.env.SEMKEEP_OPS_STORE
    ? resolve(process.env.SEMKEEP_OPS_STORE)
    : join(homedir(), ".semkeep", "operational.json");
}
