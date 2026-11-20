import { SdkError } from "@nyte-ai/schema";
import type { Json } from "@nyte-ai/schema";
import { afterEach, expect, test } from "vitest";
import { namesSettingAction, runSettingAction, SETTING_ACTIONS } from "./actions.ts";
import { preferences } from "./index.ts";

afterEach(() => {
  preferences.theme.set("system");
  preferences.chatWidth.set(840);
});

function run(name: keyof typeof SETTING_ACTIONS, input: Json): Json | string {
  try {
    return runSettingAction(name, input);
  } catch (error) {
    if (!(error instanceof SdkError)) throw error;

    return error.code;
  }
}

test.each<{
  readonly name: string;
  readonly action: keyof typeof SETTING_ACTIONS;
  readonly input: Json;
  readonly expected: Json | string;
  readonly kept: Json;
}>([
  {
    name: "{} reads the value",
    action: "setting.theme",
    input: {},
    expected: { value: "system" },
    kept: "system",
  },
  {
    name: "a value the preference takes is set",
    action: "setting.theme",
    input: { value: "dark" },
    expected: { value: "dark" },
    kept: "dark",
  },
  {
    name: "a value outside the choices is refused",
    action: "setting.theme",
    input: { value: "sepia" },
    expected: "invalid",
    kept: "system",
  },
  {
    name: "a number outside the range is refused",
    action: "setting.chat.width",
    input: { value: 10 },
    expected: "invalid",
    kept: 840,
  },
  {
    name: "a field other than value is refused",
    action: "setting.theme",
    input: { theme: "dark" },
    expected: "invalid",
    kept: "system",
  },
])("a setting action: $name", (row) => {
  expect(run(row.action, row.input)).toEqual(row.expected);
  expect(SETTING_ACTIONS[row.action].get()).toEqual(row.kept);
});

test.each([
  "setting.remote.control",
  "setting.developer.mode",
  "setting.link.target",
  "setting.trusted.link.hosts",
  "setting.sidebar.width",
  "setting.draft.folder",
])("%s is not a setting action", (name) => {
  expect(namesSettingAction(name)).toBe(false);
});
