import process from "node:process";

export type ThemeMode = "dark" | "light";

export type ThemeChoice = "auto" | ThemeMode;

export function isThemeChoice(value: string): value is ThemeChoice {
  return value === "auto" || value === "dark" || value === "light";
}

/**
 * TUI colors for one terminal mode. Every text color reads at WCAG AA (4.5:1) on `background`
 * and `codeBackground`, and the diff colors on their diff backgrounds; `muted` is for separators
 * and shading only, never text.
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
  readonly moon: string;
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
  readonly diffAdded: string;
  readonly diffRemoved: string;
  readonly diffAddedBackground: string;
  readonly diffRemovedBackground: string;
  readonly diffAddedGutterBackground: string;
  readonly diffRemovedGutterBackground: string;
  readonly diffAddedEmphasis: string;
  readonly diffRemovedEmphasis: string;
}

export const DARK_THEME: CliTheme = Object.freeze({
  mode: "dark",
  transparent: "transparent",
  terminal: "#171717",
  background: "#0a0a0a",
  hover: "#262626",
  codeBackground: "#171717",
  foreground: "#fafafa",
  dim: "#828282",
  muted: "#525252",
  accent: "#009fff",
  moon: "#c1d0f6",
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
  diffAdded: "#5ecc71",
  diffRemoved: "#ff6762",
  diffAddedBackground: "#273628",
  diffRemovedBackground: "#402725",
  diffAddedGutterBackground: "#232e23",
  diffRemovedGutterBackground: "#362321",
  diffAddedEmphasis: "#325437",
  diffRemovedEmphasis: "#663431",
});

const LIGHT_THEME: CliTheme = Object.freeze({
  mode: "light",
  transparent: "transparent",
  terminal: "#f5f5f5",
  background: "#ffffff",
  hover: "#e5e5e5",
  codeBackground: "#f5f5f5",
  foreground: "#0a0a0a",
  dim: "#6f6f6f",
  muted: "#a3a3a3",
  accent: "#0273bc",
  moon: "#232a44",
  user: "#404040",
  thinking: "#693acf",
  tool: "#525252",
  error: "#d32a35",
  warning: "#876a0e",
  ok: "#017f51",
  running: "#0d7794",
  link: "#0273bc",
  path: "#aa580b",
  code: "#d12860",
  number: "#0d7794",
  string: "#118034",
  type: "#a631be",
  operator: "#0d7794",
  promptBorder: "#d4d4d4",
  promptBorderFocused: "#a3a3a3",
  selectionBackground: "#dfebff",
  selectionForeground: "#0a0a0a",
  userBackground: "#ededed",
  pasteBackground: "#e5e5e5",
  pasteForeground: "#404040",
  scrollbarTrack: "#f5f5f5",
  scrollbarThumb: "#d4d4d4",
  diffAdded: "#107931",
  diffRemoved: "#ce0427",
  diffAddedBackground: "#e0efe1",
  diffRemovedBackground: "#fce1dd",
  diffAddedGutterBackground: "#e5f1e6",
  diffRemovedGutterBackground: "#fbe6e3",
  diffAddedEmphasis: "#c0e8cb",
  diffRemovedEmphasis: "#fcc6c5",
});

function byName(raw: string | undefined): ThemeMode | undefined {
  const name = raw?.trim().toLowerCase();

  if (name === "dark" || name === "night") return "dark";

  if (name === "light" || name === "day") return "light";

  return undefined;
}

function byColorFgBg(raw: string | undefined): ThemeMode | undefined {
  const field = raw?.split(";").at(-1)?.trim();

  if (field === undefined || !/^\d+$/u.test(field)) return undefined;
  const background = Number(field);

  if (background <= 6 || background === 8) return "dark";

  return background <= 15 ? "light" : undefined;
}

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
