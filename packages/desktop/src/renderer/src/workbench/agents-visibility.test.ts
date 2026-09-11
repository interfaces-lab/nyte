import { expect, test } from "vitest";
import { testRenderer } from "../../../../test/renderer.ts";

test(
  "hidden agents stop observing and reopen with a fresh cursor and reading position",
  { timeout: 60_000 },
  async () => {
    expect(
      await testRenderer(new URL("./agents-visibility.browser-test.tsx", import.meta.url)),
    ).toBe("passed");
  },
);
