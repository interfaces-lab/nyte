import { showsText } from "@nyte-ai/plugin/client/presentation";
import type { Message } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { describe, expect, test } from "vitest";
import {
  chunkLength,
  drainPace,
  extendPace,
  flushPace,
  framePace,
  presentReveal,
  receiveReveal,
  revealTimers,
  settledPace,
  tickReveal,
} from "./paced-text.ts";
import type { Pace, Reveal } from "./paced-text.ts";

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

function text(id: string, markdown: string, live: boolean): Message {
  return {
    id: asId<"message">(id),
    turn: asId<"turn">("turn"),
    at: 1,
    kind: "part",
    part: asId<"part">(id),
    partKind: "text",
    role: "answer",
    state: { markdown, signature: null },
    version: 1,
    status: live
      ? { kind: "live", run: asId<"run">("run") }
      : { kind: "settled", commit: asId<"commit">(id), endedAt: 1 },
  };
}

const LONG = "lorem ipsum ".repeat(30);

describe("receiveReveal", () => {
  test.each<{
    readonly name: string;
    readonly steps: readonly { readonly messages: readonly Message[]; readonly showing: boolean }[];
    readonly expected: {
      readonly shown: readonly (readonly [string, number, string])[];
      readonly frame: boolean;
      readonly deadline: boolean;
      readonly same: boolean;
    };
  }>([
    {
      name: "the first view shows the whole text",
      steps: [{ messages: [text("a", LONG, true)], showing: true }],
      expected: { shown: [["a", 360, "live"]], frame: false, deadline: false, same: true },
    },
    {
      name: "a new live text while showing reveals from nothing",
      steps: [
        { messages: [], showing: true },
        { messages: [text("a", LONG, true)], showing: true },
      ],
      expected: { shown: [["a", 0, "live"]], frame: true, deadline: false, same: false },
    },
    {
      name: "the same message still live extends what was shown",
      steps: [
        { messages: [text("a", "lorem ", true)], showing: true },
        { messages: [text("a", LONG, true)], showing: true },
      ],
      expected: { shown: [["a", 6, "live"]], frame: true, deadline: false, same: false },
    },
    {
      name: "the same message ended drains and still reads as live",
      steps: [
        { messages: [text("a", "lorem ", true)], showing: true },
        { messages: [text("a", LONG, false)], showing: true },
      ],
      expected: { shown: [["a", 6, "live"]], frame: true, deadline: true, same: false },
    },
    {
      name: "a message ending within one frame's budget settles at once",
      steps: [
        { messages: [text("a", "lorem ", true)], showing: true },
        { messages: [text("a", "lorem ipsum", false)], showing: true },
      ],
      expected: { shown: [["a", 11, "settled"]], frame: false, deadline: false, same: true },
    },
    {
      name: "a hidden transcript shows the whole text",
      steps: [
        { messages: [text("a", "lorem ", true)], showing: true },
        { messages: [text("a", LONG, true)], showing: false },
      ],
      expected: { shown: [["a", 360, "live"]], frame: false, deadline: false, same: true },
    },
    {
      name: "a new live text while hidden opens whole",
      steps: [
        { messages: [], showing: true },
        { messages: [text("a", LONG, true)], showing: false },
      ],
      expected: { shown: [["a", 360, "live"]], frame: false, deadline: false, same: true },
    },
    {
      name: "a newer live text waits, empty, while the older one drains at its pace",
      steps: [
        { messages: [text("a", "lorem ", true)], showing: true },
        { messages: [text("a", LONG, true), text("b", LONG, true)], showing: true },
      ],
      expected: {
        shown: [
          ["a", 6, "live"],
          ["b", 0, "live"],
        ],
        frame: true,
        deadline: true,
        same: false,
      },
    },
    {
      name: "a newer live text after the older one has all shown takes over from nothing",
      steps: [
        { messages: [text("a", "lorem ", true)], showing: true },
        { messages: [text("a", "lorem ", false), text("b", LONG, true)], showing: true },
      ],
      expected: {
        shown: [
          ["a", 6, "settled"],
          ["b", 0, "live"],
        ],
        frame: true,
        deadline: false,
        same: false,
      },
    },
    {
      name: "a newer live text while hidden shows both whole",
      steps: [
        { messages: [text("a", "lorem ", true)], showing: true },
        { messages: [text("a", LONG, false), text("b", LONG, true)], showing: false },
      ],
      expected: {
        shown: [
          ["a", 360, "settled"],
          ["b", 360, "live"],
        ],
        frame: false,
        deadline: false,
        same: true,
      },
    },
    {
      name: "text that no longer extends what was shown appears at once",
      steps: [
        { messages: [text("a", "lorem ", true)], showing: true },
        { messages: [text("a", LONG, true)], showing: true },
        { messages: [text("a", "Goodbye", true)], showing: true },
      ],
      expected: { shown: [["a", 7, "live"]], frame: false, deadline: false, same: true },
    },
    {
      name: "no live text leaves the view as it is",
      steps: [
        { messages: [], showing: true },
        { messages: [text("a", LONG, false)], showing: true },
      ],
      expected: { shown: [["a", 360, "settled"]], frame: false, deadline: false, same: true },
    },
  ])("$name", (row) => {
    const reveal = row.steps.reduce<Reveal | undefined>(
      (current, step, index) =>
        receiveReveal(current, step.messages, {
          showing: step.showing,
          opening: index === 0 || !step.showing,
          now: 0,
        }),
      undefined,
    );

    const view = { messages: row.steps.at(-1)?.messages ?? [] };
    const shown = presentReveal(view, reveal);

    expect({
      shown: shown.messages
        .filter(showsText)
        .map((message) => [message.id, message.state.markdown.length, message.status.kind]),
      ...revealTimers(reveal),
      same: shown === view,
    }).toEqual(row.expected);
  });
});

test("a reply that starts while the one before it drains shows only once that one has shown, then paces from nothing", () => {
  const before = text("a", LONG, false);
  const after = text("b", LONG, true);

  const opened = receiveReveal(undefined, [text("a", "lorem ", true)], {
    showing: true,
    opening: true,
    now: 0,
  });

  let reveal = receiveReveal(opened, [before, after], { showing: true, opening: false, now: 0 });
  const frames: string[] = [];

  for (let frame = 1; reveal !== undefined && frame <= 30; frame += 1) {
    reveal = tickReveal(reveal, { showing: true, now: frame * FRAME });
    const shown = presentReveal({ messages: [before, after] }, reveal).messages.filter(showsText);
    frames.push(shown.map((message) => message.state.markdown.length).join("/"));
  }

  expect(frames).toEqual([
    "48/0",
    "90/0",
    "132/0",
    "174/0",
    "216/0",
    "264/0",
    "312/0",
    "360/0",
    "360/42",
    "360/78",
    "360/114",
    "360/144",
    "360/168",
    "360/192",
    "360/216",
    "360/240",
    "360/264",
    "360/288",
    "360/312",
    "360/336",
    "360/360",
    "360/360",
    "360/360",
    "360/360",
    "360/360",
    "360/360",
    "360/360",
    "360/360",
    "360/360",
    "360/360",
  ]);
});
