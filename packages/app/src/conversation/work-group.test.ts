import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

test("work groups follow, open in place, and settle", { timeout: 60_000 }, async () => {
  expect(
    await testRenderer(
      new URL("./work-group.browser-test.tsx", import.meta.url),
      "window.nyte = { host: { setThemePreference() {} } };",
    ),
  ).toBe("passed");
});
