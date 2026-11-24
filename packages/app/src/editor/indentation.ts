const SAMPLE_LINES = 2000;

/** How wide a tab is in the columns the status bar and Go to Line count, as GoLand counts them for Go. */
export const TAB_COLUMNS = 4;

const TAB_LANGUAGES = /(?:\.go|\.mod|\.work|(?:^|\/)(?:GNU)?[Mm]akefile|\.mk)$/u;

/**
 * One level of indent for a file: a tab where gofmt or make require one, else what most of its first lines start
 * with, a tab or the narrowest even run of spaces (a lone space is a comment's continuation, not an indent).
 * Undefined when no line is indented, so the line being edited decides.
 */
export function indentUnit(path: string, text: string): string | undefined {
  if (TAB_LANGUAGES.test(path)) return "\t";

  const lines = text.split("\n", SAMPLE_LINES);
  const tabbed = lines.filter((line) => line.startsWith("\t")).length;

  const spaces = lines
    .map((line) => /^ +(?=\S)/u.exec(line)?.[0].length ?? 0)
    .filter((width) => width >= 2 && width % 2 === 0);

  if (tabbed === 0 && spaces.length === 0) return undefined;

  if (tabbed >= spaces.length) return "\t";

  return " ".repeat(Math.min(8, ...spaces));
}

/**
 * The column a caret at `character` sits in, the way GoLand's status bar counts it: a tab runs to the next multiple
 * of `tabSize`, and a character outside the Basic Multilingual Plane, such as an emoji, counts once.
 */
export function visualColumn(lineText: string, character: number, tabSize: number): number {
  let column = 0;

  for (const char of lineText.slice(0, character)) {
    column = char === "\t" ? column + tabSize - (column % tabSize) : column + 1;
  }

  return column;
}

/** The character a caret goes to for a visual column, the inverse of `visualColumn`; past the end it is the end. */
export function characterAtColumn(lineText: string, column: number, tabSize: number): number {
  let reached = 0;
  let character = 0;

  for (const char of lineText) {
    if (reached >= column) return character;
    reached = char === "\t" ? reached + tabSize - (reached % tabSize) : reached + 1;
    character += char.length;
  }

  return character;
}

/** One line of a text, by its index from 0, without reading past it. */
export function lineAt(text: string, line: number): string {
  let start = 0;

  for (let index = 0; index < line; index += 1) {
    const next = text.indexOf("\n", start);

    if (next < 0) return "";
    start = next + 1;
  }

  const end = text.indexOf("\n", start);

  return text.slice(start, end < 0 ? undefined : end);
}
