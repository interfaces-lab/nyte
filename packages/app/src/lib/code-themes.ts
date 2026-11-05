import { platformColors } from "@nyte-ai/ui/platform-colors";
import type { Theme } from "@pierre/highlights";
import githubDark from "@pierre/highlights/themes/github-dark-default";
import githubLight from "@pierre/highlights/themes/github-light-default";

const TEXT_FLOOR = 4.5;

/** Comments and hints read as metadata, so they meet the contentTertiary stair. */
const TERTIARY_TOKENS = new Set([
  "comment",
  "comment.doc",
  "comment.documentation",
  "hint",
  "predictive",
]);

type Palette = (typeof platformColors)["light" | "dark"];

/**
 * GitHub's palettes with each syntax colour that misses the text floor on a code surface (bgBase,
 * bgMuted, the hover fill over either, and a diff word's fill layered on its line's) moved along its
 * own hue until it meets the floor.
 */
export const codeThemes = {
  light: meetTextFloor(githubLight, platformColors.light),
  dark: meetTextFloor(githubDark, platformColors.dark),
} satisfies Record<"light" | "dark", Theme>;

function meetTextFloor(theme: Theme, palette: Palette): Theme {
  const light = theme.appearance === "light";

  const surfaces = [palette.bgBase, palette.bgMuted]
    .map(toChannels)
    .flatMap((surface) => [
      luminance(surface),
      luminance(composite(palette.fillTertiary, surface)),
      luminance(composite(palette.fillSecondary, surface)),
      luminance(composite(palette.fillPrimary, surface)),
      luminance(composite(palette.fillPrimary, composite(palette.fillTertiary, surface))),
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

/** Scales linear light toward black (light) or white (dark), which keeps the hue. */
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

/** Lays a translucent `#rrggbbaa` fill over sRGB channels. */
function composite(fill: string, under: readonly number[]): readonly number[] {
  const alpha = Number.parseInt(fill.slice(7, 9), 16) / 255;

  return toChannels(fill).map((channel, index) => channel * alpha + under[index] * (1 - alpha));
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
