import { expect, test } from "vitest";
import { testRenderer } from "../../../test/renderer.ts";

test(
  "a tray in a chat that hides and shows again neither sticks while closing nor takes focus",
  { timeout: 120_000 },
  async () => {
    const report: unknown = JSON.parse(
      await testRenderer(
        new URL("./tray.browser-test.tsx", import.meta.url),
        `window.nyte = { clientSurface: "desktop", platform: "linux", host: { setThemePreference() {} } };`,
        { motion: "no-preference" },
      ),
    );

    expect(report).toEqual({
      "closed as its chat hides": "gone, focus on body",
      "closed while its chat is hidden": "gone, focus on body",
      "left open while its chat is hidden": "shown, focus on body",
    });
  },
);
