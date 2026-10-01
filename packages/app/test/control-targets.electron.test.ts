import { expect, test } from "vitest";
import { testRenderer } from "./renderer.ts";

test(
  "control hit areas meet pointer floors without overlapping in groups or toolbars",
  { timeout: 90_000 },
  async () => {
    for (const pointer of ["fine", "coarse"] as const) {
      expect(
        await testRenderer(new URL("./control-targets.browser-test.tsx", import.meta.url), "", {
          pointer,
        }),
        pointer,
      ).toBe("passed");
    }
  },
);
