/**
 * Reads `sdk-spec.ts` into the blocks the page renders. Every rendered line
 * keeps its number in the file, so a grabbed line names the exact place to edit.
 */

export interface SpecLine {
  readonly number: number;
  readonly text: string;
}

export type SpecBlock =
  | { readonly kind: "part"; readonly id: string; readonly line: SpecLine }
  | {
      readonly kind: "section";
      readonly id: string;
      readonly line: SpecLine;
      readonly notes: readonly SpecLine[];
    }
  | {
      readonly kind: "note";
      readonly id: string;
      readonly title: SpecLine | undefined;
      readonly lines: readonly SpecLine[];
    }
  | {
      readonly kind: "entry";
      readonly id: string;
      readonly names: readonly [string, ...string[]];
      readonly doc: readonly SpecLine[];
      readonly code: readonly SpecLine[];
    };

const TOP_LEVEL = /^(?:\/|async function |function |type |interface |declare |const |class )/;

const DECLARATION =
  /^(?:async function|function|type|interface|declare const|const|class) ([A-Za-z_$][\w$]*)/;

const PART = /^\/\/ Part [IVX]+\. /;

const NUMBERED_SECTION = /^\/\/ \d+\. /;

function chunksOf(source: string): SpecLine[][] {
  const lines = source.split("\n");
  const chunks: SpecLine[][] = [];
  let chunk: SpecLine[] = [];

  lines.forEach((text, index) => {
    const next = lines[index + 1];

    if (text !== "") {
      chunk.push({ number: index + 1, text });

      return;
    }

    if (next !== undefined && next !== "" && !TOP_LEVEL.test(next)) {
      chunk.push({ number: index + 1, text });

      return;
    }

    if (chunk.length > 0) chunks.push(chunk);
    chunk = [];
  });

  if (chunk.length > 0) chunks.push(chunk);

  return chunks;
}

/** Splits leading comments from code. Doc text drops only the comment markers. */
function splitDoc(chunk: readonly SpecLine[]) {
  const doc: SpecLine[] = [];
  let index = 0;
  let inBlock = false;

  for (; index < chunk.length; index++) {
    const line = chunk[index];

    if (line === undefined) break;
    const { text } = line;

    if (inBlock) {
      if (text.trim() === "*/") {
        inBlock = false;
        continue;
      }

      const closes = text.trimEnd().endsWith("*/");
      doc.push({
        number: line.number,
        text: text.replace(/^ \*(?: |$)/, "").replace(/\s*\*\/$/, ""),
      });

      if (closes) inBlock = false;
      continue;
    }

    if (text.startsWith("/**")) {
      const rest = text
        .slice(3)
        .replace(/\s*\*\/$/, "")
        .trim();

      if (rest !== "") doc.push({ number: line.number, text: rest });
      inBlock = !text.trimEnd().endsWith("*/");
      continue;
    }

    if (text.startsWith("//")) {
      doc.push({ number: line.number, text: text.replace(/^\/\/ ?/, "") });
      continue;
    }

    break;
  }

  return { doc, code: chunk.slice(index) };
}

function titleOf(lines: readonly SpecLine[]): SpecLine | undefined {
  const [first, second] = lines;

  if (first === undefined || first.text.length > 60 || /[.,:;]$/.test(first.text)) return undefined;

  if (second === undefined || second.text === "" || /^(?:\s|[A-Z-])/.test(second.text)) {
    return first;
  }

  return undefined;
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function parseSpec(source: string): readonly SpecBlock[] {
  const used = new Set<string>();

  const unique = (base: string, line: number): string => {
    const id = used.has(base) || /^L\d+$/.test(base) ? `${base}-L${String(line)}` : base;
    used.add(id);

    return id;
  };

  let part = 0;

  return chunksOf(source).flatMap((chunk): SpecBlock[] => {
    const first = chunk[0];

    if (first === undefined) return [];
    const { doc, code } = splitDoc(chunk);
    const [docFirst, ...docRest] = doc;

    if (code.length === 0 && docFirst !== undefined && first.text.startsWith("//")) {
      if (PART.test(first.text) && chunk.length === 1) {
        part += 1;

        return [{ kind: "part", id: unique(`part-${String(part)}`, first.number), line: docFirst }];
      }

      if (NUMBERED_SECTION.test(first.text) || chunk.length === 1) {
        return [
          {
            kind: "section",
            id: unique(slug(docFirst.text), first.number),
            line: docFirst,
            notes: docRest,
          },
        ];
      }
    }

    const names = code.flatMap((line) => {
      const name = DECLARATION.exec(line.text)?.[1];

      return name === undefined ? [] : [name];
    });

    const [name, ...otherNames] = names;

    if (name === undefined) {
      const title = titleOf(doc);
      const id = title === undefined ? `note-L${String(first.number)}` : slug(title.text);

      return [
        {
          kind: "note",
          id: unique(id, first.number),
          title,
          lines: title === undefined ? doc.concat(code) : doc.slice(1).concat(code),
        },
      ];
    }

    return [
      {
        kind: "entry",
        id: unique(name, first.number),
        names: [name, ...otherNames],
        doc,
        code,
      },
    ];
  });
}
