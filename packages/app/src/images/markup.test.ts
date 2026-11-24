import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

test("marked PNGs carry every mark at its source pixel, follow the crop and turns, and read light or dark from the photo", async () => {
  expect(await testRenderer(new URL("./markup.browser-test.ts", import.meta.url))).toBe("passed");
}, 60_000);
