import type { CodeSymbol } from "../types.js";
import { chunkText, type RawChunk } from "../chunker.js";

const MAX_SYMBOL_LINES = 60;

/** Offset a chunk's 1-based lines so they map back onto the whole file. */
function offset(chunks: RawChunk[], base: number): RawChunk[] {
  return chunks.map((c) => ({
    ...c,
    startLine: base + c.startLine - 1,
    endLine: base + c.endLine - 1,
  }));
}

/**
 * Chunk a file on symbol boundaries: one chunk per top-level symbol (methods
 * are covered by their class). Oversized symbols are split into line-windows
 * within their range; lines not covered by any symbol (imports/prologue/loose
 * code) become fallback line-window chunks. With no symbols, defers entirely to
 * the line-window chunker.
 */
export function symbolChunks(
  text: string,
  symbols: CodeSymbol[],
  maxLines = MAX_SYMBOL_LINES,
): RawChunk[] {
  if (symbols.length === 0) return chunkText(text);
  const lines = text.split("\n");
  const tops = symbols.filter((s) => !s.container).sort((a, b) => a.startLine - b.startLine);
  const out: RawChunk[] = [];
  let cursor = 1; // next uncovered file line (1-based)

  for (const s of tops) {
    if (s.startLine < cursor) continue; // overlapping/nested — already covered
    if (s.startLine > cursor) {
      const gap = lines.slice(cursor - 1, s.startLine - 1).join("\n");
      out.push(...offset(chunkText(gap), cursor));
    }
    const body = lines.slice(s.startLine - 1, s.endLine).join("\n");
    const span = s.endLine - s.startLine + 1;
    if (span > maxLines) {
      out.push(...offset(chunkText(body), s.startLine).map((c) => ({ ...c, symbolName: s.name, kind: s.kind })));
    } else if (body.trim()) {
      out.push({ startLine: s.startLine, endLine: s.endLine, text: body, symbolName: s.name, kind: s.kind });
    }
    cursor = s.endLine + 1;
  }

  if (cursor <= lines.length) {
    const gap = lines.slice(cursor - 1).join("\n");
    out.push(...offset(chunkText(gap), cursor));
  }
  return out;
}
