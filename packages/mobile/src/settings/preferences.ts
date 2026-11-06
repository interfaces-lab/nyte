import { Appearance } from "react-native";
import { createMMKV, useMMKVBoolean, useMMKVString } from "react-native-mmkv";
import { useMountEffect } from "../use-mount-effect.ts";
import { resolveChoice, type Choice, type Choices } from "./choice.ts";
import type { TranscriptFont } from "../theme.ts";

const store = createMMKV({ id: "nyte.preferences" });

export type Setting<Value extends string> = Choice<Value> & {
  readonly choices: Choices<Value>;
  readonly select: (value: Value) => void;
};

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

  return {
    ...setting,
    select: (value: typeof setting.value) => {
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

export function useAppliedAppearance(): void {
  const appearance = useAppearance();
  useMountEffect(() => {
    Appearance.setColorScheme(appearance.value);
  });
}
