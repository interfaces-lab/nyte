import type { CompletionItem, TextPosition, TextRange } from "@nyte-ai/schema";

export const WORD_CHARACTER = /[\p{L}\p{N}_$]/u;

const WORDS = /^[\p{L}\p{N}_$]*$/u;

const BOUNDARY = /[^\p{L}\p{N}]/u;

export interface RankedCompletion {
  readonly item: CompletionItem;
  readonly matches: readonly number[];
}

export function wordStart(line: string, column: number): number {
  let start = column;

  while (start > 0 && WORD_CHARACTER.test(line.charAt(start - 1))) start -= 1;

  return start;
}

export function continuesWord(line: string, start: number, caret: number): boolean {
  return caret >= start && WORDS.test(line.slice(start, caret));
}

export function rankCompletions(
  items: readonly CompletionItem[],
  line: string,
  caret: TextPosition,
  start: number,
): readonly RankedCompletion[] {
  return items
    .flatMap((item) => {
      const replace = item.insert.replace;

      const from =
        replace !== null &&
        replace.start.line === caret.line &&
        replace.start.utf16Column <= caret.utf16Column
          ? replace.start.utf16Column
          : start;

      const found = scoreMatch(line.slice(from, caret.utf16Column), item.filter);
      const lead = item.filter.endsWith(item.label) ? item.filter.length - item.label.length : -1;

      return found === undefined
        ? []
        : [
            {
              item,
              score: found.score,
              matches:
                lead < 0
                  ? []
                  : found.matches.map((index) => index - lead).filter((index) => index >= 0),
            },
          ];
    })
    .toSorted(
      (left, right) =>
        right.score - left.score ||
        compareText(left.item.sort, right.item.sort) ||
        compareText(left.item.label, right.item.label),
    )
    .map((entry) => ({ item: entry.item, matches: entry.matches }));
}

export function completionInsert(
  item: CompletionItem,
  at: {
    readonly line: string;
    readonly caret: TextPosition;
    readonly requested: TextPosition;
    readonly start: number;
  },
) {
  const replace = item.insert.replace;
  const typed = at.caret.utf16Column - at.requested.utf16Column;
  const indent = /^[\t ]*/u.exec(at.line)?.[0] ?? "";
  const source = item.insert.text;
  const stop = item.insert.stops.at(-1) ?? { utf16Start: source.length, utf16Length: 0 };
  const shift = (offset: number): number => offset + indent.length * lineBreaks(source, offset);

  const end =
    replace === null
      ? at.caret
      : replace.end.line === at.caret.line && replace.end.utf16Column >= at.requested.utf16Column
        ? {
            line: replace.end.line,
            utf16Column: Math.max(replace.end.utf16Column + typed, at.caret.utf16Column),
          }
        : replace.end;

  return {
    range: {
      start: replace?.start ?? { line: at.caret.line, utf16Column: at.start },
      end,
    } satisfies TextRange,
    text: source.replaceAll("\n", `\n${indent}`),
    caret: {
      start: shift(stop.utf16Start),
      length: shift(stop.utf16Start + stop.utf16Length) - shift(stop.utf16Start),
    },
  };
}

function scoreMatch(
  query: string,
  filter: string,
): { readonly score: number; readonly matches: readonly number[] } | undefined {
  if (query === "") return { score: 0, matches: [] };
  const lower = filter.toLowerCase();
  const wanted = query.toLowerCase();

  if (lower.startsWith(wanted)) {
    return {
      score: filter.startsWith(query) ? 4 : 3,
      matches: Array.from({ length: query.length }, (_, index) => index),
    };
  }

  const matches: number[] = [];
  let boundaries = 0;

  for (const character of wanted) {
    const from = (matches.at(-1) ?? -1) + 1;
    const next = findBoundary(filter, character, from);
    const index = next ?? (matches.length === 0 ? -1 : lower.indexOf(character, from));

    if (index < 0) return undefined;

    if (next !== undefined) boundaries += 1;
    matches.push(index);
  }

  return { score: boundaries === matches.length ? 2 : 1, matches };
}

function findBoundary(filter: string, character: string, from: number): number | undefined {
  for (let index = from; index < filter.length; index += 1) {
    const current = filter.charAt(index);
    const previous = filter.charAt(index - 1);

    const boundary =
      index === 0 ||
      BOUNDARY.test(previous) ||
      (current !== current.toLowerCase() && previous === previous.toLowerCase());

    if (boundary && current.toLowerCase() === character) return index;
  }

  return undefined;
}

function lineBreaks(text: string, end: number): number {
  return text.slice(0, end).split("\n").length - 1;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
