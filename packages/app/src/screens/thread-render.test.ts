import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

test("the transcript follows, holds anchors, and keeps its rows", { timeout: 90_000 }, async () => {
  expect(
    await testRenderer(
      new URL("./thread-render.browser-test.tsx", import.meta.url),
      `window.nyte = { clientSurface: "desktop", host: { setThemePreference() {} } };`,
    ),
  ).toBe("passed");
});
