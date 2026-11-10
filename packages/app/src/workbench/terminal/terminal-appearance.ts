import { props } from "@stylexjs/stylex";
import { surfaceTheme } from "@nyte-ai/ui/surface-theme";
import type { Tint } from "@nyte-ai/ui/surface-theme";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import type { ColorScheme, Palette, Rgb } from "@nyte-ai/vt";

export interface TerminalFont {
  readonly family: string;
  readonly size: number;
}

export interface TerminalAppearance {
  readonly scheme: ColorScheme;
  readonly palette: Palette;
  readonly selection: Rgb;
  readonly font: TerminalFont;
}

export function colorScheme(): ColorScheme {
  return document.documentElement.dataset["displayMode"] === "dark" ? "dark" : "light";
}

export function terminalAppearance(): TerminalAppearance {
  const probe = document.createElement("span");
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (context === null) throw new Error("Canvas rendering is unavailable");
  document.documentElement.append(probe);

  const resolve = (value: string, scope?: Tint): string => {
    probe.className = scope === undefined ? "" : (props(surfaceTheme[scope]).className ?? "");
    probe.style.color = value;

    return getComputedStyle(probe).color;
  };

  const background = resolve(role.bgBase);

  const color = (value: string, scope?: Tint): Rgb => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = background;
    context.fillRect(0, 0, 1, 1);
    context.fillStyle = resolve(value, scope);
    context.fillRect(0, 0, 1, 1);
    const pixel = context.getImageData(0, 0, 1, 1).data;

    return ((pixel[0] ?? 0) << 16) | ((pixel[1] ?? 0) << 8) | (pixel[2] ?? 0);
  };

  try {
    const scheme = colorScheme();
    const page = color(role.bgBase);
    const ink = color(role.contentPrimary);
    const black = scheme === "dark" ? page : ink;
    const white = scheme === "dark" ? ink : page;
    probe.style.fontFamily = type.fontMono;
    probe.style.fontSize = type.fontCode;
    const font = getComputedStyle(probe);

    return {
      scheme,
      palette: {
        foreground: ink,
        background: page,
        cursor: ink,
        ansi: [
          black,
          color(role.contentTertiary, "red"),
          color(role.contentTertiary, "green"),
          color(role.contentTertiary, "yellow"),
          color(role.contentTertiary, "blue"),
          color(role.contentTertiary, "pink"),
          color(role.contentTertiary, "teal"),
          white,
          color(role.contentSecondary, "gray"),
          color(role.contentAccent, "red"),
          color(role.contentAccent, "green"),
          color(role.contentAccent, "yellow"),
          color(role.contentAccent, "blue"),
          color(role.contentAccent, "pink"),
          color(role.contentAccent, "teal"),
          white,
        ],
      },
      selection: color(role.fillPrimary),
      font: { family: font.fontFamily, size: Number.parseFloat(font.fontSize) },
    };
  } finally {
    probe.remove();
  }
}
