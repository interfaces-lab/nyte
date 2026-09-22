/**
 * Taste settings: appearance, transcript font, and what the Agents list shows.
 * They belong to the phone rather than to the host, so they live in MMKV
 * instead of travelling over the wire. MMKV reads synchronously, so the first
 * paint already has the stored value and no screen flashes a default first.
 */
import { Appearance } from "react-native";
import { createMMKV, useMMKVBoolean, useMMKVString } from "react-native-mmkv";
import { useMountEffect } from "../use-mount-effect.ts";
import { resolveChoice, type Choice, type Choices } from "./choice.ts";
import type { TranscriptFont } from "../theme.ts";

// One instance for the whole app: a handful of small keys, one memory-mapped
// file. The connection token stays in the Keychain, not here.
const store = createMMKV({ id: "nyte.preferences" });

/**
 * A setting carries its own options, so a row cannot show one setting's value
 * over another's menu.
 */
export type Setting<Value extends string> = Choice<Value> & {
  readonly choices: Choices<Value>;
  readonly select: (value: Value) => void;
};

/**
 * React Native owns the appearance vocabulary, down to `unspecified` for
 * following the system, so the stored value is the argument `setColorScheme`
 * takes rather than a second spelling that needs translating on the way out.
 */
type AppearancePreference = Parameters<typeof Appearance.setColorScheme>[0];

const appearanceChoices = [
  { value: "unspecified", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const satisfies Choices<AppearancePreference>;

const transcriptFontChoices = [
  { value: "system", label: "System" },
  { value: "monospaced", label: "Monospaced" },
] as const satisfies Choices<TranscriptFont>;

function useChoice<Value extends string>(key: string, choices: Choices<Value>): Setting<Value> {
  const [stored, setStored] = useMMKVString(key, store);

  return { ...resolveChoice(choices, stored), choices, select: setStored };
}

function useFlag(key: string, fallback: boolean): [boolean, (value: boolean) => void] {
  const [stored, setStored] = useMMKVBoolean(key, store);

  return [stored ?? fallback, setStored];
}

export function useAppearance() {
  const setting = useChoice("appearance", appearanceChoices);

  // Choosing is the only way the value changes, so the OS scheme moves with
  // the tap rather than a render pass behind it.
  return {
    ...setting,
    select: (value: AppearancePreference) => {
      setting.select(value);
      Appearance.setColorScheme(value);
    },
  };
}

export function useTranscriptFont() {
  return useChoice("transcript.font", transcriptFontChoices);
}

export function useFilterCards() {
  return useFlag("list.filters", true);
}

export function useDateSections() {
  return useFlag("list.dateSections", true);
}

export function useTwoLinePreview() {
  return useFlag("list.twoLinePreview", false);
}

/**
 * Applies the stored appearance at startup. `Appearance.setColorScheme` moves
 * `useColorScheme` and React Strict DOM's `prefers-color-scheme` together, so
 * the tokens, the navigation theme, and native controls never disagree; later
 * changes land in `select`, where the tap happens.
 */
export function useAppliedAppearance(): void {
  const appearance = useAppearance();
  useMountEffect(() => {
    Appearance.setColorScheme(appearance.value);
  });
}
