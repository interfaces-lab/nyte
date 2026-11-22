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

const C_LIKE: readonly Pattern[] = [
  [/^\s*(?:template\s*<[^>]*>\s*)?class\s+(\w+)/u, "class"],
  [/^\s*(?:typedef\s+)?(?:struct|union|enum(?:\s+class)?|using)\s+(\w+)/u, "type"],
  [
    /^(?:(?:static|inline|extern|virtual|constexpr|const|unsigned|signed|struct|enum|union)\s+)*[\w:*&<>]+\s+[*&]?(\w+(?:::\w+)?)\s*\([^;]*$/u,
    "function",
  ],
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
  ["c", C_LIKE],
  ["cpp", C_LIKE],
  ["objective-cpp", C_LIKE],
  [
    "swift",
    [
      [
        /^\s*(?:(?:public|private|fileprivate|internal|open|package|static|class|final|override|mutating|nonmutating|async)\s+)*func\s+(\w+)/u,
        "function",
      ],
      [
        /^\s*(?:(?:public|private|fileprivate|internal|open|package|final|indirect)\s+)*(?:class|actor)\s+(\w+)/u,
        "class",
      ],
      [
        /^\s*(?:(?:public|private|fileprivate|internal|open|package|indirect)\s+)*(?:struct|enum|protocol|extension|typealias)\s+(\w+)/u,
        "type",
      ],
    ],
  ],
  [
    "sql",
    [
      [
        /^\s*create\s+(?:or\s+replace\s+)?(?:function|procedure|trigger)\s+(?:if\s+not\s+exists\s+)?(?:\w+\.)?"?(\w+)"?/iu,
        "function",
      ],
      [
        /^\s*create\s+(?:or\s+replace\s+)?(?:(?:temp|temporary|unlogged)\s+)?(?:materialized\s+)?(?:table|view|type)\s+(?:if\s+not\s+exists\s+)?(?:\w+\.)?"?(\w+)"?/iu,
        "type",
      ],
    ],
  ],
  ["toml", [[/^\s*\[{1,2}\s*([^\]]+?)\s*\]{1,2}\s*(?:#.*)?$/u, "heading"]]],
  [
    "java",
    [
      [
        /^\s*(?:(?:public|protected|private|static|final|abstract|sealed|non-sealed)\s+)*(?:class|record)\s+(\w+)/u,
        "class",
      ],
      [
        /^\s*(?:(?:public|protected|private|static|final|abstract|sealed|non-sealed)\s+)*(?:interface|enum|@interface)\s+(\w+)/u,
        "type",
      ],
      [
        /^\s*(?:(?:public|protected|private|static|final|abstract|synchronized|default)\s+)+(?:[\w$.<>[\],?]+\s+)+(\w+)\s*\(/u,
        "function",
      ],
    ],
  ],
  [
    "ruby",
    [
      [/^\s*def\s+(?:self\.)?(\w+[?!=]?)/u, "function"],
      [/^\s*(?:class|module)\s+([A-Z][\w:]*)/u, "class"],
    ],
  ],
]);

export function findSymbols(path: string, contents: string): readonly OutlineSymbol[] {
  const language = getFiletypeFromFileName(path);

  if (language === "markdown" || language === "mdx") return headings(contents.split(/\r?\n/u));
  const patterns = PATTERNS.get(language);

  if (patterns === undefined) return [];

  return contents.split(/\r?\n/u).flatMap((text, index): OutlineSymbol[] => {
    for (const [pattern, kind] of patterns) {
      const name = pattern.exec(text)?.[1];

      if (name !== undefined) {
        return [{ name, kind, line: index + 1, depth: Math.floor(indent(text) / 2) }];
      }
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
