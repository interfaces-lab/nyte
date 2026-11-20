import type { Theme } from "@pierre/highlights";
import pierreDark from "@pierre/highlights/themes/pierre-dark";
import pierreLight from "@pierre/highlights/themes/pierre-light";
import vscodeDark from "@pierre/theme/pierre-dark";
import vscodeLight from "@pierre/theme/pierre-light";
import { platformColors, platformScopes } from "./platform-colors.ts";

type Mode = "light" | "dark";

type VSCodeTheme = typeof vscodeLight;

const TEXT_FLOOR = 4.5;

const TERTIARY_TOKENS = new Set([
  "comment",
  "comment.doc",
  "comment.documentation",
  "hint",
  "predictive",
]);

const CAPTURE_SCOPES = {
  keyword: "keyword.control",
  "keyword.import": "keyword.control.import",
  namespace: "entity.name.namespace",
  variable: "variable.other.readwrite",
  "variable.parameter": "variable.parameter",
  "variable.builtin": "variable.language",
  "variable.member": "variable.other.property",
  property: "variable.other.property",
  function: "entity.name.function",
  "function.call": "entity.name.function",
  "function.method": "entity.name.function",
  "function.method.call": "entity.name.function",
  "function.builtin": "support.function",
  type: "entity.name.type",
  "type.builtin": "support.type.primitive",
  constructor: "entity.name.type",
  constant: "constant.other",
  "constant.builtin": "constant.language",
  boolean: "constant.language.boolean",
  number: "constant.numeric",
  string: "string",
  "string.escape": "constant.character.escape",
  comment: "comment",
  "comment.doc": "comment",
  label: "entity.name.label",
} satisfies Record<string, string>;

const EDITOR_COLORS = [
  "editor.lineHighlightBackground",
  "editor.selectionBackground",
  "editorCursor.foreground",
  "editorLineNumber.foreground",
  "editorLineNumber.activeForeground",
  "editorIndentGuide.background",
  "editorIndentGuide.activeBackground",
  "editorBracketMatch.background",
  "editorBracketMatch.border",
];

/** Themes for diffs and chat, which keep text readable on the diff line and word tints. */
export const codeThemes = {
  light: pierreTheme(pierreLight, vscodeLight, "light", diffSurfaces("light")),
  dark: pierreTheme(pierreDark, vscodeDark, "dark", diffSurfaces("dark")),
} satisfies Record<Mode, Theme>;

/** Themes for the editor, which draws only its surface and the current line. */
export const editorThemes = {
  light: pierreTheme(pierreLight, vscodeLight, "light", editorSurfaces(vscodeLight, "light")),
  dark: pierreTheme(pierreDark, vscodeDark, "dark", editorSurfaces(vscodeDark, "dark")),
} satisfies Record<Mode, Theme>;

function pierreTheme(
  zed: Theme,
  vscode: VSCodeTheme,
  mode: Mode,
  surfaces: readonly (readonly number[])[],
): Theme {
  const light = mode === "light";
  const luminances = surfaces.map(luminance);

  const floor = light
    ? (Math.min(...luminances) + 0.05) / TEXT_FLOOR - 0.05
    : TEXT_FLOOR * (Math.max(...luminances) + 0.05) - 0.05;

  const tertiary = luminance(toChannels(platformColors[mode].contentTertiary));
  const tertiaryFloor = light ? Math.min(floor, tertiary) : Math.max(floor, tertiary);

  const standard = Object.entries(CAPTURE_SCOPES).flatMap(([capture, scope]) => {
    const color = scopeColor(vscode, scope);

    return color === undefined ? [] : [[capture, color] as const];
  });

  const merged = { ...zed.style.syntax, ...Object.fromEntries(standard) };

  const syntax = Object.fromEntries(
    Object.entries(merged).map(([token, settings]) => {
      const target = TERTIARY_TOKENS.has(token) ? tertiaryFloor : floor;

      if (typeof settings === "string") return [token, meetLuminance(settings, target, light)];

      if (settings.color === undefined) return [token, settings];

      return [token, { ...settings, color: meetLuminance(settings.color, target, light) }];
    }),
  );

  const editor = Object.fromEntries(
    EDITOR_COLORS.flatMap((key) => {
      const color = vscode.colors[key];

      return color === undefined ? [] : [[key, color] as const];
    }),
  );

  return { ...zed, style: { ...zed.style, ...editor, syntax } };
}

function diffSurfaces(mode: Mode): readonly (readonly number[])[] {
  const palette = platformColors[mode];
  const tint = mode === "light" ? { line: 0.12, word: 0.15 } : { line: 0.2, word: 0.2 };

  return [palette.bgBase, palette.bgMuted].map(toChannels).flatMap((surface) => [
    surface,
    composite(palette.fillTertiary, surface),
    ...[platformScopes[mode].green, platformScopes[mode].red].flatMap((scope) => {
      const line = blend(scope.strokeAccent, tint.line, surface);

      return [line, blend(scope.strokeAccent, tint.word, line)];
    }),
  ]);
}

function editorSurfaces(vscode: VSCodeTheme, mode: Mode): readonly (readonly number[])[] {
  const surface = toChannels(platformColors[mode].bgBase);
  const currentLine = vscode.colors["editor.lineHighlightBackground"];

  return currentLine === undefined ? [surface] : [surface, composite(currentLine, surface)];
}

function scopeColor(vscode: VSCodeTheme, scope: string): string | undefined {
  const matches = vscode.tokenColors.flatMap((rule, order) => {
    const color = rule.settings.foreground;

    if (color === undefined) return [];

    return [rule.scope ?? []]
      .flat()
      .flatMap((selector) => selector.split(","))
      .map((selector) => selector.trim())
      .filter((selector) => scope === selector || scope.startsWith(`${selector}.`))
      .map((selector) => ({ depth: selector.split(".").length, order, color }));
  });

  return matches.toSorted((a, b) => b.depth - a.depth || b.order - a.order)[0]?.color;
}

function meetLuminance(color: string, target: number, light: boolean): string {
  const linear = toChannels(color).map(toLinear);
  const current = weigh(linear);

  if (light ? current <= target : current >= target) return color;

  const moved = light
    ? linear.map((channel) => (channel * target) / current)
    : linear.map((channel) => channel + ((1 - channel) * (target - current)) / (1 - current));

  const round = light ? Math.floor : Math.ceil;

  return `#${moved
    .map((channel) =>
      round(toGamma(channel) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function toChannels(hex: string): readonly number[] {
  return [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
}

function composite(fill: string, under: readonly number[]): readonly number[] {
  return blend(fill, Number.parseInt(fill.slice(7, 9), 16) / 255, under);
}

function blend(color: string, alpha: number, under: readonly number[]): readonly number[] {
  return toChannels(color).map((channel, index) => channel * alpha + under[index] * (1 - alpha));
}

function luminance(channels: readonly number[]): number {
  return weigh(channels.map(toLinear));
}

function weigh(linear: readonly number[]): number {
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function toLinear(channel: number): number {
  return channel <= 0.040_45 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function toGamma(channel: number): number {
  return channel <= 0.003_130_8 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
}
