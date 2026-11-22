import type { SnippetStop } from "@nyte-ai/schema";

interface Parse {
  readonly source: readonly string[];
  index: number;
  text: string;
  readonly stops: { readonly number: number; readonly stop: SnippetStop }[];
}

const ESCAPED = new Set(["$", "}", "\\", ",", "|"]);

/** Expands an LSP snippet to its text and tab stops: placeholders keep their default, choices their first option, variables their default or nothing; `$0` sorts last. */
export function expandSnippet(snippet: string): {
  readonly text: string;
  readonly stops: readonly SnippetStop[];
} {
  const parse: Parse = { source: Array.from(snippet), index: 0, text: "", stops: [] };
  readUntil(parse, null);
  const rank = (number: number): number => (number === 0 ? Number.POSITIVE_INFINITY : number);

  return {
    text: parse.text,
    stops: parse.stops
      .toSorted((left, right) => rank(left.number) - rank(right.number))
      .map((entry) => entry.stop),
  };
}

function readUntil(parse: Parse, terminator: string | null): void {
  while (parse.index < parse.source.length) {
    const character = parse.source[parse.index] ?? "";

    if (character === terminator) return;
    const next = parse.source[parse.index + 1];

    if (character === "\\" && next !== undefined && ESCAPED.has(next)) {
      parse.text += next;
      parse.index += 2;
      continue;
    }

    parse.index += 1;

    if (character === "$") readDollar(parse);
    else parse.text += character;
  }
}

function readDollar(parse: Parse): void {
  const number = readDigits(parse);

  if (number !== null) return addStop(parse, number, parse.text.length);

  if (parse.source[parse.index] !== "{") {
    if (readName(parse) === "") parse.text += "$";

    return;
  }

  parse.index += 1;
  const braced = readDigits(parse);
  const start = parse.text.length;

  if (braced === null) readName(parse);

  if (parse.source[parse.index] === ":") {
    parse.index += 1;
    readUntil(parse, "}");
  } else if (braced !== null && parse.source[parse.index] === "|") {
    parse.index += 1;
    readChoice(parse);
  } else {
    while (parse.index < parse.source.length && parse.source[parse.index] !== "}") parse.index += 1;
  }

  parse.index += 1;

  if (braced !== null) addStop(parse, braced, start);
}

function readChoice(parse: Parse): void {
  let first = true;

  while (parse.index < parse.source.length && parse.source[parse.index] !== "|") {
    const character = parse.source[parse.index] ?? "";

    if (character === "\\" && parse.index + 1 < parse.source.length) {
      if (first) parse.text += parse.source[parse.index + 1] ?? "";
      parse.index += 2;
      continue;
    }

    if (character === ",") first = false;
    else if (first) parse.text += character;
    parse.index += 1;
  }

  parse.index += 1;
}

function addStop(parse: Parse, number: number, start: number): void {
  if (parse.stops.some((entry) => entry.number === number)) return;
  parse.stops.push({
    number,
    stop: { utf16Start: start, utf16Length: parse.text.length - start },
  });
}

function readDigits(parse: Parse): number | null {
  const start = parse.index;

  while (/^[0-9]$/.test(parse.source[parse.index] ?? "")) parse.index += 1;

  return parse.index > start ? Number(parse.source.slice(start, parse.index).join("")) : null;
}

function readName(parse: Parse): string {
  const start = parse.index;

  while (/^[A-Za-z0-9_]$/.test(parse.source[parse.index] ?? "")) parse.index += 1;

  return parse.source.slice(start, parse.index).join("");
}
