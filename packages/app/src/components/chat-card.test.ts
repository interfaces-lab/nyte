import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

test("a sidebar row and a tab open the same chat card, which copies a line on click", async () => {
  expect(
    await testRenderer(
      new URL("./chat-card.browser-test.tsx", import.meta.url),
      `window.nyte = { clientSurface: "desktop", platform: "darwin", host: { setThemePreference() {} } };`,
    ),
  ).toBe("passed");
}, 90_000);
