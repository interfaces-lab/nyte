import { expect, test } from "vitest";
import { testRenderer } from "../../../../test/renderer.ts";

test(
  "large work groups keep rows stable across modes and settlement",
  { timeout: 60_000 },
  async () => {
    expect(
      await testRenderer(
        new URL("./work-group-window.browser-test.tsx", import.meta.url),
        "window.nyte = { host: { setThemePreference() {} } };",
      ),
    ).toBe("passed");
  },
);
