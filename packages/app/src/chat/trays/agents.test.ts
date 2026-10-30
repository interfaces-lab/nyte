import { expect, test } from "vitest";
import { testRenderer } from "../../../test/renderer.ts";

test(
  "an agent's chat opens with its tray in one frame, switches, closes and expands",
  { timeout: 120_000 },
  async () => {
    expect(
      await testRenderer(
        new URL("./agents.browser-test.tsx", import.meta.url),
        `window.nyte = { clientSurface: "desktop", platform: "linux", host: { setThemePreference() {} } };`,
        { motion: "no-preference" },
      ),
    ).toBe("passed");
  },
);
