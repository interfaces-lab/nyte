import { expect, test } from "vitest";
import { testRenderer } from "../../../../test/renderer.ts";

test(
  "the changes panel confirms a revert, calls it, refreshes, and clears the review mark",
  { timeout: 60_000 },
  async () => {
    expect(await testRenderer(new URL("./changes-revert.browser-test.tsx", import.meta.url))).toBe(
      "passed",
    );
  },
);
