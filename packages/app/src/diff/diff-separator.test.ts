import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

test(
  "the visible context control loads and reveals unchanged lines",
  { timeout: 60_000 },
  async () => {
    expect(
      await testRenderer(
        new URL("./diff-separator.browser-test.tsx", import.meta.url),
        `window.nyte = new Proxy({}, { get: () => new Proxy(function () {}, { get: () => () => {}, apply: () => Promise.resolve() }) });`,
      ),
    ).toBe("passed");
  },
);
