import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

/** File extensions (no leading dot) indexed by default. */
export const DEFAULT_INCLUDE = [
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "go", "rs", "java", "rb", "php",
  "c", "cpp", "cc", "h", "hpp", "cs", "kt", "swift", "scala", "sh", "bash",
  "md", "mdx", "txt", "json", "yaml", "yml", "toml", "html", "css", "scss",
  "sql", "vue", "svelte",
];

/** Directory names skipped during the walk. */
export const DEFAULT_IGNORE_DIRS = new Set([
  ".git", "node_modules", "dist", "build", ".next", "out", "coverage",
  ".mindpalace", "vendor", ".venv", "venv", "__pycache__", "target",
  ".turbo", ".cache",
]);

const MAX_FILE_BYTES = 1.5 * 1024 * 1024;

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i + 1).toLowerCase();
}

/** Heuristic: a NUL byte in the first 4KB means "binary", so skip it. */
function looksBinary(path: string): boolean {
  try {
    const buf = readFileSync(path);
    const n = Math.min(buf.length, 4096);
    for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
    return false;
  } catch {
    return true; // unreadable -> treat as skippable
  }
}

export interface WalkOptions {
  include: string[];
  exclude: string[]; // substring matches against the full path
}

/** Recursively collect indexable file paths under `root`. */
export function walk(root: string, opts: WalkOptions): string[] {
  const includeSet = new Set(opts.include.map((e) => e.toLowerCase()));
  const out: string[] = [];

  const visit = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable dir
    }
    for (const ent of entries) {
      const full = join(dir, ent.name);
      if (opts.exclude.some((x) => full.includes(x))) continue;
      if (ent.isDirectory()) {
        if (DEFAULT_IGNORE_DIRS.has(ent.name)) continue;
        visit(full);
      } else if (ent.isFile()) {
        if (!includeSet.has(extOf(ent.name))) continue;
        try {
          if (statSync(full).size > MAX_FILE_BYTES) continue;
        } catch {
          continue;
        }
        if (looksBinary(full)) continue;
        out.push(full);
      }
    }
  };

  visit(root);
  return out;
}

export interface RawChunk {
  startLine: number; // 1-based inclusive
  endLine: number; // 1-based inclusive
  text: string;
}

/**
 * Split text into line-aware windows with overlap. `step = window - overlap`.
 * Empty/whitespace-only chunks are dropped.
 */
export function chunkText(text: string, window = 50, overlap = 10): RawChunk[] {
  const lines = text.split("\n");
  const step = Math.max(1, window - overlap);
  const chunks: RawChunk[] = [];
  for (let start = 0; start < lines.length; start += step) {
    const end = Math.min(start + window, lines.length);
    const slice = lines.slice(start, end);
    const body = slice.join("\n");
    if (body.trim().length > 0) {
      chunks.push({ startLine: start + 1, endLine: end, text: body });
    }
    if (end >= lines.length) break;
  }
  return chunks;
}

/** Stable content hash for skip-unchanged detection. */
export function hashContent(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}
