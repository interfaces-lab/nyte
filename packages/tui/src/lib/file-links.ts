import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Lexer, walkTokens } from "marked";
import type { Token } from "marked";

/**
 * Rewrites each inline-code file path in `markdown`, such as `src/app.ts:42`,
 * as a link to that file under `root`. A terminal then opens the file the
 * session means; scanning the screen itself, it resolves relative paths against
 * the folder the TUI launched in and keeps a sentence's closing period.
 */
export function linkFilePaths(markdown: string, root: string): string {
  if (!markdown.includes("`")) return markdown;

  return Lexer.lex(markdown)
    .map((block) => linkBlock(block, root))
    .join("");
}

/** The file URL a code span names, or `null` when it doesn't read as a file path. */
function readFileTarget(code: string, root: string): string | null {
  let end = code.length;
  let position = end;

  for (let field = 0; field < 2; field += 1) {
    const start = position;

    while (position > 0) {
      const digit = code.charCodeAt(position - 1);

      if (digit < 48 || digit > 57) break;
      position -= 1;
    }

    if (position === start || code[position - 1] !== ":") break;
    position -= 1;
    end = position;
  }

  const path = code.slice(0, end);

  if (path.startsWith("//")) return null;

  let slash = false;
  let dot = false;
  let named = false;
  let scheme = false;

  for (let index = 0; index < path.length; index += 1) {
    const character = path.charAt(index);

    if (
      character.trim() === "" ||
      "*?()[]{}<>|\"'`$#\\".includes(character) ||
      (character === ":" && scheme)
    )
      return null;

    const letter =
      (character >= "a" && character <= "z") ||
      (character >= "A" && character <= "Z") ||
      character === "K" ||
      character === "ſ";

    scheme =
      index === 0
        ? letter
        : scheme &&
          (letter || (character >= "0" && character <= "9") || "_+.-".includes(character));

    if (character === "/") {
      slash = true;
      dot = false;
      named = false;
    } else if (character === ".") dot = true;
    else named = true;
  }

  if (!slash || !dot || !named) return null;

  return pathToFileURL(path.startsWith("~/") ? join(homedir(), path.slice(2)) : resolve(root, path))
    .href;
}

interface Mark {
  readonly raw: string;
  readonly target: string | null;
}

function linkBlock(block: Token, root: string): string {
  const { raw } = block;
  let output = "";
  let cursor = 0;

  for (const mark of readMarks(block, root)) {
    const span = findSpan(raw, mark.raw, cursor);

    if (span === null) continue;
    const [start, end] = span;

    output +=
      mark.target === null
        ? raw.slice(cursor, end)
        : `${raw.slice(cursor, start)}[${raw.slice(start, end)}](${mark.target})`;

    cursor = end;
  }

  return output + raw.slice(cursor);
}

/**
 * The block's code spans in document order, with the links and code blocks
 * between them, which are passed over whole so a span inside one stays as written.
 */
function readMarks(block: Token, root: string): readonly Mark[] {
  if (block.type === "code" || block.type === "html") return [];
  const marks: Mark[] = [];
  const inside = new Set<Token>();

  void walkTokens([block], (token) => {
    if (inside.has(token)) return;

    if (token.type === "link" || token.type === "image" || token.type === "code") {
      marks.push({ raw: token.raw, target: null });
      void walkTokens(
        "tokens" in token && token.tokens !== undefined ? token.tokens : [],
        (child) => {
          inside.add(child);
        },
      );

      return;
    }

    if (token.type === "codespan")
      marks.push({ raw: token.raw, target: readFileTarget(token.text, root) });
  });

  return marks;
}

/**
 * Where `raw` sits in `source` from `from`. A token nested in a list item or
 * quote holds its text without the container's indent or `>`, so only its first
 * and last lines are looked for.
 */
function findSpan(source: string, raw: string, from: number): readonly [number, number] | null {
  const lines = raw.trimEnd().split("\n");
  const first = lines[0] ?? "";
  const last = lines.at(-1) ?? "";
  const start = first === "" ? -1 : source.indexOf(first, from);

  if (start === -1) return null;

  if (lines.length === 1) return [start, start + first.length];
  const tail = source.indexOf(last, start + first.length);

  return tail === -1 ? null : [start, tail + last.length];
}
