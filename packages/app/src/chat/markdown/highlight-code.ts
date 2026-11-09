import { codeToTokens, isSupportedLanguage, StreamTokenizer } from "@nyte-ai/ui/highlights";
import type { Lang, ThemedToken } from "@nyte-ai/ui/highlights";
import { codeThemes } from "@nyte-ai/ui/code-themes";

const HTML_ESCAPES = new Map([
  ["&", "&amp;"],
  ["<", "&lt;"],
  [">", "&gt;"],
  ['"', "&quot;"],
]);

const OPEN_STREAMS = 4;

function escapeHtml(text: string): string {
  return text.replaceAll(/[&<>"]/gu, (character) => HTML_ESCAPES.get(character) ?? character);
}

export interface HighlightToken {
  readonly content: string;
  readonly style: string;
}

interface OpenStream {
  readonly language: Lang;
  readonly tokenizer: StreamTokenizer;
  lines: readonly string[];
  fed: string;
}

const openStreams: OpenStream[] = [];

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

export function highlightOpenCode(code: string, language: string): readonly string[] | undefined {
  if (!isSupportedLanguage(language) || code.includes("\r")) return undefined;

  const stream = claimStream(code, language);

  stream.lines = stream.lines.concat(
    stream.tokenizer
      .pushCode(code.slice(stream.fed.length))
      .map((line) => lineHtml(styleLine(line))),
  );
  stream.fed = code;

  return stream.lines.concat(escapeHtml(code.slice(code.lastIndexOf("\n") + 1)));
}

function claimStream(code: string, language: Lang): OpenStream {
  const found = openStreams.findLast(
    (stream) => stream.language === language && code.startsWith(stream.fed),
  );

  if (found !== undefined) {
    openStreams.splice(openStreams.indexOf(found), 1);
    openStreams.push(found);

    return found;
  }

  if (openStreams.length >= OPEN_STREAMS) openStreams.shift()?.tokenizer.dispose();

  const stream = {
    language,
    tokenizer: new StreamTokenizer(tokenOptions(language)),
    lines: [],
    fed: "",
  };

  openStreams.push(stream);

  return stream;
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
