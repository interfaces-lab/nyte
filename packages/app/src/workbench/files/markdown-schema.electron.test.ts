import { expect, test } from "vitest";
import { testRenderer } from "../../../test/renderer.ts";

test(
  "the markdown document's list keys and clipboard run in a real editor",
  { timeout: 60_000 },
  async () => {
    expect(await testRenderer(new URL("./markdown-schema.browser-test.tsx", import.meta.url))).toBe(
      "passed",
    );
  },
);
