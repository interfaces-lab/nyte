import process from "node:process";

export type ThemeMode = "dark" | "light";

/** What the user picks: a mode, or `auto` to follow the terminal's own color scheme. */
export type ThemeChoice = "auto" | ThemeMode;

export function isThemeChoice(value: string): value is ThemeChoice {
  return value === "auto" || value === "dark" || value === "light";
}

/**
 * Semantic colors for every OpenTUI surface. Components consume roles from
 * this object; they do not own palettes or choose colors independently.
 */
export interface CliTheme {
  readonly mode: ThemeMode;
  readonly transparent: "transparent";
  readonly terminal: string;
  readonly background: string;
  readonly hover: string;
  readonly codeBackground: string;
  readonly foreground: string;
  readonly dim: string;
  readonly muted: string;
  readonly accent: string;
  readonly user: string;
  readonly thinking: string;
  readonly tool: string;
  readonly error: string;
  readonly warning: string;
  readonly ok: string;
  readonly running: string;
  readonly link: string;
  readonly path: string;
  readonly code: string;
  readonly number: string;
  readonly string: string;
  readonly type: string;
  readonly operator: string;
  readonly promptBorder: string;
  readonly promptBorderFocused: string;
  readonly selectionBackground: string;
  readonly selectionForeground: string;
  readonly userBackground: string;
  readonly pasteBackground: string;
  readonly pasteForeground: string;
  readonly scrollbarTrack: string;
  readonly scrollbarThumb: string;
  readonly diffAddedBackground: string;
  readonly diffRemovedBackground: string;
}

/** The theme store's shape: a palette whose roles the screen may replace. */
export type ActiveCliTheme = { -readonly [Role in keyof CliTheme]: CliTheme[Role] };

/**
 * Pierre's dark roles. Diff rows are `codeBackground` mixed 80% in CIELAB
 * with Pierre's added and removed bases, fixed here because terminals
 * cannot mix.
 *
 * Based on https://github.com/pierrecomputer/pierre/blob/main/packages/theme/src/roles/dark.ts
 * and https://github.com/pierrecomputer/pierre/blob/main/packages/diffs/src/style.css
 */
export const DARK_THEME: CliTheme = Object.freeze({
  mode: "dark",
  transparent: "transparent",
  terminal: "#171717",
  background: "#0a0a0a",
  hover: "#262626",
  codeBackground: "#171717",
  foreground: "#fafafa",
  dim: "#737373",
  muted: "#525252",
  accent: "#009fff",
  user: "#d4d4d4",
  thinking: "#9d6afb",
  tool: "#a3a3a3",
  error: "#ff2e3f",
  warning: "#ffca00",
  ok: "#07c480",
  running: "#08c0ef",
  link: "#009fff",
  path: "#ffa359",
  code: "#ff678d",
  number: "#68cdf2",
  string: "#5ecc71",
  type: "#d568ea",
  operator: "#08c0ef",
  promptBorder: "#2c2c2c",
  promptBorderFocused: "#525252",
  selectionBackground: "#19283c",
  selectionForeground: "#fafafa",
  userBackground: "#1d1d1d",
  pasteBackground: "#101010",
  pasteForeground: "#d4d4d4",
  scrollbarTrack: "#101010",
  scrollbarThumb: "#262626",
  diffAddedBackground: "#273628",
  diffRemovedBackground: "#402725",
});

/**
 * Pierre's light roles, with the diff mix at 88%. Text takes the 600 shade
 * where Pierre's light roles use 500, as its `ansi` roles do.
 *
 * Based on https://github.com/pierrecomputer/pierre/blob/main/packages/theme/src/roles/light.ts
 * and https://github.com/pierrecomputer/pierre/blob/main/packages/diffs/src/style.css
 */
export const LIGHT_THEME: CliTheme = Object.freeze({
  mode: "light",
  transparent: "transparent",
  terminal: "#f5f5f5",
  background: "#ffffff",
  hover: "#e5e5e5",
  codeBackground: "#f5f5f5",
  foreground: "#0a0a0a",
  dim: "#737373",
  muted: "#a3a3a3",
  accent: "#1a85d4",
  user: "#404040",
  thinking: "#693acf",
  tool: "#525252",
  error: "#d52c36",
  warning: "#d5a910",
  ok: "#18a46c",
  running: "#1ca1c7",
  link: "#1a85d4",
  path: "#d47628",
  code: "#d32a61",
  number: "#1ca1c7",
  string: "#199f43",
  type: "#a631be",
  operator: "#1ca1c7",
  promptBorder: "#d4d4d4",
  promptBorderFocused: "#a3a3a3",
  selectionBackground: "#dfebff",
  selectionForeground: "#0a0a0a",
  userBackground: "#ededed",
  pasteBackground: "#e5e5e5",
  pasteForeground: "#404040",
  scrollbarTrack: "#f5f5f5",
  scrollbarThumb: "#d4d4d4",
  diffAddedBackground: "#e0efe1",
  diffRemovedBackground: "#fce1dd",
});

/** `dark`/`light`, plus the `night`/`day` aliases. Anything else is no answer. */
function byName(raw: string | undefined): ThemeMode | undefined {
  const name = raw?.trim().toLowerCase();

  if (name === "dark" || name === "night") return "dark";

  if (name === "light" || name === "day") return "light";

  return undefined;
}

/**
 * Vim's `COLORFGBG` heuristic: background `0-6` and `8` are dark, `7` and
 * `9-15` are light. The background is the last field.
 */
function byColorFgBg(raw: string | undefined): ThemeMode | undefined {
  const field = raw?.split(";").at(-1)?.trim();

  if (field === undefined || !/^\d+$/u.test(field)) return undefined;
  const background = Number(field);

  if (background <= 6 || background === 8) return "dark";

  return background <= 15 ? "light" : undefined;
}

/**
 * The mode to draw with. A pinned choice wins; `auto` follows what the
 * terminal reports about its color scheme, then `NYTE_THEME` (and its
 * SSH-surviving alias `LC_NYTE_THEME`), then `COLORFGBG`, then dark.
 *
 * Based on opencode v2, where a locked mode beats the terminal's and the
 * terminal's beats the default: https://github.com/anomalyco/opencode/blob/v2/packages/tui/src/context/theme.tsx
 */
export function resolveThemeMode(
  choice: ThemeChoice,
  terminal: ThemeMode | null,
  env: NodeJS.ProcessEnv = process.env,
): ThemeMode {
  if (choice !== "auto") return choice;

  return (
    terminal ??
    byName(env["NYTE_THEME"]) ??
    byName(env["LC_NYTE_THEME"]) ??
    byColorFgBg(env["COLORFGBG"]) ??
    "dark"
  );
}

export function themeForMode(mode: ThemeMode): CliTheme {
  switch (mode) {
    case "dark":
      return DARK_THEME;
    case "light":
      return LIGHT_THEME;
    default: {
      const _exhaustive: never = mode;

      return _exhaustive;
    }
  }
}
