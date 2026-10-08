/**
 * File identity is Pierre's concern; size and color remain Nyte schema choices.
 * One shared sprite keeps rows cheap, while exact basenames and compound
 * extensions stay inside Pierre's resolver instead of becoming desktop lore.
 *
 * Based on https://github.com/interfaces-lab/honk/blob/main/packages/ui/src/file-type-icon.tsx
 */
import { create, props } from "@stylexjs/stylex";
import { createFileTreeIconResolver, getBuiltInSpriteSheet } from "@pierre/trees";
import type { ReactElement } from "react";
import { glyph } from "@nyte-ai/ui/schema.stylex";
import { role } from "@nyte-ai/ui/vars.stylex";
import { surfaceTheme } from "@nyte-ai/ui/surface-theme";

type FileIconTone =
  | "gray"
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "cyan"
  | "blue"
  | "purple"
  | "magenta";

const GLYPH_SIZE = "1em";

const resolver = createFileTreeIconResolver("complete");

const spriteMarkup = { __html: getBuiltInSpriteSheet("complete") };

const styles = create({
  root: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: glyph.md,
    height: glyph.md,
    flexShrink: 0,
    fontSize: 14,
    lineHeight: 1,
    color: role.contentInteractiveTertiary,
  },
  sprite: {
    position: "absolute",
    width: 0,
    height: 0,
    overflow: "clip",
    pointerEvents: "none",
  },
});

const TONE_THEME = {
  gray: surfaceTheme.gray,
  red: surfaceTheme.red,
  orange: surfaceTheme.orange,
  yellow: surfaceTheme.yellow,
  green: surfaceTheme.green,
  cyan: surfaceTheme.teal,
  blue: surfaceTheme.blue,
  purple: surfaceTheme.purple,
  magenta: surfaceTheme.pink,
};

const TOKEN_TONE = {
  astro: "purple",
  babel: "yellow",
  bash: "green",
  biome: "blue",
  bootstrap: "purple",
  browserslist: "yellow",
  bun: "magenta",
  c: "blue",
  claude: "orange",
  cpp: "blue",
  css: "purple",
  database: "purple",
  docker: "blue",
  eslint: "purple",
  git: "orange",
  go: "cyan",
  graphql: "magenta",
  html: "orange",
  image: "magenta",
  javascript: "yellow",
  json: "orange",
  markdown: "green",
  mcp: "cyan",
  npm: "red",
  oxc: "cyan",
  postcss: "red",
  prettier: "cyan",
  python: "blue",
  react: "cyan",
  ruby: "red",
  rust: "orange",
  sass: "magenta",
  svelte: "red",
  svg: "orange",
  svgo: "green",
  swift: "orange",
  table: "cyan",
  tailwind: "cyan",
  terraform: "purple",
  typescript: "blue",
  vite: "purple",
  vscode: "blue",
  vue: "green",
  wasm: "purple",
  webpack: "blue",
  yml: "red",
  zig: "orange",
  zip: "orange",
} satisfies Readonly<Record<string, FileIconTone>>;

function isFileIconToken(token: string): token is keyof typeof TOKEN_TONE {
  return Object.hasOwn(TOKEN_TONE, token);
}

export function FileTypeIcon({ path }: { readonly path: string }): ReactElement {
  const icon = resolver.resolveIcon("file-tree-icon-file", path.replaceAll("\\", "/"));
  const token = icon.token ?? "";
  const tone = isFileIconToken(token) ? TOKEN_TONE[token] : "gray";
  const width = icon.width ?? 16;
  const height = icon.height ?? 16;

  return (
    <span aria-hidden="true" {...props(TONE_THEME[tone], styles.root)}>
      <svg
        data-icon-name={icon.name}
        viewBox={icon.viewBox ?? `0 0 ${String(width)} ${String(height)}`}
        width={GLYPH_SIZE}
        height={GLYPH_SIZE}
        focusable="false"
      >
        <use href={`#${icon.name}`} />
      </svg>
    </span>
  );
}

export function FileTypeIconSprite(): ReactElement {
  return (
    <span aria-hidden="true" {...props(styles.sprite)} dangerouslySetInnerHTML={spriteMarkup} />
  );
}
