import { expect, test } from "vitest";
import { testRenderer } from "./renderer.ts";

test("className, style, and xstyle beat a component's own rule", { timeout: 90_000 }, async () => {
  expect(await testRenderer(new URL("./style-order.browser-test.tsx", import.meta.url))).toBe(
    "passed",
  );
});
