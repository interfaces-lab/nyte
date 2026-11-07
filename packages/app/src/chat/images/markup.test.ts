import { expect, test } from "vitest";
import { testRenderer } from "../../../test/renderer.ts";

test("markup paths and PNG copies preserve source-pixel geometry, including reverse drags and dark ink", async () => {
  expect(await testRenderer(new URL("./markup.browser-test.ts", import.meta.url))).toBe("passed");
}, 60_000);
