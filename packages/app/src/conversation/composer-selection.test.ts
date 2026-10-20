import { expect, test } from "vitest";
import { NO_MOUSE, testRenderer } from "../../test/renderer.ts";

test(
  "composer extends native selections through text and padding",
  { timeout: 60_000 },
  async ({ skip }) => {
    const result = await testRenderer(
      new URL("./composer-selection.browser-test.tsx", import.meta.url),
      "window.nyte = { sessions: {} };",
      { mouse: true },
    );

    skip(result === NO_MOUSE, NO_MOUSE);
    expect(result).toBe("passed");
  },
);
