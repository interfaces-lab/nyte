import { expect, test } from "vitest";
import { testRenderer } from "../../../../test/renderer.ts";

test("a tray is a surface of its own in both themes", { timeout: 60_000 }, async () => {
  expect(
    await testRenderer(
      new URL("./tray-surface.browser-test.tsx", import.meta.url),
      "window.nyte = { host: { setThemePreference() {} } };",
    ),
  ).toBe("passed");
});
