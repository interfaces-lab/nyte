import { createHighlighterCoreSync } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import bash from "shiki/langs/bash.mjs";
import c from "shiki/langs/c.mjs";
import cpp from "shiki/langs/cpp.mjs";
import csharp from "shiki/langs/csharp.mjs";
import css from "shiki/langs/css.mjs";
import diff from "shiki/langs/diff.mjs";
import docker from "shiki/langs/docker.mjs";
import go from "shiki/langs/go.mjs";
import html from "shiki/langs/html.mjs";
import java from "shiki/langs/java.mjs";
import javascript from "shiki/langs/javascript.mjs";
import json from "shiki/langs/json.mjs";
import jsonc from "shiki/langs/jsonc.mjs";
import jsx from "shiki/langs/jsx.mjs";
import markdown from "shiki/langs/markdown.mjs";
import mdx from "shiki/langs/mdx.mjs";
import php from "shiki/langs/php.mjs";
import powershell from "shiki/langs/powershell.mjs";
import python from "shiki/langs/python.mjs";
import ruby from "shiki/langs/ruby.mjs";
import rust from "shiki/langs/rust.mjs";
import sql from "shiki/langs/sql.mjs";
import toml from "shiki/langs/toml.mjs";
import tsx from "shiki/langs/tsx.mjs";
import typescript from "shiki/langs/typescript.mjs";
import xml from "shiki/langs/xml.mjs";
import yaml from "shiki/langs/yaml.mjs";
import githubDark from "shiki/themes/github-dark.mjs";
import githubLight from "shiki/themes/github-light.mjs";

const languageAliases = new Map([
  ["sh", "bash"],
  ["shell", "bash"],
  ["zsh", "bash"],
  ["c++", "cpp"],
  ["cs", "csharp"],
  ["dockerfile", "docker"],
  ["js", "javascript"],
  ["md", "markdown"],
  ["ps1", "powershell"],
  ["py", "python"],
  ["rb", "ruby"],
  ["rs", "rust"],
  ["ts", "typescript"],
  ["yml", "yaml"],
]);

const languageRegistrations = new Map([
  ["bash", bash],
  ["c", c],
  ["cpp", cpp],
  ["csharp", csharp],
  ["css", css],
  ["diff", diff],
  ["docker", docker],
  ["go", go],
  ["html", html],
  ["java", java],
  ["javascript", javascript],
  ["json", json],
  ["jsonc", jsonc],
  ["jsx", jsx],
  ["markdown", markdown],
  ["mdx", mdx],
  ["php", php],
  ["powershell", powershell],
  ["python", python],
  ["ruby", ruby],
  ["rust", rust],
  ["sql", sql],
  ["toml", toml],
  ["tsx", tsx],
  ["typescript", typescript],
  ["xml", xml],
  ["yaml", yaml],
]);

function createHighlighter() {
  return createHighlighterCoreSync({
    themes: [githubLight, githubDark],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  });
}

let highlighter: ReturnType<typeof createHighlighter> | undefined;

/** Shiki escapes code content before returning this HTML. */
export function highlightCode(code: string, language: string): string | undefined {
  const canonicalLanguage = languageAliases.get(language) ?? language;
  const registration = languageRegistrations.get(canonicalLanguage);

  if (registration === undefined) return undefined;
  highlighter ??= createHighlighter();

  if (!highlighter.getLoadedLanguages().includes(language)) {
    highlighter.loadLanguageSync(registration);
  }

  try {
    return highlighter.codeToHtml(code, {
      lang: language,
      themes: { light: "github-light", dark: "github-dark" },
      defaultColor: false,
    });
  } catch {
    return undefined;
  }
}
