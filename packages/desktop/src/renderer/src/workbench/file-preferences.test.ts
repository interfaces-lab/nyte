import { expect, test } from "vitest";
import { decodeFilePreferences, defaultFilePreferences } from "./file-preferences.ts";

test("editor preferences retain explicit choices", () => {
  const choices = {
    lineNumbers: false,
    wordWrap: false,
    gitBlame: true,
    autoSave: true,
    formatOnSave: true,
  };
  expect(decodeFilePreferences(JSON.stringify(choices))).toEqual(choices);
});

test.each([null, "invalid", "null", "{}", '{"autoSave":"true"}'])(
  "invalid storage %s cannot enable file writes",
  (stored) => {
    expect(decodeFilePreferences(stored)).toEqual(defaultFilePreferences);
    expect(decodeFilePreferences(stored).autoSave).toBe(false);
    expect(decodeFilePreferences(stored).formatOnSave).toBe(false);
  },
);
