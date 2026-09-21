import { expect, test } from "vitest";
import { testRenderer } from "../../../../test/renderer.ts";

test(
  "the workbench strip keeps interleaved order and marks a running agent terminal",
  { timeout: 60_000 },
  async () => {
    expect(
      await testRenderer(
        new URL("./tab-strip.browser-test.tsx", import.meta.url),
        "window.nyte = {};",
      ),
    ).toBe("passed");
  },
);
