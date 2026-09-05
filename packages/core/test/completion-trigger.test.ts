import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { completionTrigger } from "../src/completion-trigger.ts";

describe("completionTrigger", () => {
  test("returns the full slash token while filtering at the caret", () => {
    assert.deepEqual(completionTrigger("ask /grilling now", 8), {
      kind: "/",
      start: 4,
      end: 13,
      query: "gri",
    });
  });

  test("allows paths in mention queries", () => {
    assert.deepEqual(completionTrigger("see @src/file.ts", 16), {
      kind: "@",
      start: 4,
      end: 16,
      query: "src/file.ts",
    });
  });

  test("does not treat trigger characters inside words as completion", () => {
    assert.equal(completionTrigger("user@example.com", 8), undefined);
    assert.equal(completionTrigger("src/file.ts", 7), undefined);
  });
});
