import process from "node:process";
import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

test("a running shell command joins the terminals tray only once moved to the background from its step", async () => {
  expect(
    await testRenderer(
      new URL("./shell-background.browser-test.tsx", import.meta.url),
      `window.nyte = { clientSurface: "desktop", platform: "linux", host: { setThemePreference() {} } };`,
      { captures: process.env.NYTE_CAPTURES },
    ),
  ).toBe("passed");
}, 90_000);
