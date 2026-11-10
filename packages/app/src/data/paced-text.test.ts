import { describe, expect, test } from "vitest";
import {
  chunkLength,
  drainPace,
  extendPace,
  flushPace,
  framePace,
  settledPace,
} from "./paced-text.ts";
import type { Pace } from "./paced-text.ts";

const FRAME = 17;

function play(from: Pace, start = 0): number[] {
  const shown: number[] = [];
  let pace = from;

  for (let frame = 1; pace.shown < pace.text.length && frame <= 60; frame += 1) {
    pace = framePace(pace, start + frame * FRAME);
    shown.push(pace.shown);
  }

  return shown;
}

const BURST = "lorem ipsum ".repeat(30);

describe("framePace", () => {
  test("a backlog of 24 characters or fewer shows whole on the next frame", () => {
    expect(play(extendPace(settledPace("Hello"), "Hello, small delta.", 0))).toEqual([19]);
  });

  test("a backlog reveals max(24, ceil(pending / 8)) characters a frame, cut after whitespace", () => {
    expect(play(extendPace(settledPace(""), BURST, 0))).toEqual([
      42, 78, 114, 144, 168, 192, 216, 240, 264, 288, 312, 336, 360,
    ]);
  });

  test("a frame less than 12 ms after the last flush reveals nothing", () => {
    const first = framePace(extendPace(settledPace(""), BURST, 0), 100);

    expect(first.shown).toBe(42);
    expect(framePace(first, 111)).toBe(first);
    expect(framePace(first, 112).shown).toBe(78);
  });

  test("text arriving mid catch-up keeps the eight-frame divisor instead of counting down", () => {
    const early = [1, 2, 3].reduce(
      (pace, frame) => framePace(pace, frame * FRAME),
      extendPace(settledPace(""), BURST, 0),
    );

    expect(early.shown).toBe(114);
    expect(
      play(extendPace(early, `${BURST}${"dolor sit ".repeat(24)}`, 3 * FRAME), 3 * FRAME),
    ).toEqual([
      174, 228, 270, 312, 348, 380, 406, 430, 450, 470, 490, 510, 530, 550, 570, 590, 600,
    ]);
  });
});

describe("drainPace", () => {
  test("once streaming ends, the backlog counts down from eight frames", () => {
    const backlog = extendPace(settledPace(""), "lorem ipsum ".repeat(100), 0);

    expect(play(drainPace(backlog, 0))).toEqual([150, 300, 450, 600, 750, 900, 1050, 1200]);
  });

  test("a backlog of 24 characters or fewer shows at once", () => {
    expect(drainPace(extendPace(settledPace("Hello"), "Hello, small delta.", 0), 5)).toEqual({
      text: "Hello, small delta.",
      shown: 19,
      flushedAt: 5,
      drainFrames: undefined,
    });
  });
});

describe("flushPace", () => {
  test("shows the whole backlog and ends the drain", () => {
    const draining = drainPace(extendPace(settledPace(""), BURST, 0), 0);

    expect(draining.drainFrames).toBe(8);
    expect(flushPace(draining, 250)).toEqual({
      text: BURST,
      shown: 360,
      flushedAt: 250,
      drainFrames: undefined,
    });
  });
});

describe("extendPace", () => {
  test("text that no longer extends what was shown appears at once", () => {
    const shown = framePace(extendPace(settledPace(""), BURST, 0), 100);

    expect(extendPace(shown, "A different answer.", 1_000)).toEqual({
      text: "A different answer.",
      shown: 19,
      flushedAt: 1_000,
      drainFrames: undefined,
    });
  });
});

describe("chunkLength", () => {
  test.each([
    {
      name: "cuts after the last whitespace inside the budget",
      text: "The pacer reveals whole words only.",
      budget: 22,
      expected: 18,
    },
    {
      name: "cuts a long token at a word boundary",
      text: "https://example.com/some/really/long/path",
      budget: 26,
      expected: 25,
    },
    { name: "never splits an emoji cluster", text: "👩‍👩‍👧‍👦".repeat(5), budget: 24, expected: 22 },
    {
      name: "never splits a letter from its combining mark",
      text: "e\u0301".repeat(30),
      budget: 25,
      expected: 24,
    },
  ])("$name", (row) => {
    expect(chunkLength(row.text, row.budget)).toBe(row.expected);
  });
});
