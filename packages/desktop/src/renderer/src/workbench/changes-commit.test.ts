import { expect, test } from "vitest";
import { testRenderer } from "../../../../test/renderer.ts";

test(
  "the commit bar commits, pushes, and reports every refusal it can get",
  { timeout: 120_000 },
  async () => {
    expect(await testRenderer(new URL("./changes-commit.browser-test.tsx", import.meta.url))).toBe(
      "passed",
    );
  },
);
