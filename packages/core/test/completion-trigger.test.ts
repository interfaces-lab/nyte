import assert from "node:assert/strict";
import { test } from "vitest";
import { completionTrigger } from "@nyte-ai/client";

test("a trigger at a word start yields the whole token, filtered at the caret; mid-word characters do not", () => {
  assert.deepEqual(completionTrigger("ask /grilling now", 8), {
    kind: "/",
    start: 4,
    end: 13,
    query: "gri",
  });
  assert.deepEqual(completionTrigger("see @src/file.ts", 16), {
    kind: "@",
    start: 4,
    end: 16,
    query: "src/file.ts",
  });
  assert.equal(completionTrigger("user@example.com", 8), undefined);
  assert.equal(completionTrigger("src/file.ts", 7), undefined);
});
