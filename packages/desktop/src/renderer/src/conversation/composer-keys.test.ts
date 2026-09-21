import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { composerEnterAction, deliveryChoices, submissionDelivery } from "./composer-keys.ts";

const enter = (modifiers: Partial<Parameters<typeof composerEnterAction>[0]> = {}) => ({
  key: "Enter",
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  isComposing: false,
  ...modifiers,
});

describe("composer keys", () => {
  test("the delivery choices are fixed", () => {
    assert.deepEqual(deliveryChoices, { steer: "steer", queue: "next" });
  });

  test("Enter submits, the modifier submits to the other delivery, Shift breaks the line, and the IME keeps its Enter", () => {
    assert.equal(composerEnterAction(enter()), "submit");
    assert.equal(composerEnterAction(enter({ metaKey: true })), "submit-alternate");
    assert.equal(composerEnterAction(enter({ ctrlKey: true })), "submit-alternate");
    assert.equal(composerEnterAction(enter({ shiftKey: true })), "newline");
    assert.equal(composerEnterAction(enter({ shiftKey: true, metaKey: true })), "newline");
    assert.equal(composerEnterAction(enter({ isComposing: true })), "none");
    assert.equal(composerEnterAction({ ...enter(), key: "a" }), "none");
  });

  test("a new message uses next on Enter and steers with the modifier", () => {
    const roles = deliveryChoices;
    assert.equal(submissionDelivery("submit", roles), "next");
    assert.equal(submissionDelivery("submit-alternate", roles), "steer");
  });

  test("an edited queued item keeps its delivery on Enter and swaps roles with the modifier", () => {
    const roles = deliveryChoices;
    assert.equal(submissionDelivery("submit", roles, "next"), "next");
    assert.equal(submissionDelivery("submit-alternate", roles, "next"), "steer");
    assert.equal(submissionDelivery("submit", roles, "steer"), "steer");
    assert.equal(submissionDelivery("submit-alternate", roles, "steer"), "next");
  });
});
