import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { isDefaultUsageOrder, parseUsageOrder, USAGE_CARDS } from "./usage-layout.ts";

describe("usage card order", () => {
  test("opens on the default arrangement without a stored one", () => {
    assert.deepEqual(parseUsageOrder(null), USAGE_CARDS);
    assert.deepEqual(parseUsageOrder("not json"), USAGE_CARDS);
    assert.deepEqual(parseUsageOrder('{"spend":1}'), USAGE_CARDS);
  });

  test("keeps the stored arrangement", () => {
    const stored = ["chats", "folders", "activity", "models", "tokens", "spend"];

    assert.deepEqual(parseUsageOrder(JSON.stringify(stored)), stored);
  });

  test("drops retired and repeated ids, then appends cards this build added", () => {
    const parsed = parseUsageOrder(JSON.stringify(["chats", "gone", "chats", "models"]));

    assert.deepEqual(parsed.slice(0, 2), ["chats", "models"]);
    assert.deepEqual(
      parsed.toSorted(),
      [...USAGE_CARDS].toSorted(),
      "every card the build knows about is placed exactly once",
    );
  });

  test("recognizes an arrangement nobody moved", () => {
    assert.equal(isDefaultUsageOrder(USAGE_CARDS), true);
    assert.equal(isDefaultUsageOrder(parseUsageOrder(JSON.stringify(["chats"]))), false);
  });
});
