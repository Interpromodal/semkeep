#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { detect } from "./embeddings/detect.js";
import { Store } from "./store.js";
import {
  type Context,
  callersTool,
  defineTool,
  ensureEmbedder,
  forgetTool,
  importsTool,
  indexPathTool,
  markTool,
  markersTool,
  outlineTool,
  recallTool,
  refreshTool,
  rememberTool,
  searchTool,
  statusTool,
  unmarkTool,
} from "./tools.js";

// Lazily build the context on first tool call: detect the embedder, load the
// store, reconcile the embedder. Stdout is the MCP channel — logs go to stderr.
let ctxPromise: Promise<Context> | null = null;
function getContext(): Promise<Context> {
  if (!ctxPromise) {
    ctxPromise = (async () => {
      const config = loadConfig();
      const { provider, degraded } = await detect(config);
      const store = await Store.load(config.dataDir);
      await ensureEmbedder(store, provider);
      return { store, embedder: provider, degraded, config };
    })();
  }
  return ctxPromise;
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

const server = new McpServer({ name: "semkeep", version: "0.1.0" });

server.registerTool(
  "index_path",
  {
    description:
      "Index a directory or file for semantic search. Skips unchanged files unless force is set.",
    inputSchema: {
      path: z.string().describe("Absolute or relative path to a folder or file to index"),
      include: z
        .array(z.string())
        .optional()
        .describe("File extensions to include (no dots); overrides defaults"),
      exclude: z.array(z.string()).optional().describe("Path substrings to skip"),
      force: z.boolean().optional().describe("Re-embed even unchanged files"),
    },
  },
  async (args) => text(await indexPathTool(await getContext(), args)),
);

server.registerTool(
  "search",
  {
    description:
      "Semantic search over indexed code & docs. Returns ranked file:line results. Use when you don't know the exact identifier; scope with pathPrefix/ext.",
    inputSchema: {
      query: z.string().describe("Natural-language description of what you're looking for"),
      k: z.number().int().positive().optional().describe("Max results (default 8)"),
      pathPrefix: z.string().optional().describe("Restrict to files under this path prefix"),
      ext: z.array(z.string()).optional().describe("Restrict to these file extensions (no dots)"),
      mode: z.enum(["semantic", "hybrid"]).optional().describe("Ranking mode (default hybrid)"),
    },
  },
  async (args) => text(await searchTool(await getContext(), args)),
);

server.registerTool(
  "remember",
  {
    description:
      "Store a durable working note. Optionally anchor it to a symbol/file so it surfaces in define/outline. Semantic dedup avoids near-duplicates.",
    inputSchema: {
      text: z.string().describe("The note to remember"),
      tags: z.array(z.string()).optional().describe("Optional tags"),
      symbol: z.string().optional().describe("Anchor the note to this symbol name"),
      file: z.string().optional().describe("Anchor the note to this file"),
    },
  },
  async (args) => text(await rememberTool(await getContext(), args)),
);

server.registerTool(
  "recall",
  {
    description: "Semantic search over your stored notes.",
    inputSchema: {
      query: z.string().describe("What you want to recall"),
      k: z.number().int().positive().optional().describe("Max results (default 5)"),
    },
  },
  async (args) => text(await recallTool(await getContext(), args)),
);

server.registerTool(
  "forget",
  {
    description: "Delete a stored note by id.",
    inputSchema: { id: z.string().describe("Note id, e.g. n_1a2b3c4d5e") },
  },
  async (args) => text(await forgetTool(await getContext(), args)),
);

server.registerTool(
  "mark",
  {
    description:
      "Record a typed, per-project operational marker: a verified recipe (command+exitCode), a gotcha, a dead-end, or a note. Upserts by (kind, title). Recipes with exitCode 0 are stamped verified.",
    inputSchema: {
      kind: z.enum(["recipe", "gotcha", "deadend", "note"]).describe("Marker kind"),
      title: z.string().describe("Short title; upsert key together with kind"),
      project: z.string().optional().describe("Project path (default: resolved cwd)"),
      body: z.string().optional().describe("Resolution / explanation / why-it-failed"),
      command: z.string().optional().describe("The exact command (recipes)"),
      cwd: z.string().optional().describe("Directory the command runs in"),
      exitCode: z.number().int().optional().describe("Observed exit code (0 verifies a recipe)"),
      tags: z.array(z.string()).optional().describe("Optional tags"),
    },
  },
  async (args) => text(await markTool(args)),
);

server.registerTool(
  "markers",
  {
    description:
      "Recall this project's operational markers (recipes/gotchas/dead-ends/notes), grouped and STALE-flagged. Filter by kind or a substring query.",
    inputSchema: {
      project: z.string().optional().describe("Project path (default: resolved cwd)"),
      query: z.string().optional().describe("Substring filter over title/body/command/tags"),
      kind: z.enum(["recipe", "gotcha", "deadend", "note"]).optional().describe("Restrict to one kind"),
      includeStale: z.boolean().optional().describe("Include stale recipes (default true)"),
    },
  },
  async (args) => text(await markersTool(args)),
);

server.registerTool(
  "unmark",
  {
    description: "Delete an operational marker by id.",
    inputSchema: {
      id: z.string().describe("Marker id, e.g. rcp_a1b2c3"),
      project: z.string().optional().describe("Project path (default: resolved cwd)"),
    },
  },
  async (args) => text(await unmarkTool(args)),
);

server.registerTool(
  "status",
  {
    description: "Show index stats, the active embedding backend, and the usage protocol.",
  },
  async () => text(statusTool(await getContext())),
);

server.registerTool(
  "outline",
  {
    description:
      "List the symbols (functions/classes/methods/types) defined in a file or directory, with line ranges.",
    inputSchema: { path: z.string().describe("File or directory path") },
  },
  async (args) => text(await outlineTool(await getContext(), args)),
);

server.registerTool(
  "define",
  {
    description: "Find where a symbol is defined: file:line, kind, and signature.",
    inputSchema: {
      name: z.string().describe("Symbol name to locate"),
      pathPrefix: z.string().optional().describe("Restrict to files under this path prefix"),
    },
  },
  async (args) => text(await defineTool(await getContext(), args)),
);

server.registerTool(
  "callers",
  {
    description:
      "Find call/usage sites of a symbol (identifier-aware heuristic from call sites, import-ranked).",
    inputSchema: {
      name: z.string().describe("Symbol name to find callers of"),
      pathPrefix: z.string().optional().describe("Restrict to files under this path prefix"),
    },
  },
  async (args) => text(await callersTool(await getContext(), args)),
);

server.registerTool(
  "imports",
  {
    description: "Show what a file imports (out) and/or which files import it (in).",
    inputSchema: {
      path: z.string().describe("File path"),
      direction: z.enum(["in", "out", "both"]).optional().describe("Default both"),
    },
  },
  async (args) => text(await importsTool(await getContext(), args)),
);

server.registerTool(
  "refresh",
  {
    description: "Force the index to re-scan its roots now: index new/changed files, prune deleted.",
  },
  async () => text(await refreshTool(await getContext())),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[semkeep] MCP server ready on stdio");
}

main().catch((e) => {
  console.error("[semkeep] fatal:", e);
  process.exit(1);
});
