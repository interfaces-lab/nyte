import { expect, test } from "vitest";
import { testRenderer } from "../../../test/renderer.ts";

test(
  "a finished reply shows its work time, copy and age; copy checks reset after 2 s; a working subagent's link animates; a streamed reply keeps its text and selection when its turn ends",
  { timeout: 90_000 },
  async () => {
    expect(
      await testRenderer(
        new URL("./reply-blocks.browser-test.tsx", import.meta.url),
        `window.nyte = { clientSurface: "desktop", platform: "linux", host: { setThemePreference() {} } };`,
        { motion: "no-preference" },
      ),
    ).toBe("passed");
  },
);
