import { expect, test } from "vitest";
import { NO_MOUSE, testRenderer } from "./renderer.ts";

test(
  "icons retain native ink and luminance and inherit control-state colors",
  { timeout: 60_000 },
  async ({ skip }) => {
    for (const forcePseudoClasses of [[], ["hover"], ["hover", "active"]]) {
      const setup = forcePseudoClasses.length
        ? 'document.documentElement.dataset.iconForced = "true";'
        : "";

      const result = await testRenderer(
        new URL("./icons.browser-test.tsx", import.meta.url),
        setup,
        {
          forcePseudoClasses,
          forcePseudoSelector: '[data-control^="button:"] button',
          mouse: true,
        },
      );
      skip(result === NO_MOUSE, NO_MOUSE);
      expect(result).toBe("passed");
    }
  },
);
