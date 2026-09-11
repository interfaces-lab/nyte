import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { followOnScroll, overflows, scrolledAway } from "./tool-group-follow.ts";

const atBottom = { scrollTop: 856, clientHeight: 144, scrollHeight: 1000 };
const nearBottom = { scrollTop: 853, clientHeight: 144, scrollHeight: 1000 };
const scrolledUp = { scrollTop: 400, clientHeight: 144, scrollHeight: 1000 };

describe("scrolledAway", () => {
  test("a few pixels short of the bottom still counts as at the bottom", () => {
    assert.equal(scrolledAway(atBottom), false);
    assert.equal(scrolledAway(nearBottom), false);
  });

  test("scrolling up counts as away", () => {
    assert.equal(scrolledAway(scrolledUp), true);
  });
});

describe("overflows", () => {
  test("only content taller than the window overflows", () => {
    assert.equal(overflows({ scrollTop: 0, clientHeight: 144, scrollHeight: 144 }), false);
    assert.equal(overflows({ scrollTop: 0, clientHeight: 144, scrollHeight: 145 }), true);
  });
});

describe("followOnScroll", () => {
  test("the preview pauses when the reader scrolls up and arms a resume", () => {
    assert.deepEqual(followOnScroll("preview", false, scrolledUp), {
      paused: true,
      resumeTimer: "arm",
    });
  });

  test("the preview follows again as soon as the reader returns to the bottom", () => {
    assert.deepEqual(followOnScroll("preview", true, atBottom), {
      paused: false,
      resumeTimer: "clear",
    });
  });

  test("the opened window only restarts its quiet-spell timer", () => {
    assert.deepEqual(followOnScroll("opened", false, scrolledUp), {
      paused: false,
      resumeTimer: "arm",
    });
    assert.deepEqual(followOnScroll("opened", true, atBottom), {
      paused: true,
      resumeTimer: "arm",
    });
  });
});
