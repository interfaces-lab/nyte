import { codeToTokens, isSupportedLanguage } from "@pierre/highlights";
import githubDark from "@pierre/highlights/themes/github-dark";
import githubLight from "@pierre/highlights/themes/github-light";

const HTML_ESCAPES = new Map([
  ["&", "&amp;"],
  ["<", "&lt;"],
  [">", "&gt;"],
  ['"', "&quot;"],
]);

function escapeHtml(text: string): string {
  return text.replaceAll(/[&<>"]/gu, (character) => HTML_ESCAPES.get(character) ?? character);
}

/** A highlighted token: its text and the CSS custom properties that colour it in each theme. */
export interface HighlightToken {
  readonly content: string;
  readonly style: string;
}

/** The code's tokens, line by line, or undefined when the language isn't supported. */
export function highlightTokens(
  code: string,
  language: string,
): readonly (readonly HighlightToken[])[] | undefined {
  if (!isSupportedLanguage(language)) return undefined;

  const { tokens } = codeToTokens(code, {
    lang: language,
    themes: { light: githubLight, dark: githubDark },
    defaultColor: false,
    cssVariablePrefix: "--diffs-token-",
    tokenizeMaxLineLength: 1_000,
  });

  return tokens.map((line) =>
    line.map((token) => ({
      content: token.content,
      style: Object.entries(token.htmlStyle ?? {})
        .map(([property, value]) => `${property}:${value}`)
        .join(";"),
    })),
  );
}

export function highlightCode(code: string, language: string): string | undefined {
  return highlightTokens(code, language)
    ?.map((line) =>
      line
        .map(
          (token) => `<span style="${escapeHtml(token.style)}">${escapeHtml(token.content)}</span>`,
        )
        .join(""),
    )
    .join("\n");
}
