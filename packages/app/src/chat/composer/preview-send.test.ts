import { expect, test } from "vitest";
import { testRenderer } from "../../../test/renderer.ts";

test("sending from a preview keeps its tab; typing doesn't", { timeout: 90_000 }, async () => {
  const report: unknown = JSON.parse(
    await testRenderer(
      new URL("./preview-send.browser-test.tsx", import.meta.url),
      `window.nyte = { clientSurface: "desktop", platform: "linux", host: { setThemePreference() {} } };`,
    ),
  );

  expect(report).toEqual({
    typed: "preview-first (preview)",
    sent: "preview-first",
    replaced: "preview-first, preview-second (preview)",
  });
});
