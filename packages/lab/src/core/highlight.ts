/**
 * Shiki tokenizes; `@nyte-ai/ui` tokens colour. The theme below paints each
 * syntax role a placeholder colour, and that colour is read back as the role,
 * so the roles in `code.tsx` decide every visible colour.
 */
import { createHighlighterCoreSync } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import typescript from "shiki/langs/typescript.mjs";

export type Role =
  | "plain"
  | "keyword"
  | "string"
  | "function"
  | "constant"
  | "comment"
  | "punctuation";

interface Token {
  readonly text: string;
  readonly role: Role;
}

export type Line = readonly Token[];

const THEME = "lab-roles";

/**
 * TextMate picks the most specific selector, so operators beat `keyword` and
 * a declared name stays plain while an upper-case constant does not.
 */
const SCOPES: readonly (readonly [Role, readonly string[]])[] = [
  ["plain", ["meta.definition.variable variable.other.constant", "meta.object-literal.key"]],
  ["comment", ["comment", "punctuation.definition.comment"]],
  ["string", ["string", "punctuation.definition.string"]],
  [
    "keyword",
    [
      "keyword",
      "storage",
      "keyword.operator.new",
      "keyword.operator.expression",
      "keyword.control",
      "variable.language",
    ],
  ],
  [
    "constant",
    ["constant.numeric", "constant.language", "variable.other.constant", "support.constant"],
  ],
  [
    "function",
    [
      "entity.name.function",
      "support.function",
      "entity.name.type",
      "support.type",
      "entity.other.inherited-class",
    ],
  ],
  [
    "punctuation",
    [
      "punctuation",
      "meta.brace",
      "keyword.operator",
      "meta.type.annotation punctuation",
      "punctuation.definition.template-expression",
    ],
  ],
];

const COLORS: ReadonlyMap<Role, string> = new Map(
  SCOPES.map(([role], index) => [role, `#00000${index + 1}`]),
);

const ROLES: ReadonlyMap<string, Role> = new Map(
  [...COLORS].map(([role, placeholder]) => [placeholder.toUpperCase(), role]),
);

function createHighlighter() {
  return createHighlighterCoreSync({
    themes: [
      {
        name: THEME,
        type: "light",
        colors: { "editor.foreground": "#000000", "editor.background": "#ffffff" },
        tokenColors: SCOPES.map(([role, scope]) => ({
          scope: [...scope],
          settings: { foreground: COLORS.get(role) },
        })),
      },
    ],
    langs: [typescript],
    engine: createJavaScriptRegexEngine(),
  });
}

let highlighter: ReturnType<typeof createHighlighter> | undefined;

const cache = new Map<string, readonly Line[]>();

/** Lines of TypeScript as role-tagged tokens. An empty line is an empty array. */
export function tokenize(code: string): readonly Line[] {
  const cached = cache.get(code);

  if (cached !== undefined) return cached;
  highlighter ??= createHighlighter();

  const lines = highlighter
    .codeToTokens(code, { lang: "typescript", theme: THEME })
    .tokens.map((line) =>
      line.map((token) => ({
        text: token.content,
        role: ROLES.get(token.color?.toUpperCase() ?? "") ?? "plain",
      })),
    );

  cache.set(code, lines);

  return lines;
}
