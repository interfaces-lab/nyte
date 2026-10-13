import process from "node:process";
import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

// NYTE_COMPOSER_STUDIO=1 opens the states in a window to switch between by hand; closing it ends the test.
const studio = process.env.NYTE_COMPOSER_STUDIO === "1";

test(
  "every composer state draws as meant alone and in its thread",
  { timeout: studio ? 0 : 90_000 },
  async () => {
    expect(
      await testRenderer(
        new URL("./composer-states.browser-test.tsx", import.meta.url),
        `window.nyte = { clientSurface: "desktop", host: { setThemePreference() {} } };`,
        { studio },
      ),
    ).toBe("passed");
  },
);
