import { expect, test } from "vitest";
import { testRenderer } from "../../../../test/renderer.ts";

test(
  "the stacked diff collapses per file and follows the panel's collapse-all state",
  { timeout: 60_000 },
  async () => {
    // The stack renders no data of its own, but its import chain reaches the
    // renderer's query layer, which reads the bridge as it loads.
    const bridge =
      "window.nyte = { sessions: {}, watch: () => () => {}, host: { setThemePreference() {} } };";
    expect(
      await testRenderer(new URL("./changes-stack.browser-test.tsx", import.meta.url), bridge),
    ).toBe("passed");
  },
);
