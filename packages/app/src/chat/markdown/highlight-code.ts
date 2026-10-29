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

export function highlightCode(code: string, language: string): string | undefined {
  if (!isSupportedLanguage(language)) return undefined;

  const { tokens } = codeToTokens(code, {
    lang: language,
    themes: { light: githubLight, dark: githubDark },
    defaultColor: false,
    cssVariablePrefix: "--diffs-token-",
    tokenizeMaxLineLength: 1_000,
  });

  return tokens
    .map((line) =>
      line
        .map((token) => {
          const style = Object.entries(token.htmlStyle ?? {})
            .map(([property, value]) => `${property}:${value}`)
            .join(";");

          return `<span style="${escapeHtml(style)}">${escapeHtml(token.content)}</span>`;
        })
        .join(""),
    )
    .join("\n");
}
