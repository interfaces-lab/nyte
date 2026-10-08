import { createHighlighterCoreSync } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import typescript from "shiki/langs/typescript.mjs";
import githubDark from "shiki/themes/github-dark.mjs";
import githubLight from "shiki/themes/github-light.mjs";
import { readFileSync } from "node:fs";
const h = createHighlighterCoreSync({
  themes: [githubLight, githubDark],
  langs: [typescript],
  engine: createJavaScriptRegexEngine(),
});
const code = readFileSync("sdk-spec.ts", "utf8");
const lines = h.codeToTokensWithThemes(code, {
  lang: "typescript",
  themes: { light: "github-light", dark: "github-dark" },
});
const out = lines.map((l) =>
  l.map((t) => ({
    text: t.content,
    light: t.variants.light?.color ?? "",
    dark: t.variants.dark?.color ?? "",
  })),
);
const src = code.split("\n");
console.log(
  "lines",
  out.length,
  "source lines",
  src.length,
  "text matches",
  out.every((l, i) => l.map((t) => t.text).join("") === src[i]),
);
console.log(JSON.stringify(out[60].slice(0, 4)));
