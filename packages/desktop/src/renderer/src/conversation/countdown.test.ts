import { expect, test } from "vitest";
import { testRenderer } from "../../../../test/renderer.ts";

test("countdown stops at zero and keeps the final display", async () => {
  expect(await testRenderer(new URL("./countdown.browser-test.tsx", import.meta.url))).toBe(
    "passed",
  );
});
