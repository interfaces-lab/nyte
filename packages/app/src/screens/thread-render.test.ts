import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

test(
  "thread rows preserve identity across landing and live deltas",
  { timeout: 60_000 },
  async () => {
    expect(
      await testRenderer(
        new URL("./thread-render.browser-test.tsx", import.meta.url),
        `window.nyte = { clientSurface: "desktop", host: { setThemePreference() {} } };`,
      ),
    ).toBe("passed");
  },
);
