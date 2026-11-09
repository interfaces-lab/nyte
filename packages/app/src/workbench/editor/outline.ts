import { getFiletypeFromFileName } from "@nyte-ai/ui/diffs";

export type SymbolKind = "function" | "class" | "type" | "variable" | "heading";

export interface OutlineSymbol {
  readonly name: string;
  readonly kind: SymbolKind;
  readonly line: number;
  readonly depth: number;
}

type Pattern = readonly [RegExp, SymbolKind];

const SCRIPT: readonly Pattern[] = [
  [/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s+([\w$]+)/u, "function"],
  [/^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([\w$]+)/u, "class"],
  [/^\s*(?:export\s+)?(?:declare\s+)?(?:interface|type|enum)\s+([\w$]+)/u, "type"],
  [/^(?:export\s+)?(?:const|let|var)\s+([\w$]+)/u, "variable"],
];

const PATTERNS = new Map<string, readonly Pattern[]>([
  ["typescript", SCRIPT],
  ["tsx", SCRIPT],
  ["javascript", SCRIPT],
  ["jsx", SCRIPT],
  [
    "python",
    [
      [/^\s*(?:async\s+)?def\s+(\w+)/u, "function"],
      [/^\s*class\s+(\w+)/u, "class"],
    ],
  ],
  [
    "go",
    [
      [/^func\s+(?:\([^)]*\)\s*)?(\w+)/u, "function"],
      [/^type\s+(\w+)/u, "type"],
    ],
  ],
  [
    "rust",
    [
      [/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)/u, "function"],
      [/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait|type)\s+(\w+)/u, "type"],
    ],
  ],
]);

export function findSymbols(path: string, contents: string): readonly OutlineSymbol[] {
  const language = getFiletypeFromFileName(path);
  const lines = contents.split(/\r?\n/u);

  if (language === "markdown" || language === "mdx") return headings(lines);
  const patterns = PATTERNS.get(language) ?? [];

  return lines.flatMap((text, index): OutlineSymbol[] => {
    for (const [pattern, kind] of patterns) {
      const name = pattern.exec(text)?.[1];

      if (name !== undefined)
        return [{ name, kind, line: index + 1, depth: Math.floor(indent(text) / 2) }];
    }

    return [];
  });
}

function headings(lines: readonly string[]): readonly OutlineSymbol[] {
  let fenced = false;

  return lines.flatMap((text, index): OutlineSymbol[] => {
    if (/^\s*(?:```|~~~)/u.test(text)) fenced = !fenced;

    if (fenced) return [];
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(text);

    return heading?.[1] === undefined || heading[2] === undefined
      ? []
      : [{ name: heading[2], kind: "heading", line: index + 1, depth: heading[1].length - 1 }];
  });
}

function indent(text: string): number {
  return (/^[ \t]*/u.exec(text)?.[0] ?? "").replaceAll("\t", "  ").length;
}
