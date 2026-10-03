import { expect, test } from "vitest";
import { testRenderer } from "./renderer.ts";

test(
  "icons retain native ink and luminance and inherit control-state colors",
  { timeout: 60_000 },
  async () => {
    for (const forcePseudoClasses of [[], ["hover"], ["hover", "active"]]) {
      const setup = forcePseudoClasses.length
        ? 'document.documentElement.dataset.iconForced = "true";'
        : "";

      expect(
        await testRenderer(new URL("./icons.browser-test.tsx", import.meta.url), setup, {
          forcePseudoClasses,
          forcePseudoSelector: '[data-control^="button:"] button',
        }),
      ).toBe("passed");
    }
  },
);
