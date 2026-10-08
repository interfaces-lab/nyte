/** What a surface may read from a call's state, and how it reads a measured duration. */
import assert from "node:assert/strict";
import { test } from "vitest";
import { formatToolDuration, toolStatus } from "../src/index.ts";

test("a nonzero exit names the code: the command did run", () => {
  assert.deepEqual(toolStatus({ kind: "error", reason: { kind: "exit", code: 1 }, commit: "c1" }), {
    tense: "past",
    tone: "failure",
    word: "Exit 1",
  });
  assert.equal(
    toolStatus({ kind: "error", reason: { kind: "exit", code: -9 }, commit: "c1" }).word,
    "Exit -9",
  );
});

test("durations read in tenths under ten seconds, then whole units", () => {
  assert.equal(formatToolDuration(0), "0.0s");
  assert.equal(formatToolDuration(1234), "1.2s");
  assert.equal(formatToolDuration(12_600), "12s");
  assert.equal(formatToolDuration(65_000), "1m 5s");
  assert.equal(formatToolDuration(3_720_000), "1h 2m");
});
