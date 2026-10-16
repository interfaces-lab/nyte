import process from "node:process";
import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

const studio = process.env.NYTE_COMPOSER_STUDIO === "1";

test(
  "every composer state draws as meant alone and in its thread",
  { timeout: studio ? 0 : 90_000 },
  async () => {
    expect(
      await testRenderer(
        new URL("./composer-states.browser-test.tsx", import.meta.url),
        `window.nyte = { clientSurface: "desktop", platform: "linux", host: { setThemePreference() {} } };`,
        { studio },
      ),
    ).toBe("passed");
  },
);
