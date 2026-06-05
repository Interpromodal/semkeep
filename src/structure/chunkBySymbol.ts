import type { CodeSymbol, SymbolKind } from "../types.js";
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
 * Chunk a file on symbol boundaries. Each top-level symbol is a chunk; a class
 * is split further — a header chunk plus one chunk PER METHOD — so method-level
 * detail isn't buried in a single class blob. Oversized units split into
 * line-windows; gaps (imports/prologue/loose code) become line-window chunks.
 * With no symbols, defers entirely to the line-window chunker.
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

  const emit = (startLine: number, endLine: number, name?: string, kind?: SymbolKind) => {
    if (endLine < startLine) return;
    const body = lines.slice(startLine - 1, endLine).join("\n");
    if (!body.trim()) return;
    if (endLine - startLine + 1 > maxLines) {
      out.push(...offset(chunkText(body), startLine).map((c) => ({ ...c, symbolName: name, kind })));
    } else {
      out.push({ startLine, endLine, text: body, symbolName: name, kind });
    }
  };

  for (const s of tops) {
    if (s.startLine < cursor) continue; // overlapping/nested — already covered
    if (s.startLine > cursor) {
      out.push(...offset(chunkText(lines.slice(cursor - 1, s.startLine - 1).join("\n")), cursor));
    }

    const methods = symbols
      .filter((m) => m.container === s.name && m.startLine >= s.startLine && m.endLine <= s.endLine)
      .sort((a, b) => a.startLine - b.startLine);

    if (s.kind === "class" && methods.length > 0) {
      let mcursor = s.startLine;
      for (const m of methods) {
        if (m.startLine > mcursor) emit(mcursor, m.startLine - 1, s.name, s.kind); // header / between methods
        emit(m.startLine, m.endLine, m.name, "method");
        mcursor = m.endLine + 1;
      }
      if (mcursor <= s.endLine) emit(mcursor, s.endLine, s.name, s.kind); // trailing class body
    } else {
      emit(s.startLine, s.endLine, s.name, s.kind);
    }
    cursor = s.endLine + 1;
  }

  if (cursor <= lines.length) {
    out.push(...offset(chunkText(lines.slice(cursor - 1).join("\n")), cursor));
  }
  return out;
}
