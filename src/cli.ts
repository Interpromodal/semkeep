#!/usr/bin/env node
import { serve } from "./server.js";
import { sessionStartHook, preCompactHook } from "./cli/hooks.js";
import { runGreenlightCli } from "./cli/greenlight-cli.js";
import { importCairn } from "./cli/import-cairn.js";

const USAGE = `Usage: semkeep [serve] | markers --hook | nudge --hook | greenlight <run|lint|init> | import-cairn`;

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case undefined: case "serve":
      return serve(); // `npx -y semkeep` or `semkeep serve` → MCP server
    case "markers":
      return sessionStartHook(rest); // SessionStart hook
    case "nudge":
      return preCompactHook(rest); // PreCompact hook
    case "greenlight":
      return runGreenlightCli(rest);
    case "import-cairn":
      return importCairn(rest);
    case "help":
    case "--help":
      console.log(USAGE);
      return;
    default:
      console.error(`semkeep: unknown command "${cmd}"\n${USAGE}`);
      process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error("[semkeep] fatal:", e);
  process.exit(1);
});
