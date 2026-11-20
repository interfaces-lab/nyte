import { expect, test } from "vitest";
import { nextHeld, RELEASED } from "./held-keys.ts";
import type { HeldKeys, KeyStroke } from "./held-keys.ts";

const META: HeldKeys = { meta: true, ctrl: false, digit: undefined };

const META_3: HeldKeys = { meta: true, ctrl: false, digit: "3" };

const stroke = (type: string, code: string, metaKey = false, ctrlKey = false): KeyStroke => ({
  type,
  code,
  metaKey,
  ctrlKey,
});

test.each([
  ["Meta down", RELEASED, stroke("keydown", "MetaLeft", true), META],
  ["Digit3 down with Meta", META, stroke("keydown", "Digit3", true), META_3],
  ["Digit3 up with Meta still held", META_3, stroke("keyup", "Digit3", true), META],
  [
    "Control down",
    RELEASED,
    stroke("keydown", "ControlLeft", false, true),
    { ...RELEASED, ctrl: true },
  ],
  ["Digit0 holds no tab", META, stroke("keydown", "Digit0", true), META],
  ["Meta up", META, stroke("keyup", "MetaLeft"), RELEASED],
  ["blur", META_3, undefined, RELEASED],
])("%s", (_name, previous, event, held) => {
  expect(nextHeld(previous, event)).toEqual(held);
});

test.each([
  ["a letter typed with nothing held", RELEASED, stroke("keydown", "KeyA")],
  ["its key up", RELEASED, stroke("keyup", "KeyA")],
  ["Meta repeating", META, stroke("keydown", "MetaLeft", true)],
  ["Digit3 repeating", META_3, stroke("keydown", "Digit3", true)],
  ["blur with nothing held", RELEASED, undefined],
])("%s keeps the same held keys", (_name, previous, event) => {
  expect(nextHeld(previous, event)).toBe(previous);
});
