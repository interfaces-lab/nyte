/**
 * What the canvas shell is told about the appearance: the scheme and the
 * custom properties `theme/boot.ts` writes on <html>, read from the same
 * preferences so a canvas matches the chat around it.
 */
import type { CanvasHostContext } from "@nyte-ai/plugin/canvas-protocol";
import { preferences } from "../preferences/index.ts";
import { subscribeSystemTransparency, systemReducesTransparency } from "../theme/appearance.ts";
import { codeFontFamily, localFontFamily, uiFontFamily } from "../theme/fonts.ts";
import type { CodeFont, UiFont } from "../theme/fonts.ts";

export type CanvasTheme = Pick<CanvasHostContext, "theme" | "styles">;

export interface CanvasAppearance {
  readonly dark: boolean;
  readonly tintHue: number;
  readonly tintIntensity: number;
  readonly uiFont: UiFont;
  readonly codeFont: CodeFont;
  readonly uiFontSize: number;
  readonly codeFontSize: number;
  readonly antialiased: boolean;
  readonly reduceTransparency: boolean;
}

/** The host context's theme half for one appearance; the names are the contract's allowlist. */
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
        "--nyte-reduce-transparency": appearance.reduceTransparency ? "1" : "0",
      },
    },
  };
}

const APPLIED = [
  preferences.theme,
  preferences.tintHue,
  preferences.tintIntensity,
  preferences.uiFont,
  preferences.codeFont,
  preferences.uiFontSize,
  preferences.codeFontSize,
  preferences.fontSmoothing,
  preferences.reduceTransparency,
] as const;

let colorSchemeQuery: MediaQueryList | undefined;

function darkQuery(): MediaQueryList {
  return (colorSchemeQuery ??= window.matchMedia("(prefers-color-scheme: dark)"));
}

function currentAppearance(): CanvasAppearance {
  const theme = preferences.theme.get();

  return {
    dark: theme === "dark" || (theme === "system" && darkQuery().matches),
    tintHue: preferences.tintHue.get(),
    tintIntensity: preferences.tintIntensity.get(),
    uiFont: preferences.uiFont.get(),
    codeFont: preferences.codeFont.get(),
    uiFontSize: preferences.uiFontSize.get(),
    codeFontSize: preferences.codeFontSize.get(),
    antialiased: preferences.fontSmoothing.get() === "antialiased",
    reduceTransparency: preferences.reduceTransparency.get() || systemReducesTransparency(),
  };
}

let cached: { readonly key: string; readonly theme: CanvasTheme } | undefined;

/** The current theme, the same object while nothing changed, for `useSyncExternalStore`. */
export function readCanvasTheme(): CanvasTheme {
  const appearance = currentAppearance();
  const key = JSON.stringify(appearance);

  if (cached?.key !== key) cached = { key, theme: canvasTheme(appearance) };

  return cached.theme;
}

export function subscribeCanvasTheme(listener: () => void): () => void {
  const unsubscribes = [
    ...APPLIED.map((preference) => preference.subscribe(listener)),
    subscribeSystemTransparency(listener),
  ];

  darkQuery().addEventListener("change", listener);

  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
    darkQuery().removeEventListener("change", listener);
  };
}
