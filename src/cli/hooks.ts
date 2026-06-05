// CLI formatters and handlers for the SessionStart and PreCompact hooks.
import { flag } from "./args.js";
import { OperationalStore } from "../operational/store.js";
import { resolveProject, defaultOpsStorePath } from "../operational/paths.js";
import { formatMarkers } from "../operational/format.js";

const PREAMBLE =
  "semkeep recalled operational memory for this project — re-verify anything flagged ⚠️ STALE, and record new verified commands/gotchas with `mark`.\n\n";

export function formatSessionStart(project: string, store: OperationalStore): string {
  const markers = store.recall(project, { includeStale: true });
  if (!markers.length) return ""; // silent in unknown projects
  const body = PREAMBLE + formatMarkers(project, markers);
  return JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: body } });
}

export function formatPreCompact(project: string, store: OperationalStore): string {
  const titles = store.recall(project, { includeStale: true }).map((m) => m.title);
  const shown = titles.slice(0, 15);
  const more = titles.length > 15 ? ` …(+${titles.length - 15} more)` : "";
  const have = titles.length
    ? `Already in semkeep: ${shown.join("; ")}${more}.`
    : "Nothing is recorded for this project yet.";
  const text =
    "Context is about to be compacted — record any newly-verified commands, gotchas, or dead-ends now with `mark` so they survive. " +
    have;
  return JSON.stringify({ hookSpecificOutput: { hookEventName: "PreCompact", additionalContext: text } });
}

function store(): OperationalStore {
  return new OperationalStore(defaultOpsStorePath());
}

export async function sessionStartHook(argv: string[]): Promise<void> {
  try {
    const out = formatSessionStart(resolveProject(flag(argv, "--project")), store());
    if (out) process.stdout.write(out);
  } catch {
    /* never break the session */
  }
  process.exit(0);
}

export async function preCompactHook(argv: string[]): Promise<void> {
  try {
    process.stdout.write(formatPreCompact(resolveProject(flag(argv, "--project")), store()));
  } catch {
    /* swallow */
  }
  process.exit(0);
}
