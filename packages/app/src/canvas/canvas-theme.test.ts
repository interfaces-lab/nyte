import { CANVAS_VARIABLES, sanitizeCanvasVariables } from "@nyte-ai/plugin/canvas/protocol";
import { describe, expect, test } from "vitest";
import { canvasTheme } from "./canvas-theme.ts";
import type { CanvasAppearance } from "./canvas-theme.ts";

const appearance: CanvasAppearance = {
  dark: true,
  tintHue: 250,
  tintIntensity: 40,
  uiFont: "inter",
  codeFont: "jetbrains-mono",
  uiFontSize: 13,
  codeFontSize: 12,
  antialiased: true,
  reduceTransparency: false,
  vibrancy: true,
};

describe("canvas theme", () => {
  test("names every variable the shell accepts and nothing else", () => {
    const { variables } = canvasTheme(appearance).styles;

    expect(Object.keys(variables).sort()).toEqual([...CANVAS_VARIABLES].sort());
    expect(sanitizeCanvasVariables(variables)).toEqual(variables);
  });

  test("a local font keeps its quoted family and drops the display tracking", () => {
    const { variables } = canvasTheme({
      ...appearance,
      dark: false,
      uiFont: "local:Avenir Next",
      antialiased: false,
      tintIntensity: 0,
      reduceTransparency: true,
    }).styles;

    expect(variables["--nyte-font-family-sans"]).toBe('"Avenir Next", system-ui, sans-serif');
    expect(variables["--nyte-letter-spacing-lg"]).toBe("0em");
    expect(variables["--nyte-custom-chroma-scale"]).toBe("0");
    expect(variables["--nyte-font-smoothing"]).toBe("auto");
    expect(variables["--nyte-reduce-transparency"]).toBe("1");
  });
});
