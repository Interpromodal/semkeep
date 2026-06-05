import { resolve } from "node:path";
import type { EmbeddingProvider, Note } from "./types.js";
import type { SemkeepConfig } from "./config.js";
import { Store } from "./store.js";
import { indexPath } from "./indexer.js";
import { search } from "./search.js";
import { freshen } from "./freshen.js";

export interface Context {
  store: Store;
  embedder: EmbeddingProvider;
  degraded: boolean;
  config: SemkeepConfig;
}

const PROTOCOL =
  "Prefer `search` for meaning-based code lookup (you don't need the exact identifier); " +
  "scope with pathPrefix/ext to sharpen results; use Grep only for exact strings. " +
  "For structural questions use define (where is X defined), outline (what's in this file), " +
  "callers (who calls X), imports (dependency edges). Use remember/recall for durable notes.";

// Debounced auto-freshen state, per server process.
let lastFreshenAt = 0;

/** Bring the index up to date before a query, respecting autoRefresh + debounce. */
export async function maybeFreshen(ctx: Context): Promise<void> {
  if (!ctx.config.autoRefresh) return;
  const now = Date.now();
  if (now - lastFreshenAt < ctx.config.refreshDebounceMs) return;
  lastFreshenAt = now;
  const r = await freshen(ctx.store, ctx.embedder);
  if (r.added || r.reindexed || r.pruned) await ctx.store.save();
}

/** Render an anchored-notes block to append under define/outline output. */
function formatNotes(notes: Note[]): string {
  if (!notes.length) return "";
  return (
    "\n\nNotes:\n" +
    notes
      .map((n) => `  • ${n.text}${n.tags.length ? ` [${n.tags.join(", ")}]` : ""} (${n.id})`)
      .join("\n")
  );
}

/** Force an index refresh now (bypasses the debounce). */
export async function refreshTool(ctx: Context): Promise<string> {
  const r = await freshen(ctx.store, ctx.embedder);
  await ctx.store.save();
  return `Refreshed: +${r.added} new, ${r.reindexed} changed, -${r.pruned} pruned (scanned ${r.scanned}) in ${r.elapsedMs}ms.`;
}

/**
 * Ensure the store's embedder matches the active provider. If the dimension
 * changed since last run (e.g. an API key was added), re-embed notes from their
 * stored text and drop the code index so it can be rebuilt — never crash.
 */
export async function ensureEmbedder(store: Store, provider: EmbeddingProvider): Promise<void> {
  const dim = store.stats().dim;
  if (dim !== 0 && dim !== provider.dim) {
    const old = store.exportNotes();
    const vecs = old.length ? await provider.embed(old.map((n) => n.text)) : [];
    const re = old.map((n, i) => ({ ...n, vector: Array.from(vecs[i]) }));
    store.rebuildForEmbedder(provider.name, provider.dim, re);
    await store.save();
    console.error(
      `[semkeep] embedder changed to ${provider.name} (dim ${provider.dim}); ` +
        `cleared code index (re-run index_path) and re-embedded ${old.length} note(s).`,
    );
  } else {
    store.setEmbedderMeta(provider.name, provider.dim);
  }
}

export async function indexPathTool(
  ctx: Context,
  args: { path: string; include?: string[]; exclude?: string[]; force?: boolean },
): Promise<string> {
  const r = await indexPath(ctx.store, ctx.embedder, args.path, {
    include: args.include,
    exclude: args.exclude,
    force: args.force,
  });
  await ctx.store.save();
  return (
    `Indexed ${r.filesIndexed} file(s): ${r.chunksAdded} chunks added, ${r.filesSkipped} unchanged, ` +
    `in ${r.elapsedMs}ms via the ${r.embedder} embedder${ctx.degraded ? " (DEGRADED lexical)" : ""}.\n` +
    `Store: ${ctx.config.dataDir}`
  );
}

export async function searchTool(
  ctx: Context,
  args: { query: string; k?: number; pathPrefix?: string; ext?: string[]; mode?: "semantic" | "hybrid" },
): Promise<string> {
  await maybeFreshen(ctx);
  const hits = await search(ctx.store, ctx.embedder, args.query, {
    k: args.k,
    pathPrefix: args.pathPrefix,
    ext: args.ext,
    mode: args.mode,
  });
  if (!hits.length) {
    return "No matches. Index a folder first with index_path, or widen the query / drop scoping.";
  }
  return hits
    .map((h) => {
      const body = h.snippet
        .split("\n")
        .map((l) => "    " + l)
        .join("\n");
      return `${h.file}:${h.startLine}-${h.endLine}  (score ${h.score.toFixed(3)})\n${body}`;
    })
    .join("\n\n");
}

export async function rememberTool(
  ctx: Context,
  args: { text: string; tags?: string[]; symbol?: string; file?: string },
): Promise<string> {
  const anchor =
    args.symbol || args.file
      ? { symbol: args.symbol, file: args.file ? resolve(args.file) : undefined }
      : undefined;
  const [v] = await ctx.embedder.embed([args.text]);
  const r = ctx.store.addNote(args.text, args.tags ?? [], Array.from(v), anchor);
  await ctx.store.save();
  const where = anchor
    ? ` (anchored to ${[anchor.symbol ? "@" + anchor.symbol : "", anchor.file ?? ""].filter(Boolean).join(" ")})`
    : "";
  return (r.deduped ? `Already remembered (deduped) as ${r.id}` : `Remembered as ${r.id}`) + where + ".";
}

export async function recallTool(
  ctx: Context,
  args: { query: string; k?: number },
): Promise<string> {
  const [v] = await ctx.embedder.embed([args.query]);
  const hits = ctx.store.searchNotes(Array.from(v), args.k ?? 5);
  if (!hits.length) return "No notes yet. Use remember to store one.";
  return hits
    .map((h) => {
      const tags = h.tags.length ? ` [${h.tags.join(", ")}]` : "";
      const anchor = h.anchor?.symbol
        ? ` ↳ @${h.anchor.symbol}`
        : h.anchor?.file
          ? ` ↳ ${h.anchor.file}`
          : "";
      return `${h.id} (score ${h.score.toFixed(3)})${tags}${anchor}\n    ${h.text}`;
    })
    .join("\n\n");
}

export async function forgetTool(ctx: Context, args: { id: string }): Promise<string> {
  const ok = ctx.store.deleteNote(args.id);
  if (ok) await ctx.store.save();
  return ok ? `Forgot ${args.id}.` : `No note with id ${args.id}.`;
}

export function statusTool(ctx: Context): string {
  const s = ctx.store.stats();
  const degradedNote = ctx.degraded
    ? " — DEGRADED lexical fallback; add OPENAI_API_KEY/VOYAGE_API_KEY, run Ollama, or install @huggingface/transformers for true semantic search"
    : "";
  return [
    `embedder: ${s.embedder || ctx.embedder.name} (dim ${s.dim || ctx.embedder.dim})${degradedNote}`,
    `indexed: ${s.fileCount} files, ${s.chunkCount} chunks`,
    `structure: ${s.symbolCount} symbols, ${s.importCount} imports`,
    `roots: ${ctx.store.roots().length} (auto-refresh ${ctx.config.autoRefresh ? "on" : "off"})`,
    `notes: ${s.noteCount}`,
    `dataDir: ${ctx.config.dataDir}`,
    `protocol: ${PROTOCOL}`,
  ].join("\n");
}

export async function outlineTool(ctx: Context, args: { path: string }): Promise<string> {
  await maybeFreshen(ctx);
  const file = resolve(args.path);
  const syms = ctx.store.outline(file);
  const noteBlock = formatNotes(ctx.store.notesForFile(file, syms.map((s) => s.name)));
  if (!syms.length) {
    return noteBlock
      ? `No symbols for ${file}.${noteBlock}`
      : `No symbols for ${file} (not indexed, or no parseable code).`;
  }
  return (
    syms
      .map((s) => {
        const indent = s.container ? "    " : "  ";
        const exp = s.exported ? "export " : "";
        const qual = s.container ? `${s.container}.` : "";
        return `${indent}${exp}${s.kind} ${qual}${s.name}  (${s.startLine}-${s.endLine})`;
      })
      .join("\n") + noteBlock
  );
}

export async function defineTool(
  ctx: Context,
  args: { name: string; pathPrefix?: string },
): Promise<string> {
  await maybeFreshen(ctx);
  const defs = ctx.store.findDefinitions(args.name, args.pathPrefix);
  const noteBlock = formatNotes(ctx.store.notesForSymbol(args.name));
  if (!defs.length) return `No definition found for "${args.name}".${noteBlock}`;
  return (
    defs
      .map((s) => {
        const sig = s.signature ? `\n    ${s.signature}` : "";
        return `${s.file}:${s.startLine}  ${s.exported ? "export " : ""}${s.kind} ${s.name}${sig}`;
      })
      .join("\n\n") + noteBlock
  );
}

export async function callersTool(
  ctx: Context,
  args: { name: string; pathPrefix?: string },
): Promise<string> {
  await maybeFreshen(ctx);
  const refs = ctx.store.findReferences(args.name, args.pathPrefix);
  if (!refs.length) return `No call sites found for "${args.name}" (heuristic: call/new sites only).`;
  const shown = refs.slice(0, 50).map((r) => `${r.file}:${r.line}`);
  const more = refs.length > 50 ? `\n… and ${refs.length - 50} more` : "";
  return shown.join("\n") + more;
}

export async function importsTool(
  ctx: Context,
  args: { path: string; direction?: "in" | "out" | "both" },
): Promise<string> {
  await maybeFreshen(ctx);
  const file = resolve(args.path);
  const dir = args.direction ?? "both";
  const parts: string[] = [];
  if (dir === "out" || dir === "both") {
    const out = ctx.store.importsOf(file);
    parts.push(
      out.length
        ? "imports (out):\n" + out.map((i) => `  ${i.source}  [${i.names.join(", ")}]`).join("\n")
        : "imports (out): none",
    );
  }
  if (dir === "in" || dir === "both") {
    const inn = ctx.store.importedBy(file);
    parts.push(
      inn.length ? "imported by (in):\n" + inn.map((i) => `  ${i.file}`).join("\n") : "imported by (in): none",
    );
  }
  return parts.join("\n\n");
}
