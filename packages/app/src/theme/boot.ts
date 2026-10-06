/**
 * Applies the appearance preferences to the static HTML shell before first
 * paint, and again whenever one changes in any window. Keeping it in the boot
 * entry avoids an inline script that the CSP would block.
 */
import { nyte } from "../nyte.ts";
import { preferences } from "../preferences/index.ts";
import {
  applyDisplayMode,
  applyPointerCursors,
  applyTint,
  applyTransparency,
  subscribeSystemTransparency,
  systemReducesTransparency,
  withoutTransitions,
} from "./appearance.ts";
import { codeFontFamily, localFontFamily, uiFontFamily } from "./fonts.ts";

const colorSchemeQuery = window.matchMedia("(prefers-color-scheme: dark)");

/** What `apply` reads. A new CSS-backed preference edits both. */
const APPLIED = [
  preferences.theme,
  preferences.pointerCursors,
  preferences.tintHue,
  preferences.tintIntensity,
  preferences.uiFont,
  preferences.codeFont,
  preferences.uiFontSize,
  preferences.codeFontSize,
  preferences.fontSmoothing,
  preferences.reduceTransparency,
  preferences.codeBlockWordWrap,
] as const;

function apply(): void {
  const theme = preferences.theme.get();
  const dark = theme === "dark" || (theme === "system" && colorSchemeQuery.matches);
  const root = document.documentElement;
  const uiFont = preferences.uiFont.get();
  const antialiased = preferences.fontSmoothing.get() === "antialiased";
  const intensity = preferences.tintIntensity.get();
  applyDisplayMode(dark ? "dark" : "light");
  applyPointerCursors(preferences.pointerCursors.get());
  applyTransparency(preferences.reduceTransparency.get() || systemReducesTransparency());
  root.dataset.nyteCodeBlockWordWrap = preferences.codeBlockWordWrap.get() ? "true" : "false";
  applyTint(intensity > 0);
  root.style.setProperty("--nyte-custom-hue", String(preferences.tintHue.get()));
  root.style.setProperty("--nyte-custom-chroma-scale", String(intensity / 100));
  nyte.host.setThemePreference(theme);
  // @nyte-ai/ui/tokens.stylex derives the whole type scale from these four.
  root.style.setProperty("--nyte-font-family-sans", uiFontFamily(uiFont));
  root.style.setProperty("--nyte-font-family-mono", codeFontFamily(preferences.codeFont.get()));
  root.style.setProperty(
    "--nyte-letter-spacing-lg",
    localFontFamily(uiFont) === undefined ? "" : "0em",
  );
  root.style.setProperty("--nyte-font-size-base", `${String(preferences.uiFontSize.get())}px`);
  root.style.setProperty("--nyte-font-size-code", `${String(preferences.codeFontSize.get())}px`);
  root.style.setProperty("--nyte-font-smoothing", antialiased ? "antialiased" : "auto");
  root.style.setProperty("--nyte-moz-font-smoothing", antialiased ? "grayscale" : "auto");
}

apply();

for (const preference of APPLIED) preference.subscribe(() => withoutTransitions(apply));

colorSchemeQuery.addEventListener("change", () => {
  if (preferences.theme.get() === "system") withoutTransitions(apply);
});

subscribeSystemTransparency(() => withoutTransitions(apply));
