import { expect, test } from "vitest";
import { testRenderer } from "../../../../test/renderer.ts";
import { sidebarCountLabel } from "./changes-sidebar.tsx";

test("the header count keeps the total and adds the filtered count while a filter is on", () => {
  expect(sidebarCountLabel(4, 4, false)).toBe("4 Files Changed");
  expect(sidebarCountLabel(1, 1, false)).toBe("1 File Changed");
  expect(sidebarCountLabel(4, 4, true)).toBe("4 Files Changed");
  expect(sidebarCountLabel(4, 1, true)).toBe("1 of 4 Files Changed");
  expect(sidebarCountLabel(4, 0, true)).toBe("0 of 4 Files Changed");
});

test(
  "the changes rail searches, reports review state, and drives review and revert",
  { timeout: 60_000 },
  async () => {
    expect(await testRenderer(new URL("./changes-sidebar.browser-test.tsx", import.meta.url))).toBe(
      "passed",
    );
  },
);
