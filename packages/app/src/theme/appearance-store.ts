import { useSyncExternalStore } from "react";
import type { ThemePreference } from "../contract/bridge.ts";
import { preferences } from "../preferences/index.ts";
import {
  subscribeSystemTransparency,
  systemReducesTransparency,
  windowHasVibrancy,
} from "./appearance.ts";
import type { CodeFont, UiFont } from "./fonts.ts";
import { findTheme } from "./vscode-theme.ts";
import type { VscodeTheme } from "./vscode-theme.ts";

export interface Appearance {
  readonly theme: ThemePreference;
  readonly dark: boolean;
  readonly pointerCursors: boolean;
  readonly tintHue: number;
  readonly tintIntensity: number;
  readonly vscodeTheme: VscodeTheme | null;
  readonly uiFont: UiFont;
  readonly codeFont: CodeFont;
  readonly uiFontSize: number;
  readonly codeFontSize: number;
  readonly antialiased: boolean;
  readonly reduceTransparency: boolean;
  readonly vibrancy: boolean;
  readonly codeBlockWordWrap: boolean;
  readonly chatWidth: number;
}

const colorSchemeQuery = window.matchMedia("(prefers-color-scheme: dark)");

function readAppearance(): Appearance {
  const theme = preferences.theme.get();
  const dark = theme === "dark" || (theme === "system" && colorSchemeQuery.matches);

  return {
    theme,
    dark,
    pointerCursors: preferences.pointerCursors.get(),
    tintHue: preferences.tintHue.get(),
    tintIntensity: preferences.tintIntensity.get(),
    vscodeTheme: findTheme(
      dark ? "dark" : "light",
      preferences.themes.get(),
      preferences.importedThemes.get(),
    ),
    uiFont: preferences.uiFont.get(),
    codeFont: preferences.codeFont.get(),
    uiFontSize: preferences.uiFontSize.get(),
    codeFontSize: preferences.codeFontSize.get(),
    antialiased: preferences.fontSmoothing.get() === "antialiased",
    reduceTransparency: preferences.reduceTransparency.get() || systemReducesTransparency(),
    vibrancy: windowHasVibrancy(),
    codeBlockWordWrap: preferences.codeBlockWordWrap.get(),
    chatWidth: preferences.chatWidth.get(),
  };
}

let current = readAppearance();

const listeners = new Set<() => void>();

function refresh(): void {
  current = readAppearance();

  for (const listener of listeners) listener();
}

for (const preference of [
  preferences.theme,
  preferences.pointerCursors,
  preferences.tintHue,
  preferences.tintIntensity,
  preferences.themes,
  preferences.importedThemes,
  preferences.uiFont,
  preferences.codeFont,
  preferences.uiFontSize,
  preferences.codeFontSize,
  preferences.fontSmoothing,
  preferences.reduceTransparency,
  preferences.codeBlockWordWrap,
  preferences.chatWidth,
])
  preference.subscribe(refresh);

colorSchemeQuery.addEventListener("change", refresh);

subscribeSystemTransparency(refresh);

const platformPending = document.readyState === "loading";

if (platformPending) window.addEventListener("DOMContentLoaded", refresh, { once: true });

export const appearance = {
  get: (): Appearance => current,
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);

    return () => listeners.delete(listener);
  },
};

export function useAppearance(): Appearance {
  return useSyncExternalStore(appearance.subscribe, appearance.get, appearance.get);
}
