import assert from "node:assert/strict";
import { test } from "vitest";
import { isThemeChoice, resolveThemeMode } from "../src/theme.ts";

test("auto follows the terminal, then the environment, then COLORFGBG, then dark", () => {
  assert.equal(resolveThemeMode("auto", "light", {}), "light");
  assert.equal(resolveThemeMode("auto", null, { NYTE_THEME: "light" }), "light");
  assert.equal(resolveThemeMode("auto", null, { LC_NYTE_THEME: "day" }), "light");
  assert.equal(resolveThemeMode("auto", null, { COLORFGBG: "0;15" }), "light");
  assert.equal(resolveThemeMode("auto", null, { COLORFGBG: "15;0" }), "dark");
  assert.equal(resolveThemeMode("auto", null, {}), "dark");
});

test("a pinned mode wins over everything the terminal says", () => {
  assert.equal(resolveThemeMode("dark", "light", { NYTE_THEME: "light" }), "dark");
  assert.equal(resolveThemeMode("light", "dark", {}), "light");
});

test("only auto, dark, and light are choices", () => {
  assert.ok(isThemeChoice("auto"));
  assert.ok(isThemeChoice("dark"));
  assert.ok(isThemeChoice("light"));
  assert.equal(isThemeChoice("night"), false);
});
