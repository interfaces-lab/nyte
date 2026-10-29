import { expect, test } from "vitest";
import { enterBehavior, recallDirection, submissionDelivery } from "./composer-keys.ts";

test("while a run works, the placeholder and the send tooltip name what Enter does", () => {
  const steering = enterBehavior({ kind: "running", preference: "steer" }, true);
  const queueing = enterBehavior({ kind: "running", preference: "queue" }, false);

  expect(steering).toEqual({
    delivery: "steer",
    label: "Send message",
    title: "Steer (Enter) · Queue (⌘Enter)",
    placeholder: "Steer without stopping",
  });
  expect(queueing).toEqual({
    delivery: "queue",
    label: "Send message",
    title: "Queue (Enter) · Steer (Ctrl+Enter)",
    placeholder: "Queue for next turn",
  });
  expect(submissionDelivery("submit-alternate", steering.delivery)).toBe("queue");
  expect(submissionDelivery("submit-alternate", queueing.delivery)).toBe("steer");
});

test("outside a run the surface keeps its own placeholder, and an answer names itself", () => {
  expect(enterBehavior({ kind: "idle" }, false).placeholder).toBeUndefined();
  expect(enterBehavior({ kind: "editing-message" }, false).placeholder).toBeUndefined();
  expect(enterBehavior({ kind: "answering" }, false)).toMatchObject({
    label: "Send answer",
    placeholder: "Answer in your own words",
  });
  expect(enterBehavior({ kind: "editing-queued", delivery: "queue" }, false)).toMatchObject({
    delivery: "queue",
    title: "Update (Enter) · Steer Instead (Ctrl+Enter)",
  });
});

test("only Ctrl+Alt with Up or Down steps through the prompt history", () => {
  const key = (key: string, modifiers: Partial<KeyboardEvent> = {}) =>
    recallDirection({
      key,
      ctrlKey: true,
      altKey: true,
      metaKey: false,
      shiftKey: false,
      ...modifiers,
    });

  expect(key("ArrowUp")).toBe("older");
  expect(key("ArrowDown")).toBe("newer");
  expect(key("ArrowUp", { altKey: false })).toBeUndefined();
  expect(key("ArrowUp", { shiftKey: true })).toBeUndefined();
  expect(key("ArrowLeft")).toBeUndefined();
});
