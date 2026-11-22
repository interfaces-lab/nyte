const INDENT_SIZES = [2, 4, 8] as const;

export interface Indentation {
  readonly kind: "spaces" | "tabs";
  readonly size: (typeof INDENT_SIZES)[number];
}

export type LineEndings = "LF" | "CRLF" | "CR" | "Mixed" | "None";

export interface ResolvedIndentation {
  readonly indentation: Indentation;
  readonly source: "override" | "detected" | "default";
}

const DEFAULT_INDENTATION: Indentation = { kind: "spaces", size: 2 };

export function resolveIndentation(
  choice: Indentation | undefined,
  savedContents: string,
): ResolvedIndentation {
  if (choice !== undefined) return { indentation: choice, source: "override" };
  const detected = detectIndentation(savedContents);

  return detected === undefined
    ? { indentation: DEFAULT_INDENTATION, source: "default" }
    : { indentation: detected, source: "detected" };
}

export function readLineEndings(contents: string): LineEndings {
  const found = [
    /\r\n/u.test(contents) && ("CRLF" as const),
    /\r(?!\n)/u.test(contents) && ("CR" as const),
    /(?<!\r)\n/u.test(contents) && ("LF" as const),
  ].filter((ending) => ending !== false);

  if (found.length > 1) return "Mixed";

  return found[0] ?? "None";
}

function detectIndentation(contents: string): Indentation | undefined {
  const indents = contents
    .replace(/^\uFEFF/u, "")
    .split(/\r\n|\r|\n/u)
    .filter((line) => line.trim() !== "")
    .map((line) => /^[ \t]*/u.exec(line)?.[0] ?? "");

  const tabbed = indents.some((indent) => indent.startsWith("\t"));
  const spaced = indents.some((indent) => indent.startsWith("  "));

  if (tabbed) return spaced ? undefined : { kind: "tabs", size: DEFAULT_INDENTATION.size };

  const steps = INDENT_SIZES.map((size) => ({
    size,
    count: indents.filter(
      (indent, index) => index > 0 && indent.length - (indents[index - 1]?.length ?? 0) === size,
    ).length,
  })).toSorted((a, b) => b.count - a.count);

  const best = steps[0];

  if (best === undefined || best.count === 0 || best.count === steps[1]?.count) return undefined;

  return { kind: "spaces", size: best.size };
}
