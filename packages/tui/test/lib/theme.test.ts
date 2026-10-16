import { describe, expect, test } from "bun:test";
import { themeFor, themeForMode } from "../../src/lib/theme.ts";
import type { CliTheme } from "../../src/lib/theme.ts";

const TEXT = [
  "foreground",
  "dim",
  "accent",
  "moon",
  "user",
  "thinking",
  "tool",
  "error",
  "warning",
  "ok",
  "running",
  "link",
  "path",
  "code",
  "number",
  "string",
  "type",
  "operator",
  "diffAdded",
  "diffRemoved",
] as const satisfies readonly (keyof CliTheme)[];

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255);

  const [red = 0, green = 0, blue = 0] = channels.map((value) =>
    value <= 0.039_28 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(left: string, right: string): number {
  const [light, dark] = [luminance(left), luminance(right)].toSorted((a, b) => b - a);

  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

describe("NO_COLOR", () => {
  test("swaps every color for a gray of the same luminance", () => {
    for (const mode of ["dark", "light"] as const) {
      const plain = themeForMode(mode, { NO_COLOR: "1" });
      const colored = themeForMode(mode, {});

      const hues = Object.values(plain).filter(
        (value) => value.startsWith("#") && !/^#(..)\1\1$/u.test(value),
      );

      expect(hues).toEqual([]);
      expect(contrast(plain.warning, plain.background)).toBeCloseTo(
        contrast(colored.warning, colored.background),
        1,
      );
    }
  });

  test("an empty NO_COLOR keeps color", () => {
    expect(themeForMode("dark", { NO_COLOR: "" }).ok).toBe(themeForMode("dark", {}).ok);
  });
});

describe("backdrop", () => {
  test("a theme in the terminal's own mode shows the terminal's background", () => {
    expect(themeFor("auto", "dark", {}).backdrop).toBe("transparent");
    expect(themeFor("light", "light", {}).backdrop).toBe("transparent");
    expect(themeFor("auto", "dark", {})).toBe(themeFor("dark", "dark", {}));
  });

  test("a theme the terminal did not report paints its own background", () => {
    expect(themeFor("light", "dark", {}).backdrop).toBe(themeForMode("light", {}).background);
    expect(themeFor("auto", null, {}).backdrop).toBe(themeForMode("dark", {}).background);
  });
});

describe("theme contrast", () => {
  for (const mode of ["dark", "light"] as const) {
    const theme = themeForMode(mode);

    test(`${mode}: text colors meet WCAG AA on the background and code background`, () => {
      const failing = TEXT.flatMap((key) =>
        [theme.background, theme.codeBackground].flatMap((background) =>
          contrast(theme[key], background) < 4.5 ? [`${key} on ${background}`] : [],
        ),
      );

      expect(failing).toEqual([]);
    });

    test(`${mode}: diff text meets WCAG AA on its diff background`, () => {
      expect(contrast(theme.diffAdded, theme.diffAddedBackground)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.diffRemoved, theme.diffRemovedBackground)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
