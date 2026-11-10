import { codeToTokens, isSupportedLanguage, StreamTokenizer } from "@nyte-ai/ui/highlights";
import type { Lang, ThemedToken } from "@nyte-ai/ui/highlights";
import { codeThemes } from "@nyte-ai/ui/code-themes";

const HTML_ESCAPES = new Map([
  ["&", "&amp;"],
  ["<", "&lt;"],
  [">", "&gt;"],
  ['"', "&quot;"],
]);

function escapeHtml(text: string): string {
  return text.replaceAll(/[&<>"]/gu, (character) => HTML_ESCAPES.get(character) ?? character);
}

export interface HighlightToken {
  readonly content: string;
  readonly style: string;
}

function tokenOptions(language: Lang) {
  return {
    lang: language,
    themes: codeThemes,
    defaultColor: false,
    cssVariablePrefix: "--diffs-token-",
    tokenizeMaxLineLength: 1_000,
  } as const;
}

export function highlightTokens(
  code: string,
  language: string,
): readonly (readonly HighlightToken[])[] | undefined {
  if (!isSupportedLanguage(language)) return undefined;

  return codeToTokens(code, tokenOptions(language)).tokens.map(styleLine);
}

export function highlightCode(code: string, language: string): readonly string[] | undefined {
  return highlightTokens(code, language)?.map(lineHtml);
}

/** Tokenizes one code fence while it streams; `streamCode` feeds what each call appended. */
export interface CodeStream {
  readonly tokenizer: StreamTokenizer;
  lines: readonly string[];
  fed: string;
}

export function openCodeStream(language: string): CodeStream | undefined {
  if (!isSupportedLanguage(language)) return undefined;

  return { tokenizer: new StreamTokenizer(tokenOptions(language)), lines: [], fed: "" };
}

/** Answers the lines so far, the unfinished last one plain, or undefined when `code` doesn't extend what was fed. */
export function streamCode(stream: CodeStream, code: string): readonly string[] | undefined {
  const added = appended(stream, code);

  if (added === undefined) return undefined;

  stream.lines = stream.lines.concat(stream.tokenizer.pushCode(added).map(themedLineHtml));
  stream.fed = code;

  return stream.lines.concat(escapeHtml(code.slice(code.lastIndexOf("\n") + 1)));
}

/** Ends the stream with its last line, or answers undefined when `code` doesn't extend what was fed. */
export function finishCode(stream: CodeStream, code: string): readonly string[] | undefined {
  const added = appended(stream, code);

  if (added === undefined) {
    stream.tokenizer.dispose();

    return undefined;
  }

  return stream.lines.concat(
    stream.tokenizer.pushCode(added).map(themedLineHtml),
    stream.tokenizer.end().map(themedLineHtml),
  );
}

function appended(stream: CodeStream, code: string): string | undefined {
  if (!code.startsWith(stream.fed)) return undefined;
  const added = code.slice(stream.fed.length);

  return added.includes("\r") ? undefined : added;
}

function styleLine(line: readonly ThemedToken[]): readonly HighlightToken[] {
  return line.map((token) => ({
    content: token.content,
    style: Object.entries(token.htmlStyle ?? {})
      .map(([property, value]) => `${property}:${value}`)
      .join(";"),
  }));
}

function lineHtml(line: readonly HighlightToken[]): string {
  return line
    .map((token) => `<span style="${escapeHtml(token.style)}">${escapeHtml(token.content)}</span>`)
    .join("");
}

function themedLineHtml(line: readonly ThemedToken[]): string {
  return lineHtml(styleLine(line));
}
