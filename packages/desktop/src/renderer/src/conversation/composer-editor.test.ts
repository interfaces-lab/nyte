import { expect, test } from "vitest";
import { testRenderer } from "../../../../test/renderer.ts";

test(
  "composer reports references and preserves native selection without measuring inactive editors",
  { timeout: 60_000 },
  async () => {
    expect(await testRenderer(new URL("./composer-editor.browser-test.tsx", import.meta.url))).toBe(
      "passed",
    );
  },
);
