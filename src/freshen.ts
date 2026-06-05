import { readFileSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { EmbeddingProvider } from "./types.js";
import { Store } from "./store.js";
import { DEFAULT_INCLUDE, hashContent, walk } from "./chunker.js";
import { indexFile } from "./indexer.js";

export interface FreshenSummary {
  scanned: number;
  added: number;
  reindexed: number;
  pruned: number;
  elapsedMs: number;
}

function underRoot(file: string, rootPath: string): boolean {
  return file === rootPath || file.startsWith(rootPath + sep);
}

/**
 * Bring the index up to date with disk for every persisted root: index new
 * files, re-index changed ones, and prune deleted ones. A cheap stat (mtime+size)
 * fast-path avoids reading unchanged files. Never throws — per-file and per-root
 * errors are swallowed so the calling query still answers (possibly stale).
 */
export async function freshen(store: Store, embedder: EmbeddingProvider): Promise<FreshenSummary> {
  const started = Date.now();
  let scanned = 0;
  let added = 0;
  let reindexed = 0;
  let pruned = 0;

  for (const root of store.roots()) {
    let isFile = false;
    try {
      isFile = statSync(root.path).isFile();
    } catch {
      continue; // root missing (e.g. unmounted) — skip it, never mass-prune
    }
    let files: string[];
    try {
      files = isFile
        ? [resolve(root.path)]
        : walk(root.path, { include: root.include ?? DEFAULT_INCLUDE, exclude: root.exclude ?? [] });
    } catch {
      continue;
    }
    const currentSet = new Set(files);

    for (const file of files) {
      scanned++;
      let st;
      try {
        st = statSync(file);
      } catch {
        continue;
      }
      const sig = { mtime: st.mtimeMs, size: st.size };
      const prev = store.fileStat(file);
      if (prev && prev.mtime === sig.mtime && prev.size === sig.size) continue; // fast path

      let text: string;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      const hash = hashContent(text);
      const known = store.fileHash(file);
      store.setFileStat(file, sig);
      if (known === hash) continue; // content unchanged despite a stat change

      try {
        await indexFile(store, embedder, file, text, hash, sig);
      } catch {
        continue;
      }
      if (known === undefined) added++;
      else reindexed++;
    }

    // Prune anything the store still has under this (live) root but that's gone.
    for (const f of store.allIndexedFiles()) {
      if (underRoot(f, root.path) && !currentSet.has(f)) {
        store.pruneFile(f);
        pruned++;
      }
    }
  }

  return { scanned, added, reindexed, pruned, elapsedMs: Date.now() - started };
}
