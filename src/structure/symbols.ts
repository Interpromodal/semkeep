import type Parser from "web-tree-sitter";
import type { CodeSymbol, ImportEdge, SymbolKind } from "../types.js";

const KIND_BY_TYPE: Record<string, SymbolKind> = {
  function_declaration: "function",
  generator_function_declaration: "function",
  class_declaration: "class",
  interface_declaration: "interface",
  type_alias_declaration: "type",
  enum_declaration: "enum",
};

const DECL_TYPES = new Set([
  ...Object.keys(KIND_BY_TYPE),
  "lexical_declaration",
  "variable_declaration",
]);

function unquote(s: string): string {
  return s.replace(/^['"`]|['"`]$/g, "");
}

/**
 * Extract code symbols from a parsed tree. Handles the two shapes the spike
 * surfaced: exported declarations are wrapped in `export_statement`, and
 * `const` lives under `lexical_declaration → variable_declarator`.
 */
export function extractSymbols(
  tree: Parser.Tree,
  file: string,
  fileHash: string,
): CodeSymbol[] {
  const out: CodeSymbol[] = [];
  const lines = tree.rootNode.text.split("\n");
  const prefix = fileHash.slice(0, 12);

  const push = (
    node: Parser.SyntaxNode,
    name: string,
    kind: SymbolKind,
    exported: boolean,
    container?: string,
  ) => {
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;
    out.push({
      id: `${prefix}:${startLine}:${name}`,
      file,
      name,
      kind,
      startLine,
      endLine,
      exported,
      container,
      signature: (lines[startLine - 1] ?? "").trim().slice(0, 200),
    });
  };

  const handleDecl = (node: Parser.SyntaxNode, exported: boolean) => {
    const t = node.type;
    if (t in KIND_BY_TYPE) {
      const name = node.childForFieldName("name")?.text;
      if (name) push(node, name, KIND_BY_TYPE[t], exported);
      if (t === "class_declaration") {
        const body = node.childForFieldName("body");
        if (body) {
          for (const m of body.namedChildren) {
            if (m.type === "method_definition") {
              const mn = m.childForFieldName("name")?.text;
              if (mn && name) push(m, mn, "method", false, name);
            }
          }
        }
      }
    } else if (t === "lexical_declaration" || t === "variable_declaration") {
      const kind: SymbolKind = t === "lexical_declaration" ? "const" : "variable";
      for (const d of node.namedChildren) {
        if (d.type === "variable_declarator") {
          const vn = d.childForFieldName("name")?.text;
          if (vn) push(d, vn, kind, exported);
        }
      }
    }
  };

  for (const node of tree.rootNode.namedChildren) {
    if (node.type === "export_statement") {
      const decl = node.namedChildren.find((c) => DECL_TYPES.has(c.type));
      if (decl) handleDecl(decl, true);
    } else {
      handleDecl(node, false);
    }
  }
  return out;
}

/** Extract import edges (module specifier + imported names). */
export function extractImports(tree: Parser.Tree, file: string): ImportEdge[] {
  const out: ImportEdge[] = [];
  for (const node of tree.rootNode.namedChildren) {
    if (node.type !== "import_statement") continue;
    const source = node.childForFieldName("source")?.text;
    if (!source) continue;
    const names: string[] = [];
    const clause = node.namedChildren.find((c) => c.type === "import_clause");
    if (clause) {
      for (const c of clause.namedChildren) {
        if (c.type === "identifier") names.push(c.text); // default import
        else if (c.type === "namespace_import") names.push("*");
        else if (c.type === "named_imports") {
          for (const spec of c.namedChildren) {
            if (spec.type === "import_specifier") {
              const n = spec.childForFieldName("name")?.text ?? spec.namedChildren[0]?.text;
              if (n) names.push(n);
            }
          }
        }
      }
    }
    out.push({ file, source: unquote(source), names });
  }
  return out;
}
