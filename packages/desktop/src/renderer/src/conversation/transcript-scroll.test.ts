import assert from "node:assert/strict";
import { describe, test } from "vitest";
import {
  activeStickyCandidate,
  initialTranscriptOffset,
  isBottomPinned,
  transcriptPaddingEnd,
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

describe("transcriptPaddingEnd", () => {
  test("keeps a fifth of the scrollport as slack, within its bounds", () => {
    assert.equal(transcriptPaddingEnd(800), 8 + 160);
    assert.equal(transcriptPaddingEnd(300), 8 + 80);
    assert.equal(transcriptPaddingEnd(2000), 8 + 240);
  });

  test("keeps the padding alone before the scrollport has a height", () => {
    assert.equal(transcriptPaddingEnd(0), 8);
  });
});

describe("isBottomPinned", () => {
  test("treats the last 60px as pinned", () => {
    assert.equal(isBottomPinned({ scrollHeight: 1000, scrollTop: 400, clientHeight: 541 }), true);
    assert.equal(isBottomPinned({ scrollHeight: 1000, scrollTop: 400, clientHeight: 540 }), false);
  });
});

describe("initialTranscriptOffset", () => {
  const layout = { viewportHeight: 500 };
  // 16 top, 8 bottom, and the 100px of slack a 500px scrollport carries.
  const padding = 16 + transcriptPaddingEnd(500);

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
      1300 + padding - 500,
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
