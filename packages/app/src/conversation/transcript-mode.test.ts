import { expect, test } from "vitest";
import { initialMode, nextMode } from "./transcript-mode.ts";
import type { TranscriptEvent, TranscriptMode } from "./transcript-mode.ts";

const anchor = { key: "prompt:p", element: undefined, top: 40 };

const opening: TranscriptMode = { kind: "following", opening: true };

const following: TranscriptMode = { kind: "following", opening: false };

const reading: TranscriptMode = { kind: "reading", anchor: null };

const held: TranscriptMode = { kind: "reading", anchor };

test("a session left at the end opens following it, and one left elsewhere reopens at its row", () => {
  expect(initialMode({ kind: "end" })).toEqual(opening);
  expect(initialMode({ kind: "anchor", key: "prompt:p", offset: 40 })).toEqual(held);
});

test.each<[string, TranscriptMode, readonly TranscriptEvent[], TranscriptMode]>([
  ["sending or scroll-to-bottom follows from a hold", held, [{ kind: "ended" }], following],
  [
    "the reader scrolling to the end follows",
    reading,
    [{ kind: "scrolled", atEnd: true }],
    following,
  ],
  ["a wheel at the end follows", held, [{ kind: "released", atEnd: true }], following],
  [
    "a wheel up from the end reads",
    following,
    [
      { kind: "released", atEnd: true },
      { kind: "scrolled", atEnd: false },
    ],
    reading,
  ],
  ["expanding, editing or selecting holds its anchor", following, [{ kind: "held", anchor }], held],
  [
    "only the reader releases a hold",
    held,
    [{ kind: "scrolled", atEnd: true }, { kind: "opened" }],
    held,
  ],
  [
    "opening keeps following while rows measure",
    opening,
    [{ kind: "scrolled", atEnd: false }],
    opening,
  ],
  ["opening ends once it reaches the end", opening, [{ kind: "opened" }], following],
  ["the reader interrupts opening", opening, [{ kind: "released", atEnd: false }], reading],
])("%s", (_name, start, events, expected) => {
  expect(events.reduce(nextMode, start)).toEqual(expected);
});
