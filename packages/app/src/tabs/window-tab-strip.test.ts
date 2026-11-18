import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

test(
  "the window tab strip reorders, closes on Delete, sizes tabs to their titles, fades its edges and names a preview without italics",
  { timeout: 60_000 },
  async () => {
    expect(
      await testRenderer(
        new URL("./window-tab-strip.browser-test.tsx", import.meta.url),
        "window.nyte = {};",
      ),
    ).toBe("passed");
  },
);
