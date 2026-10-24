import { describe, expect, test } from "vitest";
import { revealEnd, settledPace, stepPace } from "./paced-text.ts";
import type { Pace } from "./paced-text.ts";

const FRAME = 1000 / 60;

function play(from: Pace, text: string, start = 0, drainBy = Number.POSITIVE_INFINITY) {
  const shown: number[] = [];
  let pace = from;

  for (let frame = 0; pace.shown < text.length && frame < 60; frame += 1) {
    pace = stepPace(pace, text, start + frame * FRAME, drainBy);
    shown.push(pace.shown);
  }

  return { pace, shown };
}

describe("stepPace", () => {
  test("a delta of 24 characters or fewer shows whole on the next frame", () => {
    expect(play(settledPace("Hello"), "Hello, small delta.").shown).toEqual([19]);
  });

  test("a burst spreads over eight frames in max(24, pending / frames left) word chunks", () => {
    const burst = "lorem ipsum ".repeat(30);

    expect(play(settledPace(""), burst).shown).toEqual([42, 84, 126, 168, 216, 264, 312, 360]);
  });

  test("frames closer than 16 ms apart reveal nothing", () => {
    const text = "lorem ipsum ".repeat(30);
    const first = stepPace(settledPace(""), text, 100, Number.POSITIVE_INFINITY);

    expect(stepPace(first, text, 110, Number.POSITIVE_INFINITY)).toBe(first);
    expect(stepPace(first, text, 116, Number.POSITIVE_INFINITY).shown).toBe(84);
  });

  test("new text restarts the eight-frame window, so the whole text shows within eight frames of it", () => {
    const burst = "lorem ipsum ".repeat(30);
    const more = `${burst}${"dolor sit ".repeat(24)}`;

    const early = [0, 1, 2].reduce(
      (pace, frame) => stepPace(pace, burst, frame * FRAME, Number.POSITIVE_INFINITY),
      settledPace(""),
    );

    expect(early.shown).toBe(126);
    expect(play(early, more, 3 * FRAME).shown).toEqual([186, 246, 300, 360, 420, 480, 540, 600]);
  });

  test("once streaming ends, the backlog shows whole by the 250 ms drain deadline", () => {
    const text = "lorem ipsum ".repeat(100);
    const first = stepPace(settledPace(""), text, 0, 250);

    expect(first.shown).toBe(150);
    expect(stepPace(first, text, 249, 250).shown).toBe(300);
    expect(stepPace(first, text, 250, 250).shown).toBe(1200);
  });

  test("text that no longer extends what was shown appears at once", () => {
    const shown = play(settledPace(""), "lorem ipsum ".repeat(30)).pace;

    expect(stepPace(shown, "A different answer.", 1_000, Number.POSITIVE_INFINITY)).toEqual(
      settledPace("A different answer."),
    );
  });
});

describe("revealEnd", () => {
  test("cuts after the last whitespace inside the budget", () => {
    expect(revealEnd("The pacer reveals whole words only.", 0, 22)).toBe(18);
  });

  test("cuts a long token at a word boundary", () => {
    expect(revealEnd("https://example.com/some/really/long/path", 0, 26)).toBe(25);
  });

  test("never splits an emoji cluster", () => {
    expect(revealEnd("👩‍👩‍👧‍👦".repeat(5), 0, 24)).toBe(22);
  });

  test("never splits a letter from its combining mark", () => {
    expect(revealEnd("e\u0301".repeat(30), 0, 25)).toBe(24);
  });
});
