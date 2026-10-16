import process from "node:process";

export type ThemeMode = "dark" | "light";

export type ThemeChoice = "auto" | ThemeMode;

export function isThemeChoice(value: string): value is ThemeChoice {
  return value === "auto" || value === "dark" || value === "light";
}

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
  dim: "#737373",
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
  dim: "#737373",
  muted: "#a3a3a3",
  accent: "#1a85d4",
  moon: "#232a44",
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
  diffAdded: "#0dbe4e",
  diffRemoved: "#ff2e3f",
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
