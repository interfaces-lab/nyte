import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { DEFAULT_LANDING } from "@nyte-ai/core";
import { composerEnterAction, laneRoles, submissionLane } from "./composer-keys.ts";

const enter = (modifiers: Partial<Parameters<typeof composerEnterAction>[0]> = {}) => ({
  key: "Enter",
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  isComposing: false,
  ...modifiers,
});

describe("composer keys", () => {
  test("the roles come from what each lane lands at, never from a lane's name", () => {
    assert.deepEqual(laneRoles(DEFAULT_LANDING), { steer: "steer", queue: "queue" });
    assert.deepEqual(
      laneRoles({
        lanes: [
          { lane: "later", lands: "idle" },
          { lane: "now", lands: "boundary" },
        ],
        drain: "all",
      }),
      { steer: "now", queue: "later" },
    );
    assert.deepEqual(laneRoles({ lanes: [{ lane: "only", lands: "idle" }], drain: "one" }), {
      steer: "only",
      queue: "only",
    });
    assert.throws(() => laneRoles({ lanes: [], drain: "one" }));
  });

  test("Enter submits, the modifier submits to the other lane, Shift breaks the line, and the IME keeps its Enter", () => {
    assert.equal(composerEnterAction(enter()), "submit");
    assert.equal(composerEnterAction(enter({ metaKey: true })), "submit-alternate");
    assert.equal(composerEnterAction(enter({ ctrlKey: true })), "submit-alternate");
    assert.equal(composerEnterAction(enter({ shiftKey: true })), "newline");
    assert.equal(composerEnterAction(enter({ shiftKey: true, metaKey: true })), "newline");
    assert.equal(composerEnterAction(enter({ isComposing: true })), "none");
    assert.equal(composerEnterAction({ ...enter(), key: "a" }), "none");
  });

  test("a new message steers on Enter and queues with the modifier", () => {
    const roles = laneRoles(DEFAULT_LANDING);
    assert.equal(submissionLane("submit", roles), "steer");
    assert.equal(submissionLane("submit-alternate", roles), "queue");
  });

  test("an edited queued item keeps its lane on Enter and swaps roles with the modifier", () => {
    const roles = laneRoles(DEFAULT_LANDING);
    assert.equal(submissionLane("submit", roles, "queue"), "queue");
    assert.equal(submissionLane("submit-alternate", roles, "queue"), "steer");
    assert.equal(submissionLane("submit", roles, "steer"), "steer");
    assert.equal(submissionLane("submit-alternate", roles, "steer"), "queue");
  });
});
