import { expect, test } from "vitest";
import { testRenderer } from "../../../test/renderer.ts";

test(
  "the composer recalls this chat's prompts, opens its model picker on Ctrl+/ and takes a paste from no field",
  { timeout: 60_000 },
  async () => {
    expect(
      await testRenderer(
        new URL("./composer-keys.browser-test.tsx", import.meta.url),
        `window.nyte = { clientSurface: "desktop", platform: "linux", host: { setThemePreference() {} } };`,
      ),
    ).toBe("passed");
  },
);
