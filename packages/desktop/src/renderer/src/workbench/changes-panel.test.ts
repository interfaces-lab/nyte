import assert from "node:assert/strict";
import { test } from "vitest";
import { testRenderer } from "../../../../test/renderer.ts";

test(
  "the native file tree and code view show files, counts, and diff-header actions",
  { timeout: 60_000 },
  async () => {
    assert.equal(
      await testRenderer(new URL("./changes-panel.browser-test.tsx", import.meta.url)),
      "passed",
    );
  },
);
