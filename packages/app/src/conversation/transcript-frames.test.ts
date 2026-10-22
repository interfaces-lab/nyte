import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

test.each(["light", "dark"])(
  "scrolling, pinned editing and reflow keep content and reading anchors in %s mode",
  { timeout: 120_000 },
  async (mode) => {
    const directory = process.env.NYTE_FRAME_CAPTURES;
    const captures = directory === undefined ? undefined : join(directory, mode);

    if (captures !== undefined) await mkdir(captures, { recursive: true });
    expect(
      await testRenderer(
        new URL("./transcript-frames.browser-test.tsx", import.meta.url),
        `document.documentElement.dataset.frameScheme = ${JSON.stringify(mode)};
window.nyte = { clientSurface: "desktop", platform: "linux", host: { setThemePreference() {} } };`,
        { captures },
      ),
    ).toBe("passed");
  },
);
