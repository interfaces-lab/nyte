import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

test("a tool row draws a bounded excerpt of a large output", { timeout: 60_000 }, async () => {
  expect(
    await testRenderer(
      new URL("./tool-output.browser-test.tsx", import.meta.url),
      `window.nyte = { clientSurface: "desktop", host: { setThemePreference() {} } };`,
    ),
  ).toBe("passed");
});
