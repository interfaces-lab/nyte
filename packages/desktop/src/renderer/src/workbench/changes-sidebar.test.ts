import { expect, test } from "vitest";
import { testRenderer } from "../../../../test/renderer.ts";
test(
  "the native changes tree filters, reveals files, and retains state across updates",
  { timeout: 60_000 },
  async () => {
    expect(await testRenderer(new URL("./changes-sidebar.browser-test.tsx", import.meta.url))).toBe(
      "passed",
    );
  },
);
