/** Map a file path's extension to a tree-sitter grammar id, or null if unsupported. */
export function langIdFor(path: string): string | null {
  const i = path.lastIndexOf(".");
  const ext = i === -1 ? "" : path.slice(i + 1).toLowerCase();
  switch (ext) {
    case "ts":
      return "typescript";
    case "tsx":
      return "tsx";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "javascript";
    default:
      return null;
  }
}
