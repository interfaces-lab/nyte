import { expect, test } from "vitest";
import { nextPin, PINNED } from "./step-group-pin.ts";
import type { StepGroupPin, StepGroupPinEvent } from "./step-group-pin.ts";

const BOX = 144;

function scrolled(at: number, scrollTop: number, fromEnd: number): StepGroupPinEvent {
  return {
    kind: "scrolled",
    at,
    scrollTop,
    scrollHeight: scrollTop + BOX + fromEnd,
    clientHeight: BOX,
  };
}

const atEnd: StepGroupPin = { ...PINNED, scrollTop: 400 };

const reading: StepGroupPin = { ...atEnd, pinned: false, scrollTop: 300 };

test.each<[string, StepGroupPin, readonly StepGroupPinEvent[], boolean]>([
  ["following the end keeps the pin", atEnd, [scrolled(1000, 460, 0)], true],
  [
    "a wheel then a scroll up releases it",
    atEnd,
    [{ kind: "input", at: 1000 }, scrolled(1100, 380, 20)],
    false,
  ],
  [
    "a scroll up while the pointer is down releases it",
    atEnd,
    [{ kind: "pointer", down: true }, scrolled(9000, 380, 20)],
    false,
  ],
  [
    "a scroll up long after the last input is not the reader's",
    atEnd,
    [{ kind: "input", at: 1000 }, scrolled(1251, 380, 20)],
    true,
  ],
  [
    "a scroll up after the pointer lifts is not the reader's",
    atEnd,
    [{ kind: "pointer", down: true }, { kind: "pointer", down: false }, scrolled(9000, 380, 20)],
    true,
  ],
  [
    "the reader scrolling down above the end keeps the pin",
    atEnd,
    [{ kind: "input", at: 1000 }, scrolled(1100, 420, 40)],
    true,
  ],
  [
    "content shrinking at the end keeps the pin",
    atEnd,
    [{ kind: "input", at: 1000 }, scrolled(1100, 340, 0)],
    true,
  ],
  ["reading holds while time passes", reading, [scrolled(60_000, 300, 160)], false],
  [
    "scrolling down short of the end keeps reading",
    reading,
    [{ kind: "input", at: 1000 }, scrolled(1100, 340, 5)],
    false,
  ],
  [
    "scrolling back within four pixels of the end pins again",
    reading,
    [{ kind: "input", at: 1000 }, scrolled(1100, 340, 4)],
    true,
  ],
  [
    "content shrinking under the reader to the end pins again",
    reading,
    [scrolled(1000, 280, 0)],
    true,
  ],
])("%s", (_name, start, events, pinned) => {
  expect(events.reduce(nextPin, start).pinned).toBe(pinned);
});
