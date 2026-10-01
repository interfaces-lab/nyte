import { expect, test } from "vitest";
import { testRenderer } from "./renderer.ts";

test(
  "className, style, and xstyle beat a component's own rule in built and injected styles",
  { timeout: 90_000 },
  async () => {
    for (const runtimeInjection of [false, true]) {
      expect(
        await testRenderer(new URL("./style-order.browser-test.tsx", import.meta.url), "", {
          runtimeInjection,
        }),
        runtimeInjection ? "runtime injection" : "built stylesheet",
      ).toBe("passed");
    }
  },
);
