/**
 * The window and the scrollport: only the tail mounts, revealing earlier
 * rows keeps the viewport where it was, `row` and `turn` jumps resolve
 * positions at call time, and leaving the bottom reports `scrolled(false)`.
 */
import { describe, expect, test } from "bun:test";
import type { App } from "../../../src/app/context.tsx";
import type { ScrollPort } from "../../../src/model/native.ts";
import type { State } from "../../../src/model/state.ts";
import { rowWeight } from "../../../src/model/transcript.ts";
import { revealEarlier, WINDOW } from "../../../src/model/window.ts";
import { Transcript } from "../../../src/ui/transcript/transcript.tsx";
import { stateOf } from "../../fixture/state.ts";
import { followed, viewOf } from "../../fixture/view.ts";
import { renderWithApp } from "./harness.tsx";
import type { TranscriptHarness } from "./harness.tsx";

const TURNS = 50;

const VIEW = viewOf((v) => {
  let built = v;

  for (let index = 1; index <= TURNS; index += 1)
    built = built.turn(`t${String(index)}`, (t) =>
      t
        .user(`question ${String(index)}`)
        .text(`answer ${String(index)}`)
        .ended("completed"),
    );

  return built;
});

interface Driver {
  readonly port: () => ScrollPort;
  readonly scrolled: boolean[];
  readonly reveals: () => number;
  /** What the reducer does for `reveal-earlier`, then the runner's `keep-viewport`. */
  readonly reveal: () => void;
  readonly node: (app: App) => ReturnType<typeof Transcript>;
}

function driver(
  initial: State,
  harness: () => Pick<TranscriptHarness, "screen" | "setState">,
): Driver {
  let port: ScrollPort | null = null;
  let state = initial;
  let reveals = 0;
  const scrolled: boolean[] = [];

  const reveal = (): void => {
    reveals += 1;
    const local = state.local.transcript;
    const { transcript } = harness().screen();

    const window = revealEarlier(
      transcript.rows,
      (row) => rowWeight(row, transcript.turns, local),
      transcript.window,
    );

    state = {
      ...state,
      local: { ...state.local, transcript: { ...local, following: false, window } },
    };
    harness().setState(state);
    port?.keepViewport();
  };

  return {
    port: () => {
      if (port === null) throw new Error("port not attached");

      return port;
    },
    scrolled,
    reveals: () => reveals,
    reveal,
    node: (app) => (
      <Transcript
        model={() => app.screen().transcript}
        attach={(attached) => {
          port = attached;

          return () => {
            port = null;
          };
        }}
        onScrolled={(atBottom) => scrolled.push(atBottom)}
        onRevealEarlier={reveal}
        onLatest={() => undefined}
      />
    ),
  };
}

function lineOf(frame: string, text: string): number {
  return frame.split("\n").findIndex((line) => line.includes(text));
}

describe("scroll", () => {
  test("only the tail window mounts, with an earlier-rows line above it", async () => {
    const state = stateOf(followed(VIEW));
    const drive = driver(state, () => app);
    await using app = await renderWithApp(state, drive.node, { height: 20 });
    const hidden = TURNS - WINDOW.tail;

    expect(app.screen().transcript.window).toEqual({ start: hidden, hidden });
    expect(app.renderer.root.findDescendantById(`turn:t${String(hidden)}`)).toBeUndefined();
    expect(app.renderer.root.findDescendantById(`turn:t${String(hidden + 1)}`)).toBeDefined();
    expect(app.captureCharFrame()).toContain(`question ${String(TURNS)}`);
  });

  test("revealing earlier rows keeps the viewport still", async () => {
    const state = stateOf(followed(VIEW));
    const drive = driver(state, () => app);
    await using app = await renderWithApp(state, drive.node, { height: 20 });
    const first = `question ${String(TURNS - WINDOW.tail + 1)}`;

    drive.port().row(`turn:t${String(TURNS - WINDOW.tail + 1)}`);
    await app.renderOnce();
    await app.renderOnce();
    const before = app.captureCharFrame();
    const row = lineOf(before, first);

    expect(row).toBeGreaterThanOrEqual(0);
    expect(row).toBeLessThan(5);

    drive.reveal();
    await app.renderOnce();
    await app.renderOnce();
    const after = app.captureCharFrame();

    expect(app.screen().transcript.window.start).toBe(0);
    expect(lineOf(after, first)).toBe(row);
    expect(after).not.toContain("earlier · scroll up");
  });

  test("wheel up near the top asks for earlier rows", async () => {
    const state = stateOf(followed(VIEW));
    const drive = driver(state, () => app);
    await using app = await renderWithApp(state, drive.node, { height: 20 });

    drive.port().row(`turn:t${String(TURNS - WINDOW.tail + 1)}`);
    await app.renderOnce();
    await app.mockMouse.scroll(10, 5, "up");
    await app.renderOnce();

    expect(drive.reveals()).toBe(1);
  });

  test("leaving the bottom reports scrolled(false); latest reports scrolled(true)", async () => {
    const state = stateOf(followed(VIEW));
    const drive = driver(state, () => app);
    await using app = await renderWithApp(state, drive.node, { height: 20 });

    drive.port().page(-1);
    await app.renderOnce();
    await app.renderOnce();

    expect(drive.scrolled.at(-1)).toBe(false);
    expect(app.captureCharFrame()).not.toContain(`answer ${String(TURNS)}`);

    drive.port().latest();
    await app.renderOnce();
    await app.renderOnce();

    expect(drive.scrolled.at(-1)).toBe(true);
    expect(app.captureCharFrame()).toContain(`answer ${String(TURNS)}`);
  });

  test("by(lines) moves the viewport by whole rows", async () => {
    const state = stateOf(followed(VIEW));
    const drive = driver(state, () => app);
    await using app = await renderWithApp(state, drive.node, { height: 20 });

    drive.port().row("turn:t30");
    await app.renderOnce();
    await app.renderOnce();
    const before = lineOf(app.captureCharFrame(), "question 30");

    drive.port().by(-2);
    await app.renderOnce();
    await app.renderOnce();

    expect(lineOf(app.captureCharFrame(), "question 30")).toBe(before + 2);
    expect(drive.scrolled.at(-1)).toBe(false);
  });

  test("turn jumps go to the previous and next turn from the one at the top", async () => {
    const state = stateOf(followed(VIEW));
    const drive = driver(state, () => app);
    await using app = await renderWithApp(state, drive.node, { height: 20 });

    drive.port().row("turn:t30");
    await app.renderOnce();
    await app.renderOnce();

    expect(lineOf(app.captureCharFrame(), "question 30")).toBeLessThan(5);

    drive.port().turn(-1);
    await app.renderOnce();
    await app.renderOnce();

    expect(lineOf(app.captureCharFrame(), "question 29")).toBeLessThan(5);

    drive.port().turn(1);
    drive.port().turn(1);
    await app.renderOnce();
    await app.renderOnce();

    expect(lineOf(app.captureCharFrame(), "question 31")).toBeLessThan(5);
  });
});
