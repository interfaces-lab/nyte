import assert from "node:assert/strict";
import { describe, test } from "vitest";
import {
  activeStickyCandidate,
  initialTranscriptOffset,
  isBottomPinned,
  overscrollReserve,
  remainingOverscroll,
  shouldAdjustScrollForResize,
} from "./transcript-scroll.ts";

describe("activeStickyCandidate", () => {
  const candidates = [
    { start: 16, height: 300 },
    { start: 330, height: 500 },
    { start: 844, height: 900 },
  ];

  test("picks the last turn whose top has scrolled past the edge", () => {
    assert.equal(activeStickyCandidate(candidates, 0, false), undefined);
    assert.equal(activeStickyCandidate(candidates, 17, false), 0);
    assert.equal(activeStickyCandidate(candidates, 327, false), 0);
    assert.equal(activeStickyCandidate(candidates, 331, false), 1);
    assert.equal(activeStickyCandidate(candidates, 2000, false), 2);
  });

  test("counts a turn whose top sits within a couple of pixels of the edge", () => {
    assert.equal(activeStickyCandidate(candidates, 328, false), 1);
    assert.equal(activeStickyCandidate(candidates, 327.5, false), 0);
  });

  test("lifts the latest prompt early while pinned to the bottom", () => {
    // The last turn's top is 844; pinned readers get its height (900) as slack.
    assert.equal(activeStickyCandidate(candidates, 400, true), 2);
    assert.equal(activeStickyCandidate(candidates, 400, false), 1);
  });

  test("gives no slack to earlier turns while pinned", () => {
    const farLast = [...candidates.slice(0, 2), { start: 5000, height: 100 }];
    assert.equal(activeStickyCandidate(farLast, 100, true), 0);
    assert.equal(activeStickyCandidate(farLast, 0, true), undefined);
    assert.equal(activeStickyCandidate([], 500, true), undefined);
  });
});

describe("overscrollReserve", () => {
  test("fills the viewport around the prompt, dock, and paddings", () => {
    assert.equal(
      overscrollReserve({ viewportHeight: 800, rowHeight: 76, dockHeight: 120 }),
      800 - 76 - 120 - 16 - 8,
    );
  });

  test("never goes negative for a prompt taller than the viewport", () => {
    assert.equal(overscrollReserve({ viewportHeight: 400, rowHeight: 600, dockHeight: 120 }), 0);
  });
});

describe("remainingOverscroll", () => {
  test("shrinks one pixel per pixel of reply growth", () => {
    assert.equal(remainingOverscroll({ initial: 500, baseline: 1000, content: 1000 }), 500);
    assert.equal(remainingOverscroll({ initial: 500, baseline: 1000, content: 1200 }), 300);
  });

  test("bottoms out at zero once the reply fills the viewport", () => {
    assert.equal(remainingOverscroll({ initial: 500, baseline: 1000, content: 1500 }), 0);
    assert.equal(remainingOverscroll({ initial: 500, baseline: 1000, content: 4000 }), 0);
  });

  test("does not grow past the reservation when content shrinks", () => {
    assert.equal(remainingOverscroll({ initial: 500, baseline: 1000, content: 900 }), 500);
  });
});

describe("isBottomPinned", () => {
  test("treats the last 60px as pinned", () => {
    assert.equal(isBottomPinned({ scrollHeight: 1000, scrollTop: 400, clientHeight: 541 }), true);
    assert.equal(isBottomPinned({ scrollHeight: 1000, scrollTop: 400, clientHeight: 540 }), false);
  });
});

describe("shouldAdjustScrollForResize", () => {
  test("corrects a first estimate for any row starting above the fold", () => {
    assert.equal(
      shouldAdjustScrollForResize({
        start: 100,
        end: 700,
        firstMeasure: true,
        scrollTop: 500,
        scrollingBackward: false,
      }),
      true,
    );
    assert.equal(
      shouldAdjustScrollForResize({
        start: 600,
        end: 700,
        firstMeasure: true,
        scrollTop: 500,
        scrollingBackward: false,
      }),
      false,
    );
  });

  test("leaves a row spanning the fold alone when it grows again", () => {
    assert.equal(
      shouldAdjustScrollForResize({
        start: 100,
        end: 700,
        firstMeasure: false,
        scrollTop: 500,
        scrollingBackward: false,
      }),
      false,
    );
    assert.equal(
      shouldAdjustScrollForResize({
        start: 100,
        end: 400,
        firstMeasure: false,
        scrollTop: 500,
        scrollingBackward: false,
      }),
      true,
    );
  });

  test("skips corrections while scrolling up", () => {
    assert.equal(
      shouldAdjustScrollForResize({
        start: 100,
        end: 400,
        firstMeasure: false,
        scrollTop: 500,
        scrollingBackward: true,
      }),
      false,
    );
  });
});

describe("initialTranscriptOffset", () => {
  const layout = { paddingStart: 16, paddingEnd: 8, viewportHeight: 500 };

  test("a reader away from the bottom resumes at their offset", () => {
    assert.equal(
      initialTranscriptOffset({
        ...layout,
        sizes: [100, 900, 300],
        scroll: { top: 420, bottomPinned: false },
      }),
      420,
    );
  });

  test("a pinned reader starts one viewport above the end of the content", () => {
    assert.equal(
      initialTranscriptOffset({
        ...layout,
        sizes: [100, 900, 300],
        scroll: { top: 0, bottomPinned: true },
      }),
      1324 - 500,
    );
  });

  test("content shorter than the viewport starts at the top", () => {
    assert.equal(
      initialTranscriptOffset({
        ...layout,
        sizes: [100],
        scroll: { top: 0, bottomPinned: true },
      }),
      0,
    );
  });
});
