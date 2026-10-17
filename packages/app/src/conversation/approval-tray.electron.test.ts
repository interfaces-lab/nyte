import process from "node:process";
import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

test("an approval asks above the composer, takes the keyboard and sends one answer", async () => {
  expect(
    await testRenderer(
      new URL("./approval-tray.browser-test.tsx", import.meta.url),
      `window.nyte = { clientSurface: "desktop", platform: "linux", host: { setThemePreference() {} } };`,
      { captures: process.env.NYTE_CAPTURES },
    ),
  ).toBe("passed");
}, 90_000);
