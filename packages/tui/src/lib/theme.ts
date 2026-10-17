import process from "node:process";

export type ThemeMode = "dark" | "light";

export type ThemeChoice = "auto" | ThemeMode;

export const THEME_CHOICES = ["auto", "dark", "light"] as const satisfies readonly ThemeChoice[];

/**
 * TUI colors for one terminal mode. Every text color reads at WCAG AA (4.5:1) on `background`
 * and `codeBackground`, and the diff colors on their diff backgrounds; `muted` is for separators
 * and shading only, never text.
 */
export interface CliTheme {
  readonly mode: ThemeMode;
  readonly transparent: "transparent";
  /** What fills the screen: `background`, or `transparent` where the terminal's own shows through. */
  readonly backdrop: string;
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
  backdrop: "#0a0a0a",
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
  backdrop: "#ffffff",
  terminal: "#f5f5f5",
  background: "#ffffff",
  hover: "#e5e5e5",
  codeBackground: "#f5f5f5",
  foreground: "#0a0a0a",
  dim: "#6f6f6f",
  muted: "#a3a3a3",
  accent: "#025a93",
  moon: "#232a44",
  user: "#404040",
  thinking: "#693acf",
  tool: "#525252",
  error: "#d32a35",
  warning: "#876a0e",
  ok: "#016641",
  running: "#0c6d88",
  link: "#025a93",
  path: "#aa580b",
  code: "#d12860",
  number: "#0c6d88",
  string: "#0e662a",
  type: "#a631be",
  operator: "#0c6d88",
  promptBorder: "#d4d4d4",
  promptBorderFocused: "#a3a3a3",
  selectionBackground: "#dfebff",
  selectionForeground: "#0a0a0a",
  userBackground: "#ededed",
  pasteBackground: "#e5e5e5",
  pasteForeground: "#404040",
  scrollbarTrack: "#f5f5f5",
  scrollbarThumb: "#d4d4d4",
  diffAdded: "#0d6629",
  diffRemoved: "#ce0427",
  diffAddedBackground: "#e0efe1",
  diffRemovedBackground: "#fce1dd",
  diffAddedGutterBackground: "#e5f1e6",
  diffRemovedGutterBackground: "#fbe6e3",
  diffAddedEmphasis: "#c0e8cb",
  diffRemovedEmphasis: "#fcc6c5",
});

function gray(hex: string): string {
  const linear = [1, 3, 5].map((at) => {
    const value = Number.parseInt(hex.slice(at, at + 2), 16) / 255;

    return value <= 0.040_45 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });

  const [red = 0, green = 0, blue = 0] = linear;
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;

  const level =
    luminance <= 0.003_130_8 ? 12.92 * luminance : 1.055 * luminance ** (1 / 2.4) - 0.055;

  const channel = Math.round(level * 255)
    .toString(16)
    .padStart(2, "0");

  return `#${channel}${channel}${channel}`;
}

/** The theme with every color replaced by the gray of equal luminance, so contrast is unchanged. */
function monochrome(theme: CliTheme): CliTheme {
  return Object.freeze({
    mode: theme.mode,
    transparent: theme.transparent,
    backdrop: gray(theme.backdrop),
    terminal: gray(theme.terminal),
    background: gray(theme.background),
    hover: gray(theme.hover),
    codeBackground: gray(theme.codeBackground),
    foreground: gray(theme.foreground),
    dim: gray(theme.dim),
    muted: gray(theme.muted),
    accent: gray(theme.accent),
    moon: gray(theme.moon),
    user: gray(theme.user),
    thinking: gray(theme.thinking),
    tool: gray(theme.tool),
    error: gray(theme.error),
    warning: gray(theme.warning),
    ok: gray(theme.ok),
    running: gray(theme.running),
    link: gray(theme.link),
    path: gray(theme.path),
    code: gray(theme.code),
    number: gray(theme.number),
    string: gray(theme.string),
    type: gray(theme.type),
    operator: gray(theme.operator),
    promptBorder: gray(theme.promptBorder),
    promptBorderFocused: gray(theme.promptBorderFocused),
    selectionBackground: gray(theme.selectionBackground),
    selectionForeground: gray(theme.selectionForeground),
    userBackground: gray(theme.userBackground),
    pasteBackground: gray(theme.pasteBackground),
    pasteForeground: gray(theme.pasteForeground),
    scrollbarTrack: gray(theme.scrollbarTrack),
    scrollbarThumb: gray(theme.scrollbarThumb),
    diffAdded: gray(theme.diffAdded),
    diffRemoved: gray(theme.diffRemoved),
    diffAddedBackground: gray(theme.diffAddedBackground),
    diffRemovedBackground: gray(theme.diffRemovedBackground),
    diffAddedGutterBackground: gray(theme.diffAddedGutterBackground),
    diffRemovedGutterBackground: gray(theme.diffRemovedGutterBackground),
    diffAddedEmphasis: gray(theme.diffAddedEmphasis),
    diffRemovedEmphasis: gray(theme.diffRemovedEmphasis),
  });
}

const THEMES = {
  dark: { color: DARK_THEME, plain: monochrome(DARK_THEME) },
  light: { color: LIGHT_THEME, plain: monochrome(LIGHT_THEME) },
} as const;

const SEE_THROUGH: ReadonlyMap<CliTheme, CliTheme> = new Map(
  Object.values(THEMES).flatMap((forms) =>
    Object.values(forms).map((theme) => [
      theme,
      Object.freeze({ ...theme, backdrop: theme.transparent }),
    ]),
  ),
);

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

function resolveThemeMode(
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

/** The theme for a terminal mode; NO_COLOR swaps in its monochrome form. */
export function themeForMode(mode: ThemeMode, env: NodeJS.ProcessEnv = process.env): CliTheme {
  const noColor = env["NO_COLOR"];

  return noColor === undefined || noColor === "" ? THEMES[mode].color : THEMES[mode].plain;
}

/**
 * The theme for a setting and the mode the terminal reported (`null` when it didn't). A theme in
 * the terminal's own mode leaves the terminal's background showing; any other paints its own.
 */
export function themeFor(
  choice: ThemeChoice,
  reported: ThemeMode | null,
  env: NodeJS.ProcessEnv = process.env,
): CliTheme {
  const mode = resolveThemeMode(choice, reported, env);
  const theme = themeForMode(mode, env);

  return mode === reported ? (SEE_THROUGH.get(theme) ?? theme) : theme;
}
