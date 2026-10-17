import { describe, expect, test } from "bun:test";
import type { App } from "../../../src/app/context.tsx";
import type { ScrollPort } from "../../../src/model/native.ts";
import type { State } from "../../../src/model/state.ts";
import { rowWeight } from "../../../src/model/transcript.ts";
import { revealEarlier, revealLater, WINDOW } from "../../../src/model/window.ts";
import { Transcript } from "../../../src/ui/transcript/transcript.tsx";
import { frameShowing } from "../../fixture/render.tsx";
import { buildState } from "../../fixture/state.ts";
import { followed, buildView } from "../../fixture/view.ts";
import { renderWithApp } from "./harness.tsx";
import type { TranscriptHarness } from "./harness.tsx";

const TURNS = 50;

const MOUNTED = WINDOW.tail / 2;

function conversation(turns: number) {
  return buildView((v) => {
    let built = v;

    for (let index = 1; index <= turns; index += 1)
      built = built.turn(`t${String(index)}`, (t) =>
        t
          .user(`question ${String(index)}`)
          .text(`answer ${String(index)}`)
          .ended("completed"),
      );

    return built;
  });
}

const VIEW = conversation(TURNS);

interface Driver {
  readonly port: () => ScrollPort;
  readonly scrolled: boolean[];
  readonly reveals: () => number;
  readonly reveal: () => void;
  readonly revealLater: () => void;
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

  const move = (direction: "earlier" | "later"): void => {
    reveals += 1;
    const local = state.local.transcript;
    const { transcript } = harness().screen();

    const window = (direction === "earlier" ? revealEarlier : revealLater)(
      transcript.rows,
      rowWeight,
      transcript.window,
    );

    state = {
      ...state,
      local: { ...state.local, transcript: { ...local, following: false, window } },
    };
    harness().setState(state);
    port?.keepViewport();
  };

  const reveal = (): void => move("earlier");
  const later = (): void => move("later");

  return {
    port: () => {
      if (port === null) throw new Error("port not attached");

      return port;
    },
    scrolled,
    reveals: () => reveals,
    reveal,
    revealLater: later,
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
        onRevealLater={later}
        onLatest={() => undefined}
      />
    ),
  };
}

function findLine(frame: string, text: string): number {
  return frame.split("\n").findIndex((line) => line.includes(text));
}

describe("scroll", () => {
  test("only the tail window mounts, with an earlier-rows line above it", async () => {
    const state = buildState(followed(VIEW));
    const drive = driver(state, () => app);
    await using app = await renderWithApp(state, drive.node, { height: 20 });
    const hidden = TURNS - MOUNTED;

    expect(app.screen().transcript.window).toEqual({ start: hidden, end: TURNS });
    expect(app.renderer.root.findDescendantById(`turn:t${String(hidden)}`)).toBeUndefined();
    expect(app.renderer.root.findDescendantById(`turn:t${String(hidden + 1)}`)).toBeDefined();
    expect(app.captureCharFrame()).toContain(`question ${String(TURNS)}`);
  });

  test("revealing earlier rows keeps the viewport still", async () => {
    const state = buildState(followed(VIEW));
    const drive = driver(state, () => app);
    await using app = await renderWithApp(state, drive.node, { height: 20 });
    const first = `question ${String(TURNS - MOUNTED + 1)}`;

    drive.port().row(`turn:t${String(TURNS - MOUNTED + 1)}`);
    await app.renderOnce();
    await app.renderOnce();
    const before = app.captureCharFrame();
    const row = findLine(before, first);

    expect(row).toBeGreaterThanOrEqual(0);
    expect(row).toBeLessThan(5);

    drive.reveal();
    await app.renderOnce();
    await app.renderOnce();
    const after = app.captureCharFrame();

    expect(app.screen().transcript.window.start).toBe(TURNS - MOUNTED - WINDOW.step / 2);
    expect(findLine(after, first)).toBe(row);
  });

  test("browsing far back unmounts the rows below, and revealing either way keeps the viewport still", async () => {
    const state = buildState(followed(conversation(150)));
    const drive = driver(state, () => app);
    await using app = await renderWithApp(state, drive.node, { height: 20 });

    const settled = async (): Promise<string> => {
      await app.renderOnce();
      await app.renderOnce();

      return app.captureCharFrame();
    };

    drive.reveal();
    await settled();
    drive.port().row("turn:t116");
    await settled();
    drive.reveal();
    await settled();
    drive.port().row("turn:t101");
    const top = findLine(await settled(), "question 101");

    drive.reveal();

    expect(findLine(await settled(), "question 101")).toBe(top);
    expect(app.screen().transcript.window).toEqual({ start: 85, end: 115 });
    expect(app.renderer.root.findDescendantById("turn:t150")).toBeUndefined();

    drive.port().row("turn:t110");
    const lower = findLine(await settled(), "question 110");
    drive.revealLater();

    expect(findLine(await settled(), "question 110")).toBe(lower);
    expect(app.screen().transcript.window).toEqual({ start: 100, end: 150 });
    expect(app.renderer.root.findDescendantById("turn:t86")).toBeUndefined();
  });

  test("wheel up near the top asks for earlier rows", async () => {
    const state = buildState(followed(VIEW));
    const drive = driver(state, () => app);
    await using app = await renderWithApp(state, drive.node, { height: 20 });

    drive.port().row(`turn:t${String(TURNS - MOUNTED + 1)}`);
    await app.renderOnce();
    await app.mockMouse.scroll(10, 5, "up");
    await app.renderOnce();

    expect(drive.reveals()).toBe(1);
  });

  test("leaving the bottom reports scrolled(false); latest reports scrolled(true)", async () => {
    const state = buildState(followed(VIEW));
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
    expect(await frameShowing(app, `answer ${String(TURNS)}`)).toContain(`answer ${String(TURNS)}`);
  });

  test("by(lines) moves the viewport by whole rows", async () => {
    const state = buildState(followed(VIEW));
    const drive = driver(state, () => app);
    await using app = await renderWithApp(state, drive.node, { height: 20 });

    drive.port().row("turn:t40");
    await app.renderOnce();
    await app.renderOnce();
    const before = findLine(app.captureCharFrame(), "question 40");

    drive.port().by(-2);
    await app.renderOnce();
    await app.renderOnce();

    expect(findLine(app.captureCharFrame(), "question 40")).toBe(before + 2);
    expect(drive.scrolled.at(-1)).toBe(false);
  });

  test("turn jumps go to the previous and next turn from the one at the top", async () => {
    const state = buildState(followed(VIEW));
    const drive = driver(state, () => app);
    await using app = await renderWithApp(state, drive.node, { height: 20 });

    drive.port().row("turn:t40");
    await app.renderOnce();
    await app.renderOnce();

    expect(findLine(app.captureCharFrame(), "question 40")).toBeLessThan(5);

    drive.port().turn(-1);
    await app.renderOnce();
    await app.renderOnce();

    expect(findLine(app.captureCharFrame(), "question 39")).toBeLessThan(5);

    drive.port().turn(1);
    drive.port().turn(1);
    await app.renderOnce();
    await app.renderOnce();

    expect(findLine(app.captureCharFrame(), "question 41")).toBeLessThan(5);
  });
});
