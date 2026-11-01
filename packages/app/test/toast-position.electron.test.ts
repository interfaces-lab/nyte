import { expect, test } from "vitest";
import { testRenderer } from "./renderer.ts";

test(
  "toasts stack above their anchor, and at the bottom-end corner without anchor positioning",
  { timeout: 90_000 },
  async () => {
    expect(await testRenderer(new URL("./toast-position.browser-test.tsx", import.meta.url))).toBe(
      "passed",
    );
  },
);
