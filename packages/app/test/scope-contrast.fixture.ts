import { create, props } from "@stylexjs/stylex";
import { surfaceTheme } from "../../ui/src/surface-theme.ts";
import { role } from "../../ui/src/vars.stylex.ts";

const styles = create({
  primary: { color: role.contentPrimary },
  secondary: { color: role.contentSecondary },
  chrome: { color: role.contentChrome },
  glyphPrimary: { color: role.contentInteractivePrimary },
  glyphSecondary: { color: role.contentInteractiveSecondary },
  glyphTertiary: { color: role.contentInteractiveTertiary },
  base: { backgroundColor: role.bgBase },
  muted: { backgroundColor: role.bgMuted },
  elevated: { backgroundColor: role.bgElevated },
  chromeSurface: { backgroundColor: role.bgChrome },
  button: { color: role.contentOnInteractiveStrong, backgroundColor: role.buttonFill },
});

export function run(): string {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) throw new Error("Missing canvas context");

  function luminance(color: string): number {
    if (!context) throw new Error("Missing canvas context");
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);

    const channels = Array.from(context.getImageData(0, 0, 1, 1).data)
      .slice(0, 3)
      .map((byte) => {
        const channel = byte / 255;

        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });

    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  }

  const results: { mode: string; scope: string; role: string; surface: string; ratio: number }[] =
    [];

  const scopes = [
    { name: "neutral", theme: [], hue: 250, chroma: 1 },
    ...Object.entries(surfaceTheme).map(([name, theme]) => ({ name, theme, hue: 250, chroma: 1 })),
    ...Array.from({ length: 36 }, (_, index) => index * 10).flatMap((hue) =>
      [0, 0.5, 1].map((chroma) => ({
        name: `custom-${hue}-${chroma}`,
        theme: surfaceTheme.custom,
        hue,
        chroma,
      })),
    ),
  ];

  for (const mode of ["light", "dark"]) {
    document.documentElement.style.colorScheme = mode;

    for (const { name: scope, theme, hue, chroma } of scopes) {
      const host = document.createElement("div");
      host.className = props(theme).className ?? "";
      host.style.setProperty("--nyte-custom-hue", String(hue));
      host.style.setProperty("--nyte-custom-chroma-scale", String(chroma));
      document.body.append(host);

      for (const [surface, background] of [
        ["base", styles.base],
        ["muted", styles.muted],
        ["elevated", styles.elevated],
        ["chrome", styles.chromeSurface],
      ] as const) {
        for (const [name, foreground] of [
          ["primary", styles.primary],
          ["secondary", styles.secondary],
          ["chrome", styles.chrome],
          ["glyphPrimary", styles.glyphPrimary],
          ["glyphSecondary", styles.glyphSecondary],
          ["glyphTertiary", styles.glyphTertiary],
        ] as const) {
          const sample = document.createElement("span");
          sample.className = props(background, foreground).className ?? "";
          host.append(sample);
          const computed = getComputedStyle(sample);
          const first = luminance(computed.color);
          const second = luminance(computed.backgroundColor);
          results.push({
            mode,
            scope,
            role: name,
            surface,
            ratio: (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05),
          });
          sample.remove();
        }
      }

      host.remove();
    }

    for (const scope of ["blue", "red"] as const) {
      const sample = document.createElement("span");
      sample.className = props(surfaceTheme[scope], styles.button).className ?? "";
      document.body.append(sample);
      const computed = getComputedStyle(sample);
      const first = luminance(computed.color);
      const second = luminance(computed.backgroundColor);
      results.push({
        mode,
        scope,
        role: "buttonLabel",
        surface: "buttonFill",
        ratio: (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05),
      });
      sample.remove();
    }
  }

  return JSON.stringify(results);
}
