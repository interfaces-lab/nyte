/**
 * Applies the palette to the static HTML shell before first paint. Keeping it
 * in the boot entry avoids an inline script that the CSP would block.
 */
import { Type } from "typebox";
import { Value } from "typebox/value";
import { nyte } from "../nyte.ts";
import type { ThemePreference } from "../nyte.ts";

const THEME_STORAGE_KEY = "nyte:theme";
const APPEARANCE_STORAGE_KEY = "nyte:appearance:v1";

export type { ThemePreference } from "../nyte.ts";
export type ToolCallDensity = "compact" | "balanced" | "detailed";
type LocalFontSelection = `local:${string}`;
/** Bundled/system stacks plus one installed family discovered by the host. */
export type UiFont = "inter" | "system" | LocalFontSelection;
export type CodeFont = "system" | "jetbrains-mono" | LocalFontSelection;
type FontSmoothing = "antialiased" | "auto";

export interface AppearanceSettings {
  readonly theme: ThemePreference;
  readonly tintHue: number;
  readonly tintIntensity: number;
  readonly uiFont: UiFont;
  readonly codeFont: CodeFont;
  readonly uiFontSize: number;
  readonly codeFontSize: number;
  readonly fontSmoothing: FontSmoothing;
  readonly reduceTransparency: boolean;
  readonly toolCalls: ToolCallDensity;
  readonly codeBlockWordWrap: boolean;
  readonly themedDiffBackgrounds: boolean;
}

const DEFAULT_APPEARANCE: AppearanceSettings = {
  theme: "system",
  tintHue: 210,
  tintIntensity: 0,
  uiFont: "inter",
  codeFont: "system",
  uiFontSize: 13,
  codeFontSize: 12,
  fontSmoothing: "antialiased",
  reduceTransparency: false,
  toolCalls: "compact",
  codeBlockWordWrap: false,
  themedDiffBackgrounds: true,
};

const LOCAL_FONT_PREFIX = "local:";

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 31 || codeUnit === 127) return true;
  }
  return false;
}

function usableFontFamily(family: string): boolean {
  return family !== "" && family.length <= 128 && !hasControlCharacter(family);
}

export function localFontSelection(family: string): LocalFontSelection {
  const normalized = family.trim();
  if (!usableFontFamily(normalized)) throw new Error("Invalid local font family");
  return `${LOCAL_FONT_PREFIX}${normalized}`;
}

function isLocalFontSelection(value: string): value is LocalFontSelection {
  return (
    value.startsWith(LOCAL_FONT_PREFIX) && usableFontFamily(value.slice(LOCAL_FONT_PREFIX.length))
  );
}

export function localFontFamily(selection: UiFont | CodeFont): string | undefined {
  if (!isLocalFontSelection(selection)) return undefined;
  const family = selection.slice(LOCAL_FONT_PREFIX.length);
  return family;
}

function quotedCssFamily(family: string): string {
  return `"${family.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function uiFontFamily(selection: UiFont): string {
  const local = localFontFamily(selection);
  if (local !== undefined) return `${quotedCssFamily(local)}, system-ui, sans-serif`;
  return selection === "inter" ? "var(--nyte-ui-font-inter)" : "var(--nyte-ui-font-system)";
}

export function codeFontFamily(selection: CodeFont): string {
  const local = localFontFamily(selection);
  if (local !== undefined) return `${quotedCssFamily(local)}, ui-monospace, monospace`;
  return selection === "jetbrains-mono"
    ? "var(--nyte-code-font-jetbrains-mono)"
    : "var(--nyte-code-font-system)";
}

const storedAppearanceSchema = Type.Object(
  {
    theme: Type.Optional(Type.Enum(["system", "light", "dark"])),
    tintHue: Type.Optional(Type.Number()),
    tintIntensity: Type.Optional(Type.Number()),
    // Earlier builds stored `humanist` / `serif` and `menlo` / `mono`, fonts
    // that were never bundled. Unknown names fall to the default face instead
    // of discarding the rest of the record.
    uiFont: Type.Optional(Type.String()),
    codeFont: Type.Optional(Type.String()),
    uiFontSize: Type.Optional(Type.Number()),
    codeFontSize: Type.Optional(Type.Number()),
    fontSmoothing: Type.Optional(Type.Enum(["antialiased", "auto"])),
    reduceTransparency: Type.Optional(Type.Boolean()),
    // `auto` was the pre-density name for today's Balanced mode.
    toolCalls: Type.Optional(Type.Enum(["auto", "compact", "balanced", "detailed"])),
    codeBlockWordWrap: Type.Optional(Type.Boolean()),
    themedDiffBackgrounds: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

function clamp(minimum: number, maximum: number, value: number): number {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function storedUiFont(value: string | undefined, fallback: UiFont): UiFont {
  if (value === "inter" || value === "system") return value;
  return value !== undefined && isLocalFontSelection(value) ? value : fallback;
}

function storedCodeFont(value: string | undefined, fallback: CodeFont): CodeFont {
  if (value === "system" || value === "jetbrains-mono") return value;
  return value !== undefined && isLocalFontSelection(value) ? value : fallback;
}

const listeners = new Set<() => void>();
const colorSchemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
const reduceTransparencyQuery = window.matchMedia("(prefers-reduced-transparency: reduce)");

function systemDark(): boolean {
  return colorSchemeQuery.matches;
}

export function systemReducesTransparency(): boolean {
  return reduceTransparencyQuery.matches;
}

function storedTheme(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

function storedAppearance(): AppearanceSettings {
  const legacyTheme = storedTheme();
  const fallback = { ...DEFAULT_APPEARANCE, theme: legacyTheme };
  try {
    const value = localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (value === null) return fallback;
    const stored: unknown = JSON.parse(value);
    if (!Value.Check(storedAppearanceSchema, stored)) return fallback;
    return {
      theme: stored.theme ?? fallback.theme,
      tintHue: clamp(0, 360, stored.tintHue ?? fallback.tintHue),
      tintIntensity: clamp(0, 100, stored.tintIntensity ?? fallback.tintIntensity),
      uiFont: storedUiFont(stored.uiFont, fallback.uiFont),
      codeFont: storedCodeFont(stored.codeFont, fallback.codeFont),
      uiFontSize: clamp(12, 16, stored.uiFontSize ?? fallback.uiFontSize),
      codeFontSize: clamp(11, 15, stored.codeFontSize ?? fallback.codeFontSize),
      fontSmoothing: stored.fontSmoothing ?? fallback.fontSmoothing,
      reduceTransparency: stored.reduceTransparency ?? fallback.reduceTransparency,
      toolCalls:
        stored.toolCalls === "auto" ? "balanced" : (stored.toolCalls ?? fallback.toolCalls),
      codeBlockWordWrap: stored.codeBlockWordWrap ?? fallback.codeBlockWordWrap,
      themedDiffBackgrounds: stored.themedDiffBackgrounds ?? fallback.themedDiffBackgrounds,
    };
  } catch {
    return fallback;
  }
}

let appearance = storedAppearance();

function apply(settings: AppearanceSettings): void {
  const preference = settings.theme;
  const dark = preference === "dark" || (preference === "system" && systemDark());
  const reduceTransparency = settings.reduceTransparency || systemReducesTransparency();
  const root = document.documentElement;
  root.dataset["theme"] = dark ? "dark" : "light";
  root.dataset["tintActive"] = settings.tintIntensity > 0 ? "true" : "false";
  root.dataset["reduceTransparency"] = reduceTransparency ? "true" : "false";
  root.dataset["nyteCodeBlockWordWrap"] = settings.codeBlockWordWrap ? "true" : "false";
  root.dataset["nyteThemedDiffBackgrounds"] = settings.themedDiffBackgrounds ? "true" : "false";
  root.style.setProperty("--nyte-tint-hue", `${String(settings.tintHue)}deg`);
  root.style.setProperty("--nyte-tint-intensity", `${String(settings.tintIntensity)}%`);
  nyte.host.setThemePreference(preference);
  // tokens.css derives the whole type scale from these four.
  root.style.setProperty("--nyte-font-family-sans", uiFontFamily(settings.uiFont));
  root.style.setProperty("--nyte-font-family-mono", codeFontFamily(settings.codeFont));
  root.style.setProperty("--nyte-font-size-base", `${String(settings.uiFontSize)}px`);
  root.style.setProperty("--nyte-font-size-code", `${String(settings.codeFontSize)}px`);
  root.style.setProperty(
    "--nyte-font-smoothing",
    settings.fontSmoothing === "antialiased" ? "antialiased" : "auto",
  );
  root.style.setProperty(
    "--nyte-moz-font-smoothing",
    settings.fontSmoothing === "antialiased" ? "grayscale" : "auto",
  );
}

export function themePreference(): ThemePreference {
  return appearance.theme;
}

export function setThemePreference(preference: ThemePreference): void {
  setAppearanceSettings({ ...appearance, theme: preference });
}

export function appearanceSettings(): AppearanceSettings {
  return appearance;
}

export function subscribeAppearance(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setAppearanceSettings(next: AppearanceSettings): void {
  appearance = next;
  try {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(next));
    localStorage.removeItem(THEME_STORAGE_KEY);
  } catch {
    // Preference persistence is best-effort.
  }
  apply(next);
  for (const listener of listeners) listener();
}

apply(appearance);
colorSchemeQuery.addEventListener("change", () => {
  if (appearance.theme === "system") apply(appearance);
});
reduceTransparencyQuery.addEventListener("change", () => {
  apply(appearance);
  for (const listener of listeners) listener();
});
