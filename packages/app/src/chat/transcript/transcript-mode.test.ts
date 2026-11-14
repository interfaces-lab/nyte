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
  HistoryPager,
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

const loading: HistoryPager = { loading: true, failed: false };

const failed: HistoryPager = { loading: false, failed: true };

const near = { kind: "present", nearTop: true, opening: false } as const;

test.each<[string, HistoryPager, readonly HistoryEvent[], HistoryPager, HistoryStep["action"]]>([
  ["rule 27: near the top a page loads", IDLE_HISTORY, [near], loading, "load"],
  ["rule 27: one page at a time", loading, [near], loading, "none"],
  [
    "rule 27: further down nothing loads",
    IDLE_HISTORY,
    [{ ...near, nearTop: false }],
    IDLE_HISTORY,
    "none",
  ],
  [
    "rule 27: a session opening at the end loads nothing until it settles",
    IDLE_HISTORY,
    [{ ...near, opening: true }],
    IDLE_HISTORY,
    "none",
  ],
  [
    "rule 27: a page that came keeps pages coming on the next frame",
    loading,
    [{ kind: "loaded", count: 40 }],
    IDLE_HISTORY,
    "next-frame",
  ],
  [
    "rule 27: an empty page ends the run",
    loading,
    [{ kind: "loaded", count: 0 }],
    IDLE_HISTORY,
    "none",
  ],
  [
    "rule 27: two empty pages never strand what is older: the next present asks again",
    loading,
    [{ kind: "loaded", count: 0 }, near, { kind: "loaded", count: 0 }, near],
    loading,
    "load",
  ],
  ["a failed page marks the pager failed", loading, [{ kind: "failed" }], failed, "none"],
  ["a present after a failure tries again", failed, [near], { ...failed, loading: true }, "load"],
  [
    "asking after a failure loads at once and clears it",
    failed,
    [{ kind: "asked" }],
    loading,
    "load",
  ],
  ["asking while a page loads waits for it", loading, [{ kind: "asked" }], loading, "none"],
])("history: %s", (_name, start, events, pager, action) => {
  const step = events.reduce<HistoryStep>((last, event) => nextHistory(last.pager, event), {
    pager: start,
    action: "none",
  });

  expect([step.pager, step.action]).toEqual([pager, action]);
});
