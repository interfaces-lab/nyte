import { expect, test } from "vitest";
import { initialMode, nextMode, NO_INPUT, steeringUp, touching } from "./transcript-mode.ts";
import type { TranscriptEvent, TranscriptMode } from "./transcript-mode.ts";

const anchor = { key: "prompt:p", element: undefined, top: 40 };

const opening: TranscriptMode = { kind: "following", opening: true };

const following: TranscriptMode = { kind: "following", opening: false };

const reading: TranscriptMode = { kind: "reading", anchor: null };

const held: TranscriptMode = { kind: "reading", anchor };

function scrolled(
  distance: number,
  upward: boolean,
  reader = false,
): Extract<TranscriptEvent, { readonly kind: "scrolled" }> {
  return { kind: "scrolled", distance, upward, reader };
}

test("a session left at the end opens following it, and one left elsewhere reopens at its row", () => {
  expect(initialMode({ kind: "end" })).toEqual(opening);
  expect(initialMode({ kind: "anchor", key: "prompt:p", offset: 40 })).toEqual(held);
});

test.each<[string, TranscriptMode, readonly TranscriptEvent[], TranscriptMode]>([
  ["sending or scroll-to-bottom follows from a hold", held, [{ kind: "ended" }], following],
  ["the reader scrolling down to within 4 px follows", reading, [scrolled(4, false)], following],
  ["scrolling down that stops 5 px short keeps reading", reading, [scrolled(5, false)], reading],
  [
    "a reader's upward scroll releases even within 4 px",
    following,
    [scrolled(2, true, true)],
    reading,
  ],
  [
    "an upward movement the reader didn't make keeps following within 4 px",
    following,
    [scrolled(3, true)],
    following,
  ],
  [
    "an upward movement the reader didn't make releases past 4 px",
    following,
    [scrolled(5, true)],
    reading,
  ],
  ["downward movement never releases", following, [scrolled(400, false, true)], following],
  [
    "an upward scroll ending within 4 px keeps reading",
    reading,
    [scrolled(1, true, true)],
    reading,
  ],
  ["a quiet view within 4 px follows again", reading, [{ kind: "quiet", distance: 3 }], following],
  ["a quiet view further up keeps reading", reading, [{ kind: "quiet", distance: 40 }], reading],
  ["a quiet view never drops a hold", held, [{ kind: "quiet", distance: 0 }], held],
  ["expanding, editing or selecting holds its anchor", following, [{ kind: "held", anchor }], held],
  ["only the reader's input releases a hold", held, [scrolled(0, false), { kind: "opened" }], held],
  ["the reader's input drops a hold", held, [{ kind: "touched" }], reading],
  ["the reader's input alone leaves following alone", following, [{ kind: "touched" }], following],
  ["opening keeps following while rows measure", opening, [scrolled(900, true)], opening],
  ["opening ends once it reaches the end", opening, [{ kind: "opened" }], following],
  ["the reader interrupts opening by scrolling up", opening, [scrolled(900, true, true)], reading],
])("%s", (_name, start, events, expected) => {
  expect(events.reduce(nextMode, start)).toEqual(expected);
});

test("the reader's input explains movement for 250 ms, and a held scrollbar for as long as it's held", () => {
  const wheeledUp = { at: 1_000, upward: true, pressed: false };
  const wheeledDown = { ...wheeledUp, upward: false };
  const held = { ...NO_INPUT, pressed: true };

  expect([1_250, 1_251].map((now) => steeringUp(wheeledUp, now))).toEqual([true, false]);
  expect([steeringUp(wheeledDown, 1_100), touching(wheeledDown, 1_100)]).toEqual([false, true]);
  expect([steeringUp(held, 9_000), touching(NO_INPUT, 0)]).toEqual([true, false]);
});
