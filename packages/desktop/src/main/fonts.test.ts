import { describe, expect, it } from "vitest";
import { readLocalFonts } from "./fonts.ts";

describe("readLocalFonts", () => {
  it("normalizes the native macOS catalog", async () => {
    const catalog = await readLocalFonts("darwin", async (executable, arguments_) => {
      expect(executable).toBe("/usr/bin/osascript");
      expect(arguments_.slice(0, 3)).toEqual(["-l", "JavaScript", "-e"]);
      return JSON.stringify({
        sans: ["Avenir", " Avenir ", ".Hidden", "Inter"],
        monospace: ["Menlo", "Menlo", "PT Mono"],
      });
    });

    expect(catalog).toEqual({
      sans: ["Avenir", "Inter"],
      monospace: ["Menlo", "PT Mono"],
    });
  });

  it("uses fontconfig spacing to separate fixed-pitch families", async () => {
    const catalog = await readLocalFonts("linux", async () =>
      ["Inter\t0", "DejaVu Sans Mono,DejaVu Sans Mono Book\t100", "Noto Sans\t0"].join("\n"),
    );

    expect(catalog).toEqual({
      sans: ["Inter", "Noto Sans"],
      monospace: ["DejaVu Sans Mono", "DejaVu Sans Mono Book"],
    });
  });
});
