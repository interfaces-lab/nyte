import { expect, test } from "vitest";
import { testRenderer } from "../../../../test/renderer.ts";

test(
  "the native stacked diff collapses and reveals one file without affecting another",
  { timeout: 60_000 },
  async () => {
    const bridge =
      "window.nyte = { sessions: {}, watch: () => () => {}, host: { setThemePreference() {} } };";
    expect(
      await testRenderer(new URL("./changes-stack.browser-test.tsx", import.meta.url), bridge),
    ).toBe("passed");
  },
);
