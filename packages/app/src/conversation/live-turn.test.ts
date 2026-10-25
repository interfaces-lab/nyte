import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

test(
  "the live turn waits 200 ms, plans, slows at 15 s, and hides while work shows",
  { timeout: 60_000 },
  async () => {
    expect(
      await testRenderer(
        new URL("./live-turn.browser-test.tsx", import.meta.url),
        "window.nyte = { host: { setThemePreference() {} } };",
      ),
    ).toBe("passed");
  },
);
