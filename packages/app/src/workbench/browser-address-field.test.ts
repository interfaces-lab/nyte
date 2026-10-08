import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

test("composed text fills in once finished, and an accepted completion opens its page", async () => {
  expect(
    await testRenderer(
      new URL("./browser-address-field.browser-test.tsx", import.meta.url),
      "window.nyte = {};",
    ),
  ).toBe("passed");
}, 60_000);
