import { getFiletypeFromFileName } from "@pierre/diffs";
import type { SupportedLanguages } from "@pierre/diffs";
import type { EditorSelection } from "@pierre/diffs/edit";
import { selectedLines } from "./editor-selection.ts";

export const INDENT_SIZES = [2, 4, 8] as const;

export interface Indentation {
  readonly kind: "spaces" | "tabs";
  readonly size: (typeof INDENT_SIZES)[number];
}

/** What a person picked for one open file. Undefined goes back to detection. */
export interface FileEditingChoices {
  readonly indentation: Indentation | undefined;
  readonly language: SupportedLanguages | undefined;
}

export type LineEndings = "LF" | "CRLF" | "CR" | "Mixed" | "None";

/** Where the primary caret is, and how much the selections cover in UTF-16 units. */
export interface FilePosition {
  readonly line: number;
  readonly column: number;
  readonly selected: number;
  readonly lines: number;
  readonly selections: number;
}

/** The indentation the editor applies, and whether a person, the saved text or the default chose it. */
export interface ResolvedIndentation {
  readonly indentation: Indentation;
  readonly source: "override" | "detected" | "default";
}

/** The language the editor applies, and whether a person or the filename chose it. */
export interface ResolvedLanguage {
  readonly language: SupportedLanguages;
  readonly source: "override" | "detected";
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

export function resolveLanguage(
  choice: SupportedLanguages | undefined,
  path: string,
): ResolvedLanguage {
  return choice === undefined
    ? { language: getFiletypeFromFileName(path), source: "detected" }
    : { language: choice, source: "override" };
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

export function readFilePosition(
  contents: string,
  selections: readonly EditorSelection[],
): FilePosition | undefined {
  const primary = selections.at(-1);

  if (primary === undefined) return undefined;
  const focus = primary.direction === -1 ? primary.start : primary.end;
  const lines = selectedLines(primary);

  const starts = selections.some((selection) => selection.start.line !== selection.end.line)
    ? lineStarts(contents)
    : undefined;

  const selected = selections.reduce(
    (total, selection) =>
      total +
      (starts === undefined
        ? selection.end.character - selection.start.character
        : offsetAt(starts, selection.end) - offsetAt(starts, selection.start)),
    0,
  );

  return {
    line: focus.line + 1,
    column: focus.character + 1,
    selected,
    lines: lines === undefined ? 0 : lines.end - lines.start + 1,
    selections: selections.length,
  };
}

export function formatPosition(position: FilePosition): string {
  const at = `Ln ${String(position.line)}, Col ${String(position.column)}`;
  const selected = `${String(position.selected)} selected`;

  if (position.selections > 1)
    return `${at} (${String(position.selections)} selections${position.selected > 0 ? `, ${selected}` : ""})`;

  if (position.lines > 1) return `${at} (${selected}, ${String(position.lines)} lines)`;

  return position.selected > 0 ? `${at} (${selected})` : at;
}

/**
 * Tabs when lines indent with tabs and none with two spaces. Otherwise the most common step
 * between neighbouring space-indented lines, when it is 2, 4 or 8 and wins outright. A single
 * leading space, as in a doc comment's ` * `, is not a style.
 */
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

function lineStarts(contents: string): readonly number[] {
  return [
    0,
    ...Array.from(contents.matchAll(/\r\n|\r|\n/gu), (match) => match.index + match[0].length),
  ];
}

function offsetAt(starts: readonly number[], position: EditorSelection["start"]): number {
  return (starts[position.line] ?? 0) + position.character;
}
