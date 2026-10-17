import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

test("New Terminal opens cold without its panel suspending", { timeout: 60_000 }, async () => {
  expect(
    await testRenderer(
      new URL("./open-cold.browser-test.tsx", import.meta.url),
      `window.nyte = { clientSurface: "desktop", platform: "linux", host: {} };`,
    ),
  ).toBe("passed");
});
