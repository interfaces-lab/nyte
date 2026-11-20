import { expect, test } from "vitest";
import {
  adjustsOnResize,
  IDLE_HISTORY,
  initialMode,
  nextHistory,
  nextMode,
  NO_INPUT,
  sampleScroll,
  settleScroll,
  steeringUp,
  touching,
  wroteScroll,
} from "./transcript-mode.ts";
import type {
  HistoryEvent,
  HistoryStep,
  SettleAction,
  SettleMeasure,
  TranscriptEvent,
  TranscriptMode,
  TranscriptScroll,
} from "./transcript-mode.ts";

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

const quiet: TranscriptScroll = {
  mode: following,
  input: NO_INPUT,
  last: { offset: 500, height: 2_000 },
  written: null,
};

function sample(offset: number, height = 2_000, frameInput = false) {
  return { offset, height, clientHeight: 600, frameInput, now: 10_000 };
}

test.each<[string, TranscriptScroll, ReturnType<typeof sample>, TranscriptMode, boolean]>([
  [
    "rule 5: the transcript's own write lands within 1.5 px and keeps the hold while a frame has input",
    { ...quiet, mode: held, written: 401 },
    sample(400, 2_000, true),
    held,
    false,
  ],
  [
    "rule 5: a write 2 px off its target while a frame has input is the reader's",
    { ...quiet, mode: held, written: 402 },
    sample(400, 2_000, true),
    reading,
    true,
  ],
  [
    "rule 5: a foreign scroll up while a frame has input is the reader's",
    quiet,
    sample(498, 2_000, true),
    reading,
    true,
  ],
  [
    "rule 4: a foreign scroll down while a frame has input drops the anchor, and reaching the end follows",
    { ...quiet, mode: held },
    sample(1_400, 2_000, true),
    following,
    true,
  ],
  [
    "rule 5: content shrinking under the view while a frame has input is never the reader's",
    quiet,
    sample(300, 1_500, true),
    following,
    false,
  ],
  [
    "rule 5: content shrinking under a held view keeps the hold",
    { ...quiet, mode: held },
    sample(300, 1_500, true),
    held,
    false,
  ],
  [
    "rule 5: a foreign scroll up with no frame input releases only past 4 px",
    quiet,
    sample(497),
    reading,
    false,
  ],
  [
    "rule 5: dragging the scrollbar up leaves the end even within 4 px",
    { ...quiet, input: { ...NO_INPUT, pressed: true }, last: { offset: 1_400, height: 2_000 } },
    sample(1_398),
    reading,
    false,
  ],
])("%s", (_name, start, scroll, mode, cancel) => {
  const sampled = sampleScroll(start, scroll);

  expect([sampled.state.mode, sampled.cancel, sampled.state.written]).toEqual([mode, cancel, null]);
  expect(sampled.state.last).toEqual({ offset: scroll.offset, height: scroll.height });
});

test("a write is remembered where the view can go, so a write past the end reads as the transcript's own", () => {
  const wrote = wroteScroll(quiet, 2_400, 1_400);

  expect([wrote.written, wroteScroll(quiet, -20, 1_400).written]).toEqual([1_400, 0]);
  expect(sampleScroll(wrote, sample(1_400, 2_000, true)).cancel).toBe(false);
});

function measure(
  distance: number,
  anchor: SettleMeasure["anchor"] = null,
  now = 10_000,
): SettleMeasure {
  return { now, distance, ready: true, anchor };
}

test.each<[string, TranscriptScroll, SettleMeasure, TranscriptMode, SettleAction]>([
  [
    "rules 1-4: following beyond 1 px goes back to the end",
    quiet,
    measure(2),
    following,
    { kind: "end" },
  ],
  ["rules 1-4: following within 1 px stays", quiet, measure(1), following, { kind: "none" }],
  [
    "rule 5: following while the reader steers up doesn't pull back",
    { ...quiet, input: { at: 9_900, upward: true, pressed: false } },
    measure(300),
    following,
    { kind: "none" },
  ],
  [
    "rule 1: opening ends once ready at the end",
    { ...quiet, mode: opening },
    measure(0),
    following,
    { kind: "none" },
  ],
  [
    "rule 1: opening before the rows are ready keeps opening",
    { ...quiet, mode: opening },
    { ...measure(0), ready: false },
    opening,
    { kind: "none" },
  ],
  [
    "rule 4: a quiet view within 4 px follows and goes to the end",
    { ...quiet, mode: reading },
    measure(3),
    following,
    { kind: "end" },
  ],
  [
    "rule 4: the reader's input keeps Reading near the end",
    { ...quiet, mode: reading, input: { at: 9_900, upward: false, pressed: false } },
    measure(3),
    reading,
    { kind: "none" },
  ],
  [
    "rule 10: an anchor drifting 0.6 px is moved back",
    { ...quiet, mode: held },
    measure(900, { connected: true, rowTop: 10, elementTop: 40.6 }),
    held,
    { kind: "offset", by: expect.closeTo(0.6) },
  ],
  [
    "rule 10: an anchor drifting 0.4 px is rounding",
    { ...quiet, mode: held },
    measure(900, { connected: true, rowTop: 10, elementTop: 39.6 }),
    held,
    { kind: "none" },
  ],
  [
    "rule 20: a restored anchor without an element holds by its row",
    { ...quiet, mode: held },
    measure(900, { connected: true, rowTop: 30, elementTop: undefined }),
    held,
    { kind: "offset", by: -10 },
  ],
  [
    "rule 19: an anchor element that left the DOM is held by its row where the row is now",
    { ...quiet, mode: held },
    measure(900, { connected: false, rowTop: 25, elementTop: undefined }),
    { kind: "reading", anchor: { ...anchor, top: 25 } },
    { kind: "none" },
  ],
  [
    "rule 12: an anchor row outside the rendered window waits",
    { ...quiet, mode: held },
    measure(900, { connected: true, rowTop: undefined, elementTop: undefined }),
    held,
    { kind: "none" },
  ],
])("%s", (_name, start, settle, mode, action) => {
  const settled = settleScroll(start, settle);

  expect([settled.state.mode, settled.action]).toEqual([mode, action]);
});

test.each<[string, TranscriptMode, boolean, number, number, boolean]>([
  ["a measured row ending above the fold moves the view", following, true, 100, 400, true],
  ["a measured row spanning the fold doesn't", following, true, 300, 600, false],
  ["an unmeasured row starting above the fold does", reading, false, 300, 600, true],
  ["rules 10-11: a held anchor compensates itself", held, true, 100, 400, false],
])("adjustsOnResize: %s", (_name, mode, measured, start, end, adjusts) => {
  expect(adjustsOnResize(mode, { start, end, measured }, 400)).toBe(adjusts);
});

const at = (now: number, top = "prompt:a", older = false) =>
  ({ kind: "present", nearTop: true, opening: false, now, top, older }) as const;

const near = at(0);

const clipped = at(0, "prompt:a", true);

const empty = { kind: "loaded", count: 0 } as const;

const page = { kind: "loaded", count: 40 } as const;

const failed = (now: number) => ({ kind: "failed", now }) as const;

const asked = { kind: "asked", top: "prompt:a", older: true } as const;

test.each<
  [
    string,
    readonly HistoryEvent[],
    { readonly loads: number; readonly loading: boolean; readonly stalled: boolean },
    HistoryStep["action"],
  ]
>([
  [
    "rule 27: near the top a page loads",
    [near],
    { loads: 1, loading: true, stalled: false },
    "load",
  ],
  [
    "rule 27: one page at a time",
    [near, near],
    { loads: 1, loading: true, stalled: false },
    "none",
  ],
  [
    "rule 27: further down nothing loads",
    [{ ...near, nearTop: false }],
    { loads: 0, loading: false, stalled: false },
    "none",
  ],
  [
    "rule 27: a session opening at the end loads nothing until it settles",
    [{ ...near, opening: true }],
    { loads: 0, loading: false, stalled: false },
    "none",
  ],
  [
    "rule 27: a page that came keeps pages coming on the next frame",
    [near, page],
    { loads: 1, loading: false, stalled: false },
    "next-frame",
  ],
  [
    "rule 27: a head with nothing older is asked once, not on every scroll at the top",
    [near, empty, at(10), at(20), at(30)],
    { loads: 1, loading: false, stalled: false },
    "none",
  ],
  [
    "rule 27: once the top row changes, an exhausted head is asked again",
    [near, empty, at(10, "prompt:b")],
    { loads: 2, loading: true, stalled: false },
    "load",
  ],
  [
    "rule 27: an empty page while older messages show is asked again on the next frame",
    [clipped, empty],
    { loads: 1, loading: false, stalled: false },
    "next-frame",
  ],
  [
    "three empty pages in a row while older messages show bring the button back",
    [clipped, empty, clipped, empty, clipped, empty, clipped, clipped],
    { loads: 3, loading: false, stalled: true },
    "none",
  ],
  [
    "a click on the stalled button asks again",
    [clipped, empty, clipped, empty, clipped, empty, asked],
    { loads: 4, loading: true, stalled: false },
    "load",
  ],
  [
    "a page that came after empty ones starts the count again",
    [clipped, empty, clipped, empty, clipped, page, clipped, empty, clipped, empty],
    { loads: 5, loading: false, stalled: false },
    "next-frame",
  ],
  [
    "a failed page shows the button",
    [near, failed(0)],
    { loads: 1, loading: false, stalled: true },
    "none",
  ],
  [
    "after a failure a present waits a second before asking again",
    [near, failed(0), at(10), at(500), at(999)],
    { loads: 1, loading: false, stalled: true },
    "none",
  ],
  [
    "after the wait a present asks again, keeping the button",
    [near, failed(0), at(1_000)],
    { loads: 2, loading: true, stalled: true },
    "load",
  ],
  [
    "each failure in a row doubles the wait",
    [near, failed(0), at(1_000), failed(1_000), at(2_999), at(3_000)],
    { loads: 3, loading: true, stalled: true },
    "load",
  ],
  [
    "the wait stops doubling at 30 s",
    [
      ...[0, 1, 2, 3, 4, 5].flatMap((index) => [at(index * 40_000), failed(index * 40_000)]),
      at(5 * 40_000 + 30_000),
    ],
    { loads: 7, loading: true, stalled: true },
    "load",
  ],
  [
    "a click after a failure asks at once and hides the button",
    [near, failed(0), asked],
    { loads: 2, loading: true, stalled: false },
    "load",
  ],
  [
    "a click while a page loads waits for it",
    [near, asked],
    { loads: 1, loading: true, stalled: false },
    "none",
  ],
])("history: %s", (_name, events, expected, action) => {
  const steps: HistoryStep[] = [];

  for (const event of events) steps.push(nextHistory(steps.at(-1)?.pager ?? IDLE_HISTORY, event));

  const last = steps.at(-1);

  expect([
    {
      loads: steps.filter((step) => step.action === "load").length,
      loading: last?.pager.loading,
      stalled: last?.pager.stalled,
    },
    last?.action,
  ]).toEqual([expected, action]);
});
