/** What a surface may read from a call's state: the verb's tense, the tone, and the word that names a cause. */
import assert from "node:assert/strict";
import { test } from "vitest";
import type { ToolOutcome, ToolState } from "@nyte-ai/protocol";
import { formatToolDuration, toolStatus } from "../src/index.ts";

const settled = (outcome: ToolOutcome): ToolState => ({ ...outcome, commit: "c1" });

test("a call that has not finished reads as running and adds nothing", () => {
  const running = { tense: "running", tone: "running", word: undefined };
  assert.deepEqual(toolStatus({ kind: "pending" }), running);
  assert.deepEqual(toolStatus({ kind: "running" }), running);
});

test("a call parked on a participant's reply asks for input", () => {
  assert.deepEqual(toolStatus({ kind: "running", waitingFor: { kind: "input", waitId: "w1" } }), {
    tense: "running",
    tone: "attention",
    word: "Needs input",
  });
});

test("success speaks in the past tense with nothing added", () => {
  assert.deepEqual(toolStatus(settled({ kind: "success" })), {
    tense: "past",
    tone: "success",
    word: undefined,
  });
});

test("a nonzero exit names the code: the command did run", () => {
  assert.deepEqual(toolStatus(settled({ kind: "error", reason: { kind: "exit", code: 1 } })), {
    tense: "past",
    tone: "failure",
    word: "Exit 1",
  });
  assert.equal(
    toolStatus(settled({ kind: "error", reason: { kind: "exit", code: -9 } })).word,
    "Exit -9",
  );
});

test("a tool that did not finish asserts no verb and names why", () => {
  const cases = [
    ["error", "failure", "Failed"],
    ["timeout", "failure", "Timed out"],
    ["denied", "failure", "Blocked"],
    ["cancelled", "stopped", "Stopped"],
    ["interrupted", "stopped", "Interrupted"],
  ] as const;

  for (const [kind, tone, word] of cases) {
    assert.deepEqual(
      toolStatus(settled({ kind: "error", reason: { kind } })),
      { tense: "none", tone, word },
      kind,
    );
  }
});

test("a call settled without a commit reads like any other settled call", () => {
  assert.equal(
    toolStatus({ kind: "error", reason: { kind: "interrupted" }, commit: null }).word,
    "Interrupted",
  );
});

test("durations read in tenths under ten seconds, then whole units", () => {
  assert.equal(formatToolDuration(0), "0.0s");
  assert.equal(formatToolDuration(1234), "1.2s");
  assert.equal(formatToolDuration(12_600), "12s");
  assert.equal(formatToolDuration(65_000), "1m 5s");
  assert.equal(formatToolDuration(3_720_000), "1h 2m");
});
