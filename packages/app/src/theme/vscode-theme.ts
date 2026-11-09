import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import { BUILT_IN_THEMES } from "./built-in-themes.ts";

const HEX_COLOR = "^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$";

const HexColorSchema = Type.String({ pattern: HEX_COLOR });

const KEYS = {
  base: ["editor.background"],
  chrome: ["sideBar.background", "activityBar.background", "editor.background"],
  ink: ["editor.foreground", "foreground"],
  accent: [
    "textLink.foreground",
    "focusBorder",
    "button.background",
    "activityBarBadge.background",
    "badge.background",
  ],
};

const USED_KEYS: ReadonlySet<string> = new Set(Object.values(KEYS).flat());

const ink = (percent: number): string =>
  `color-mix(in oklab, var(--nyte-content-primary) ${String(percent)}%, var(--nyte-bg-base))`;

const wash = (percent: number): string =>
  `color-mix(in srgb, var(--nyte-content-primary) ${String(percent)}%, transparent)`;

const ROLES = {
  "--nyte-bg-base": (theme) => pick(theme, KEYS.base),
  "--nyte-bg-chrome": (theme) => pick(theme, KEYS.chrome),
  "--nyte-bg-muted": () => ink(4),
  "--nyte-bg-muted-translucent": () => wash(5),
  "--nyte-bg-elevated": (theme) => (theme.scheme === "dark" ? ink(7) : "var(--nyte-bg-base)"),
  "--nyte-content-primary": (theme) => pick(theme, KEYS.ink),
  "--nyte-content-secondary": () => ink(80),
  "--nyte-content-tertiary": () => ink(62),
  "--nyte-content-quaternary": () => ink(46),
  "--nyte-content-disabled": () => ink(30),
  "--nyte-content-accent": (theme) => readableAccent(theme),
  "--nyte-stroke-accent": (theme) => readableAccent(theme),
  "--nyte-stroke-primary": () => ink(62),
  "--nyte-stroke-tertiary": () => wash(16),
  "--nyte-stroke-quaternary": () => wash(10),
  "--nyte-fill-primary": () => wash(16),
  "--nyte-fill-secondary": () => wash(10),
  "--nyte-fill-tertiary": () => wash(6),
  "--nyte-scrollbar-thumb": () => wash(30),
} satisfies Record<`--nyte-${string}`, (theme: VscodeTheme) => string | undefined>;

export type ColorScheme = "light" | "dark";

export const VscodeThemeSchema = Type.Object(
  {
    name: Type.String(),
    scheme: Type.Enum(["light", "dark"]),
    colors: Type.Record(Type.String(), HexColorSchema),
  },
  { additionalProperties: false },
);

export type VscodeTheme = Static<typeof VscodeThemeSchema>;

const ThemeChoiceSchema = Type.Union([
  Type.Object({ source: Type.Literal("nyte") }, { additionalProperties: false }),
  Type.Object(
    { source: Type.Enum(["built-in", "imported"]), name: Type.String() },
    { additionalProperties: false },
  ),
]);

export type ThemeChoice = Static<typeof ThemeChoiceSchema>;

export const ThemeChoicesSchema = Type.Object(
  { light: ThemeChoiceSchema, dark: ThemeChoiceSchema },
  { additionalProperties: false },
);

export type ThemeChoices = Static<typeof ThemeChoicesSchema>;

const ThemeFileSchema = Type.Object({
  name: Type.Optional(Type.String()),
  type: Type.Optional(Type.String()),
  colors: Type.Record(Type.String(), Type.Unknown()),
});

export function parseVscodeTheme(text: string, fileName: string): VscodeTheme {
  const file: unknown = JSON.parse(stripJsonc(text));

  if (!Value.Check(ThemeFileSchema, file)) throw new Error("It isn't a VS Code color theme");

  const colors = Object.fromEntries(
    Object.entries(file.colors).filter(
      (entry): entry is [string, string] =>
        USED_KEYS.has(entry[0]) && Value.Check(HexColorSchema, entry[1]),
    ),
  );

  const background = colors["editor.background"];

  if (background === undefined) throw new Error("It has no editor.background color");

  return {
    name: file.name ?? fileName.replace(/\.jsonc?$/i, ""),
    scheme: themeScheme(file.type, background),
    colors,
  };
}

export function findTheme(
  scheme: ColorScheme,
  choices: ThemeChoices,
  imported: readonly VscodeTheme[],
): VscodeTheme | null {
  const choice = choices[scheme];

  if (choice.source === "nyte") return null;

  return (
    (choice.source === "built-in" ? BUILT_IN_THEMES : imported).find(
      (theme) => theme.scheme === scheme && theme.name === choice.name,
    ) ?? null
  );
}

export function applyVscodeTheme(theme: VscodeTheme | null): void {
  const style = document.documentElement.style;

  for (const [variable, role] of Object.entries(ROLES)) {
    style.setProperty(variable, theme === null ? "" : (role(theme) ?? ""));
  }
}

export function themeSwatch(
  theme: VscodeTheme,
): Readonly<Record<"base" | "chrome" | "ink" | "accent", string | undefined>> {
  return {
    base: pick(theme, KEYS.base),
    chrome: pick(theme, KEYS.chrome),
    ink: pick(theme, KEYS.ink),
    accent: readableAccent(theme),
  };
}

function pick(theme: VscodeTheme, keys: readonly string[]): string | undefined {
  return keys.map((key) => theme.colors[key]).find((color) => color !== undefined);
}

function readableAccent(theme: VscodeTheme): string | undefined {
  const accent = pick(theme, KEYS.accent);

  if (accent === undefined) return undefined;

  return theme.scheme === "dark"
    ? `oklch(from ${accent} max(l, 0.74) c h)`
    : `oklch(from ${accent} min(l, 0.5) c h)`;
}

function stripJsonc(text: string): string {
  const keepStrings = (_match: string, quoted: string | undefined): string => quoted ?? "";

  return text
    .replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, keepStrings)
    .replace(/("(?:[^"\\]|\\.)*")|,(?=\s*[}\]])/g, keepStrings);
}

function themeScheme(type: string | undefined, background: string): ColorScheme {
  if (type === "light" || type === "hc-light") return "light";

  if (type === "dark" || type === "hc-black") return "dark";
  const digits = background.slice(1);
  const wide = digits.length <= 4 ? digits.replace(/./g, "$&$&") : digits;
  const channel = (start: number): number => Number.parseInt(wide.slice(start, start + 2), 16);

  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4) < 128 ? "dark" : "light";
}
