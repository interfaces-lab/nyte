import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

test("a pane keeps its three most recent sessions mounted", { timeout: 90_000 }, async () => {
  expect(
    await testRenderer(
      new URL("./warm-sessions.browser-test.tsx", import.meta.url),
      `window.nyte = { clientSurface: "desktop", platform: "linux", host: { setThemePreference() {} } };`,
    ),
  ).toBe("passed");
});
