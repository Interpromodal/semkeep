import Parser from "web-tree-sitter";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { langIdFor } from "./grammars.js";

const require = createRequire(import.meta.url);

/** Resolve an installed package's directory, robust to exports maps. */
function pkgDir(pkg: string): string {
  return dirname(require.resolve(`${pkg}/package.json`));
}

let initPromise: Promise<void> | null = null;
const langCache = new Map<string, Parser.Language>();

function ensureInit(): Promise<void> {
  if (!initPromise) {
    const wasm = join(pkgDir("web-tree-sitter"), "tree-sitter.wasm");
    initPromise = Parser.init({ locateFile: () => wasm });
  }
  return initPromise;
}

async function loadLanguage(langId: string): Promise<Parser.Language> {
  const cached = langCache.get(langId);
  if (cached) return cached;
  const wasmPath = join(pkgDir("tree-sitter-wasms"), "out", `tree-sitter-${langId}.wasm`);
  const lang = await Parser.Language.load(readFileSync(wasmPath));
  langCache.set(langId, lang);
  return lang;
}

export interface ParseResult {
  tree: Parser.Tree;
  lang: string;
}

/**
 * Parse a source file into a tree-sitter tree. Returns null for unsupported
 * extensions or on ANY failure — callers fall back to line-window chunking, so
 * structural features degrade gracefully and never crash indexing.
 */
export async function parseFile(path: string, text: string): Promise<ParseResult | null> {
  const langId = langIdFor(path);
  if (!langId) return null;
  try {
    await ensureInit();
    const language = await loadLanguage(langId);
    const parser = new Parser();
    parser.setLanguage(language);
    const tree = parser.parse(text);
    if (!tree) return null;
    return { tree, lang: langId };
  } catch {
    return null;
  }
}
