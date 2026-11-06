import { platformColors, platformScopes } from "@nyte-ai/ui/platform-colors";
import type { Theme } from "@pierre/highlights";
import pierreDark from "@pierre/highlights/themes/pierre-dark";
import pierreLight from "@pierre/highlights/themes/pierre-light";

const TEXT_FLOOR = 4.5;

const TERTIARY_TOKENS = new Set([
  "comment",
  "comment.doc",
  "comment.documentation",
  "hint",
  "predictive",
]);

/**
 * Pierre's palettes, each syntax colour moved along its hue until it meets the text floor on every
 * code surface. `@pierre/diffs` tints a changed line with the git hue at 12% (light) or 20% (dark),
 * and a changed word at 15% or 20% over it.
 */
export const codeThemes = {
  light: meetTextFloor(pierreLight, "light"),
  dark: meetTextFloor(pierreDark, "dark"),
} satisfies Record<"light" | "dark", Theme>;

function meetTextFloor(theme: Theme, mode: "light" | "dark"): Theme {
  const light = mode === "light";
  const palette = platformColors[mode];
  const tint = light ? { line: 0.12, word: 0.15 } : { line: 0.2, word: 0.2 };

  const surfaces = [palette.bgBase, palette.bgMuted].map(toChannels).flatMap((surface) => [
    luminance(surface),
    luminance(composite(palette.fillTertiary, surface)),
    ...[platformScopes[mode].green, platformScopes[mode].red].flatMap((scope) => {
      const line = blend(scope.strokeAccent, tint.line, surface);

      return [luminance(line), luminance(blend(scope.strokeAccent, tint.word, line))];
    }),
  ]);

  const floor = light
    ? (Math.min(...surfaces) + 0.05) / TEXT_FLOOR - 0.05
    : TEXT_FLOOR * (Math.max(...surfaces) + 0.05) - 0.05;

  const tertiary = luminance(toChannels(palette.contentTertiary));
  const tertiaryFloor = light ? Math.min(floor, tertiary) : Math.max(floor, tertiary);

  const syntax = Object.fromEntries(
    Object.entries(theme.style.syntax ?? {}).map(([token, settings]) => {
      const target = TERTIARY_TOKENS.has(token) ? tertiaryFloor : floor;

      if (typeof settings === "string") return [token, meetLuminance(settings, target, light)];

      if (settings.color === undefined) return [token, settings];

      return [token, { ...settings, color: meetLuminance(settings.color, target, light) }];
    }),
  );

  return { ...theme, style: { ...theme.style, syntax } };
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
