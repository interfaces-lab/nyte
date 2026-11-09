import { applyDisplayMode, applyTint } from "@nyte-ai/ui/appearance";
import { nyte } from "../contract/nyte.ts";
import { applyPointerCursors, applyTransparency, withoutTransitions } from "./appearance.ts";
import { appearance } from "./appearance-store.ts";
import type { Appearance } from "./appearance-store.ts";
import { codeFontFamily, localFontFamily, uiFontFamily } from "./fonts.ts";
import { applyVscodeTheme } from "./vscode-theme.ts";

function apply(shown: Appearance): void {
  const root = document.documentElement;
  applyDisplayMode(shown.dark ? "dark" : "light");
  applyPointerCursors(shown.pointerCursors);
  applyTransparency(shown.reduceTransparency);
  root.dataset.nyteCodeBlockWordWrap = shown.codeBlockWordWrap ? "true" : "false";
  applyTint();
  root.style.setProperty("--nyte-custom-hue", String(shown.tintHue));
  root.style.setProperty("--nyte-custom-chroma-scale", String(shown.tintIntensity / 100));
  applyVscodeTheme(shown.vscodeTheme);
  nyte.host.setThemePreference(shown.theme);
  root.style.setProperty("--nyte-font-family-sans", uiFontFamily(shown.uiFont));
  root.style.setProperty("--nyte-font-family-mono", codeFontFamily(shown.codeFont));
  root.style.setProperty(
    "--nyte-letter-spacing-lg",
    localFontFamily(shown.uiFont) === undefined ? "" : "0em",
  );
  root.style.setProperty("--nyte-font-size-base", `${String(shown.uiFontSize)}px`);
  root.style.setProperty("--nyte-font-size-code", `${String(shown.codeFontSize)}px`);
  root.style.setProperty("--nyte-font-smoothing", shown.antialiased ? "antialiased" : "auto");
  root.style.setProperty("--nyte-moz-font-smoothing", shown.antialiased ? "grayscale" : "auto");
  root.style.setProperty("--nyte-conversation-measure", `${String(shown.chatWidth)}px`);
}

apply(appearance.get());

appearance.subscribe(() => withoutTransitions(() => apply(appearance.get())));
