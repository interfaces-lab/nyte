import { expect, test } from "vitest";
import { testRenderer } from "./renderer.ts";

test.each(["no-preference", "reduce"] as const)(
  "the spinner steps one animation through its phases with %s motion",
  { timeout: 60_000 },
  async (motion) => {
    expect(
      await testRenderer(new URL("./spinner.browser-test.tsx", import.meta.url), "", { motion }),
    ).toBe("passed");
  },
);
