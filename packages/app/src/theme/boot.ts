import { applyDisplayMode, applyTint } from "@nyte-ai/ui/appearance";
import { nyte } from "../nyte.ts";
import { preferences } from "../preferences/index.ts";
import {
  applyPointerCursors,
  applyTransparency,
  subscribeSystemTransparency,
  systemReducesTransparency,
  withoutTransitions,
} from "./appearance.ts";
import { codeFontFamily, localFontFamily, uiFontFamily } from "./fonts.ts";

const colorSchemeQuery = window.matchMedia("(prefers-color-scheme: dark)");

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
  preferences.chatWidth,
] as const;

function apply(): void {
  const theme = preferences.theme.get();
  const dark = theme === "dark" || (theme === "system" && colorSchemeQuery.matches);
  const root = document.documentElement;
  const uiFont = preferences.uiFont.get();
  const antialiased = preferences.fontSmoothing.get() === "antialiased";
  applyDisplayMode(dark ? "dark" : "light");
  applyPointerCursors(preferences.pointerCursors.get());
  applyTransparency(preferences.reduceTransparency.get() || systemReducesTransparency());
  root.dataset.nyteCodeBlockWordWrap = preferences.codeBlockWordWrap.get() ? "true" : "false";
  applyTint();
  root.style.setProperty("--nyte-custom-hue", String(preferences.tintHue.get()));
  root.style.setProperty(
    "--nyte-custom-chroma-scale",
    String(preferences.tintIntensity.get() / 100),
  );
  nyte.host.setThemePreference(theme);
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
  root.style.setProperty("--nyte-conversation-measure", `${String(preferences.chatWidth.get())}px`);
}

apply();

for (const preference of APPLIED) preference.subscribe(() => withoutTransitions(apply));

colorSchemeQuery.addEventListener("change", () => {
  if (preferences.theme.get() === "system") withoutTransitions(apply);
});

subscribeSystemTransparency(() => withoutTransitions(apply));

const platformPending = document.readyState === "loading";

if (platformPending)
  window.addEventListener("DOMContentLoaded", () => withoutTransitions(apply), { once: true });
