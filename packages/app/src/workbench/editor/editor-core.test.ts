import { expect, test } from "vitest";
import { NO_MOUSE, testRenderer } from "../../../test/renderer.ts";

test(
  "a click after setSelections lands, ⌘-click reaches the token hook, ⌥⇧-click adds a caret, and IME commits",
  { timeout: 90_000 },
  async ({ skip }) => {
    const result = await testRenderer(
      new URL("./editor-core.browser-test.tsx", import.meta.url),
      "",
      {
        mouse: true,
        timeout: 60_000,
      },
    );

    skip(result === NO_MOUSE, NO_MOUSE);
    expect(result).toBe("passed");
  },
);
