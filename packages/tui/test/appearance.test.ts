import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { GROKDAY, GROKNIGHT, resolveTheme } from "../src/theme.ts";

void describe("resolveTheme", () => {
  void test("reads dark and light, with the night and day aliases", () => {
    assert.equal(resolveTheme({ UJI_THEME: "dark" }), GROKNIGHT);
    assert.equal(resolveTheme({ UJI_THEME: "night" }), GROKNIGHT);
    assert.equal(resolveTheme({ UJI_THEME: "Light" }), GROKDAY);
    assert.equal(resolveTheme({ UJI_THEME: "day" }), GROKDAY);
  });

  void test("prefers the canonical name, then the SSH alias, then COLORFGBG", () => {
    const all = { UJI_THEME: "dark", LC_UJI_THEME: "light", COLORFGBG: "0;15" };
    assert.equal(resolveTheme(all), GROKNIGHT);
    assert.equal(resolveTheme({ LC_UJI_THEME: "light", COLORFGBG: "15;0" }), GROKDAY);
  });

  void test("falls through an unset or unrecognized name", () => {
    assert.equal(resolveTheme({ UJI_THEME: "solarized", COLORFGBG: "0;15" }), GROKDAY);
    assert.equal(resolveTheme({ UJI_THEME: "", LC_UJI_THEME: "light" }), GROKDAY);
  });

  void test("reads the COLORFGBG background from the last field", () => {
    assert.equal(resolveTheme({ COLORFGBG: "15;0" }), GROKNIGHT);
    assert.equal(resolveTheme({ COLORFGBG: "0;15" }), GROKDAY);
    assert.equal(resolveTheme({ COLORFGBG: "0;default;15" }), GROKDAY);
    // 7 is light and 8 is dark: the ramp is not monotonic.
    assert.equal(resolveTheme({ COLORFGBG: "0;7" }), GROKDAY);
    assert.equal(resolveTheme({ COLORFGBG: "0;8" }), GROKNIGHT);
  });

  void test("defaults to dark, including when COLORFGBG states no background", () => {
    assert.equal(resolveTheme({}), GROKNIGHT);
    // Reading the foreground instead of the absent background would say light.
    assert.equal(resolveTheme({ COLORFGBG: "15;default" }), GROKNIGHT);
    assert.equal(resolveTheme({ COLORFGBG: "1;99" }), GROKNIGHT);
  });
});
