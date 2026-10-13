import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

test(
  "composer extends native selections through text and padding",
  { timeout: 60_000 },
  async () => {
    expect(
      await testRenderer(
        new URL("./composer-selection.browser-test.tsx", import.meta.url),
        "window.nyte = { sessions: {} };",
      ),
    ).toBe("passed");
  },
);
