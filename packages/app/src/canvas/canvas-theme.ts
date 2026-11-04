import type { CanvasHostContext } from "@nyte-ai/plugin/canvas/protocol";
import type { Appearance } from "../theme/appearance-store.ts";
import { codeFontFamily, localFontFamily, uiFontFamily } from "../theme/fonts.ts";

export type CanvasTheme = Pick<CanvasHostContext, "theme" | "styles">;

export type CanvasAppearance = Pick<
  Appearance,
  | "dark"
  | "tintHue"
  | "tintIntensity"
  | "uiFont"
  | "codeFont"
  | "uiFontSize"
  | "codeFontSize"
  | "antialiased"
  | "reduceTransparency"
  | "vibrancy"
>;

export function canvasTheme(appearance: CanvasAppearance): CanvasTheme {
  return {
    theme: appearance.dark ? "dark" : "light",
    styles: {
      variables: {
        "--nyte-custom-hue": String(appearance.tintHue),
        "--nyte-custom-chroma-scale": String(appearance.tintIntensity / 100),
        "--nyte-font-family-sans": uiFontFamily(appearance.uiFont),
        "--nyte-font-family-mono": codeFontFamily(appearance.codeFont),
        "--nyte-letter-spacing-lg": localFontFamily(appearance.uiFont) === undefined ? "" : "0em",
        "--nyte-font-size-base": `${String(appearance.uiFontSize)}px`,
        "--nyte-font-size-code": `${String(appearance.codeFontSize)}px`,
        "--nyte-font-smoothing": appearance.antialiased ? "antialiased" : "auto",
        "--nyte-moz-font-smoothing": appearance.antialiased ? "grayscale" : "auto",
        "--nyte-reduce-transparency":
          appearance.reduceTransparency || !appearance.vibrancy ? "1" : "0",
      },
    },
  };
}
