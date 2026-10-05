/**
 * Ties a guide's prose to its code. The reviewer writes plain sentences, so
 * the page finds the code in them: a word that reads as code (a call, a dotted
 * name, camelCase, snake_case, a file name) becomes code type, and when the
 * section's diff holds it, a link to the changed line that does.
 */
import type { ReviewFile } from "./code";

export interface LineTarget {
  readonly path: string;
  readonly line: number;
  readonly side: "additions" | "deletions";
  /** Pierre's row type: a deleted and an added line can share a number. */
  readonly row: "change-addition" | "change-deletion" | "context";
}

export type ProseSegment =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "code"; readonly text: string; readonly target: LineTarget | undefined }
  | { readonly kind: "file"; readonly text: string; readonly path: string };

interface PatchLine extends LineTarget {
  readonly text: string;
}

const WORD = /[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\(\))?/g;

const FILE = /\.(?:[cm]?[jt]sx?|css|json|md|mdx|ya?ml|toml|rs|go|py|sh|html)$/;

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Code by its shape alone: a call, a dotted name, or snake_case. */
const writtenAsCode = (word: string): boolean =>
  word.endsWith("()") || word.includes("_") || /[\w$]{2,}\.[\w$]{2,}/.test(word);

/** camelCase reads as code too, but only counts when the diff holds it: prose has its iPhones. */
const camel = (word: string): boolean => /[a-z][A-Z]/.test(word);

function patchLines(file: ReviewFile): readonly PatchLine[] {
  const lines: PatchLine[] = [];
  let before = 0;
  let after = 0;
  let started = false;

  for (const raw of file.patch.split("\n")) {
    const hunk = HUNK.exec(raw);

    if (hunk !== null) {
      before = Number(hunk[1]);
      after = Number(hunk[2]);
      started = true;

      continue;
    }

    if (!started) continue;

    const text = raw.slice(1);

    if (raw.startsWith("+")) {
      lines.push({ path: file.path, line: after, side: "additions", row: "change-addition", text });
      after += 1;
    } else if (raw.startsWith("-")) {
      lines.push({
        path: file.path,
        line: before,
        side: "deletions",
        row: "change-deletion",
        text,
      });
      before += 1;
    } else if (raw.startsWith(" ")) {
      lines.push({ path: file.path, line: after, side: "additions", row: "context", text });
      before += 1;
      after += 1;
    }
  }

  return lines;
}

/** The changed line that holds `name`, else the context line that does. */
function lineOf(name: string, lines: readonly PatchLine[]): LineTarget | undefined {
  const pattern = new RegExp(`(?<![\\w$])${name.replaceAll(/[.$]/g, "\\$&")}(?![\\w$])`);
  const holding = lines.filter((line) => pattern.test(line.text));
  const found = holding.find((line) => line.row !== "context") ?? holding[0];

  return found === undefined
    ? undefined
    : { path: found.path, line: found.line, side: found.side, row: found.row };
}

export function linkProse(text: string, files: readonly ReviewFile[]): readonly ProseSegment[] {
  const lines = files.flatMap(patchLines);
  const segments: ProseSegment[] = [];
  let from = 0;

  for (const match of text.matchAll(WORD)) {
    const word = match[0];

    if (!writtenAsCode(word) && !camel(word)) continue;

    const file = FILE.test(word)
      ? files.find((entry) => entry.path === word || entry.path.endsWith(`/${word}`))
      : undefined;

    const target = file === undefined ? lineOf(word.replace(/\(\)$/, ""), lines) : undefined;

    if (file === undefined && target === undefined && !writtenAsCode(word)) continue;

    if (match.index > from) segments.push({ kind: "text", text: text.slice(from, match.index) });

    from = match.index + word.length;
    segments.push(
      file === undefined
        ? { kind: "code", text: word, target }
        : { kind: "file", text: word, path: file.path },
    );
  }

  if (from < text.length) segments.push({ kind: "text", text: text.slice(from) });

  return segments;
}
