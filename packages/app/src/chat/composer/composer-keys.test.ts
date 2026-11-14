import { expect, test } from "vitest";
import {
  composerKey,
  draftEmpty,
  enterBehavior,
  recallDirection,
  submissionDelivery,
} from "./composer-keys.ts";
import type { KeyAction, KeySituation } from "./composer-keys.ts";

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

const PASS: KeyAction = { kind: "pass" };

const SITUATION: KeySituation = {
  from: "editor",
  disabled: false,
  submitting: false,
  editing: false,
  empty: false,
  steerQueued: false,
  trayOpen: false,
  menuOpen: false,
  canStop: false,
  canRecall: false,
};

const KEY = {
  key: "Enter",
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  isComposing: false,
  defaultPrevented: false,
};

const QUEUED_EMPTY = { empty: true, steerQueued: true };

test.each<{
  readonly name: string;
  readonly situation: Partial<KeySituation>;
  readonly key: Partial<typeof KEY>;
  readonly action: KeyAction;
}>([
  {
    name: "Enter on an empty draft steers the next queued message",
    situation: QUEUED_EMPTY,
    key: {},
    action: { kind: "steer-queued" },
  },
  {
    name: "Enter with text sends it",
    situation: { steerQueued: true },
    key: {},
    action: { kind: "submit", action: "submit" },
  },
  {
    name: "Enter on an empty draft while disabled submits, which does nothing",
    situation: { ...QUEUED_EMPTY, disabled: true },
    key: {},
    action: { kind: "submit", action: "submit" },
  },
  {
    name: "Enter on an empty draft while sending submits, which does nothing",
    situation: { ...QUEUED_EMPTY, submitting: true },
    key: {},
    action: { kind: "submit", action: "submit" },
  },
  {
    name: "Enter while editing a queued message saves it",
    situation: { ...QUEUED_EMPTY, editing: true },
    key: {},
    action: { kind: "submit", action: "submit" },
  },
  {
    name: "Ctrl+Enter on an empty draft never steers the queue",
    situation: QUEUED_EMPTY,
    key: { ctrlKey: true },
    action: { kind: "submit", action: "submit-alternate" },
  },
  {
    name: "Cmd+Enter submits the other delivery even with the menu open",
    situation: { menuOpen: true },
    key: { metaKey: true },
    action: { kind: "submit", action: "submit-alternate" },
  },
  { name: "Shift+Enter is a line break", situation: {}, key: { shiftKey: true }, action: PASS },
  {
    name: "Enter while composing is the IME's",
    situation: {},
    key: { isComposing: true },
    action: PASS,
  },
  {
    name: "Escape cancels an edit",
    situation: { editing: true, canStop: true },
    key: { key: "Escape" },
    action: { kind: "cancel-edit" },
  },
  {
    name: "Escape while an edit saves is swallowed",
    situation: { editing: true, submitting: true },
    key: { key: "Escape" },
    action: { kind: "swallow" },
  },
  {
    name: "Escape on a disabled editor passes",
    situation: { editing: true, disabled: true, canStop: true },
    key: { key: "Escape" },
    action: PASS,
  },
  {
    name: "Escape with the menu open passes",
    situation: { editing: true, menuOpen: true },
    key: { key: "Escape" },
    action: PASS,
  },
  {
    name: "Escape closes an open tray before it stops the run",
    situation: { trayOpen: true, canStop: true },
    key: { key: "Escape" },
    action: { kind: "dismiss-tray" },
  },
  {
    name: "Escape with no tray open stops the run",
    situation: { canStop: true },
    key: { key: "Escape" },
    action: { kind: "stop" },
  },
  {
    name: "Escape with no tray and no run passes",
    situation: {},
    key: { key: "Escape" },
    action: PASS,
  },
  {
    name: "Ctrl+Alt+Up recalls an older prompt",
    situation: { canRecall: true },
    key: { key: "ArrowUp", ctrlKey: true, altKey: true },
    action: { kind: "recall", direction: "older" },
  },
  {
    name: "Ctrl+Alt+Down recalls a newer prompt",
    situation: { canRecall: true },
    key: { key: "ArrowDown", ctrlKey: true, altKey: true },
    action: { kind: "recall", direction: "newer" },
  },
  {
    name: "Ctrl+Alt+Up passes where recall is off",
    situation: { editing: true },
    key: { key: "ArrowUp", ctrlKey: true, altKey: true },
    action: PASS,
  },
  {
    name: "Escape from another control cancels an edit",
    situation: { from: "form", editing: true },
    key: { key: "Escape" },
    action: { kind: "cancel-edit" },
  },
  {
    name: "Escape from another control while an edit saves passes",
    situation: { from: "form", editing: true, submitting: true },
    key: { key: "Escape" },
    action: PASS,
  },
  {
    name: "Escape the editor already handled passes the form",
    situation: { from: "form", editing: true },
    key: { key: "Escape", defaultPrevented: true },
    action: PASS,
  },
  {
    name: "Escape from another control with the menu open passes",
    situation: { from: "form", editing: true, menuOpen: true },
    key: { key: "Escape" },
    action: PASS,
  },
  {
    name: "Escape from another control with no edit passes",
    situation: { from: "form", canStop: true },
    key: { key: "Escape" },
    action: PASS,
  },
  {
    name: "Enter from another control passes the form",
    situation: { from: "form", editing: true },
    key: {},
    action: PASS,
  },
])("$name", (row) => {
  expect(composerKey({ ...SITUATION, ...row.situation }, { ...KEY, ...row.key })).toEqual(
    row.action,
  );
});

test.each([
  { text: "", attachments: 0, empty: true },
  { text: "  \n ", attachments: 0, empty: true },
  { text: " ", attachments: 1, empty: false },
  { text: "Steer", attachments: 0, empty: false },
])("a draft of $text.length characters and $attachments images is empty: $empty", (row) => {
  expect(draftEmpty(row.text, row.attachments)).toBe(row.empty);
});
