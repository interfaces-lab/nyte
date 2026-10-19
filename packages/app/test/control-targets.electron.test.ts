import { expect, test } from "vitest";
import { NO_MOUSE, testRenderer } from "./renderer.ts";

test(
  "control hit areas meet pointer floors without overlapping in groups or toolbars",
  { timeout: 90_000 },
  async ({ skip }) => {
    const entry = new URL("./control-targets.browser-test.tsx", import.meta.url);
    expect(await testRenderer(entry, "", { pointer: "coarse" }), "coarse").toBe("passed");
    const fine = await testRenderer(entry, "", { pointer: "fine", mouse: true });
    skip(fine === NO_MOUSE, NO_MOUSE);
    expect(fine, "fine").toBe("passed");
  },
);
