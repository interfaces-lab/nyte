import process from "node:process";
import { expect, test } from "vitest";
import { testRenderer } from "../../../test/renderer.ts";

test(
  "scrolling, pinned editing and reflow keep content and reading anchors",
  { timeout: 120_000 },
  async () => {
    expect(
      await testRenderer(
        new URL("./transcript-frames.browser-test.tsx", import.meta.url),
        `window.nyte = { clientSurface: "desktop", platform: "linux", host: { setThemePreference() {} } };`,
        { captures: process.env.NYTE_FRAME_CAPTURES },
      ),
    ).toBe("passed");
  },
);
