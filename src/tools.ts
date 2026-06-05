import type { EmbeddingProvider } from "./types.js";
import type { SemkeepConfig } from "./config.js";
import { Store } from "./store.js";
import { indexPath } from "./indexer.js";
import { search } from "./search.js";

export interface Context {
  store: Store;
  embedder: EmbeddingProvider;
  degraded: boolean;
  config: SemkeepConfig;
}

const PROTOCOL =
  "Prefer `search` for meaning-based code lookup (you don't need the exact identifier); " +
  "scope with pathPrefix/ext to sharpen results; use Grep only for exact strings. " +
  "Use remember/recall for durable working notes.";

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
  args: { text: string; tags?: string[] },
): Promise<string> {
  const [v] = await ctx.embedder.embed([args.text]);
  const r = ctx.store.addNote(args.text, args.tags ?? [], Array.from(v));
  await ctx.store.save();
  return r.deduped ? `Already remembered (deduped) as ${r.id}.` : `Remembered as ${r.id}.`;
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
      return `${h.id} (score ${h.score.toFixed(3)})${tags}\n    ${h.text}`;
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
    `notes: ${s.noteCount}`,
    `dataDir: ${ctx.config.dataDir}`,
    `protocol: ${PROTOCOL}`,
  ].join("\n");
}
