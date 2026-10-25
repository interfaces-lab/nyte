import { Type } from "typebox";
import { Value } from "typebox/value";
import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

const SETUP = `window.nyte = { clientSurface: "desktop", host: { setThemePreference() {} } };`;

const ENTRY = new URL("./prose-streaming.browser-test.tsx", import.meta.url);

const CATCH_UP_STEPS = [
  62, 120, 173, 219, 259, 295, 327, 352, 371, 395, 413, 434, 456, 475, 498, 521, 545, 557,
];

const DRAIN_STEPS = [62, 126, 196, 266, 335, 405, 481, 557];

const Style = Type.Object({
  animated: Type.Boolean(),
  duration: Type.String(),
  timing: Type.String(),
  fill: Type.String(),
});

const Fades = {
  staleFades: Type.Number(),
  replays: Type.Number(),
  oldestFadeMs: Type.Number(),
  fadingMax: Type.Number(),
  spanParagraphsMax: Type.Number(),
  codeTextFades: Type.Boolean(),
  fadesAroundCode: Type.Number(),
  durations: Type.Array(Type.String()),
  fresh: Type.Optional(Style),
  settled: Type.Optional(Style),
};

const Burst = Type.Object({
  steps: Type.Array(Type.Number()),
  fullTextMs: Type.Number(),
  spansAfterEnd: Type.Number(),
  ...Fades,
});

const Paced = Type.Object({
  blocks: Type.Number(),
  staticSpans: Type.Number(),
  stream: Type.Object({
    deltas: Type.Number(),
    completed: Type.Boolean(),
    offWordFrames: Type.Number(),
    markdownRenders: Type.Number(),
    spansAtEnd: Type.Array(Type.Number()),
    releaseMs: Type.Number(),
    settlingRenders: Type.Number(),
    idleRenders: Type.Number(),
    ...Fades,
  }),
  catchUp: Burst,
  drain: Burst,
  mount: Type.Object({
    firstFrameWhole: Type.Boolean(),
    spanParagraphs: Type.Array(Type.Number()),
    durations: Type.Array(Type.String()),
    fades: Type.Boolean(),
  }),
  hidden: Type.Object({
    pacingBeforeHiding: Type.Boolean(),
    firstFrameWhole: Type.Boolean(),
    afterResume: Type.Object(Fades),
  }),
});

const Reduced = Type.Object({ reduced: Type.Literal(true), catchUp: Burst, drain: Burst });

test(
  "a streamed answer paces like Cursor's coalescer and fades only new text in the tail block",
  { timeout: 120_000 },
  async () => {
    const output = await testRenderer(ENTRY, SETUP, { motion: "no-preference" });
    expect(output.startsWith("{"), output).toBe(true);
    const report = Value.Parse(Paced, JSON.parse(output));
    console.info(`prose streaming: ${JSON.stringify(report)}`);

    expect(report.blocks).toBe(10);
    expect(report.staticSpans).toBe(0);

    expect(report.stream.completed).toBe(true);
    expect(report.stream.offWordFrames).toBe(0);
    expect(report.stream.markdownRenders).toBeLessThanOrEqual(
      report.stream.deltas + 2 * report.blocks,
    );
    expect(report.stream.staleFades).toBe(0);
    expect(report.stream.replays).toBe(0);
    expect(report.stream.oldestFadeMs).toBeLessThan(200);
    expect(report.stream.spanParagraphsMax).toBe(2);
    expect(report.stream.codeTextFades).toBe(true);
    expect(report.stream.fadesAroundCode).toBe(0);
    expect(report.stream.durations).toEqual(["0ms", "150ms"]);
    expect(report.stream.fresh).toEqual({
      animated: true,
      duration: "0.15s",
      timing: "linear",
      fill: "both",
    });
    expect(report.stream.settled).toEqual({
      animated: true,
      duration: "0s",
      timing: "linear",
      fill: "both",
    });
    expect(report.stream.spansAtEnd).toEqual([9]);
    expect(report.stream.releaseMs).toBeGreaterThanOrEqual(120);
    expect(report.stream.releaseMs).toBeLessThan(260);
    expect(report.stream.settlingRenders).toBe(1);
    expect(report.stream.idleRenders).toBe(0);

    expect(report.catchUp.steps).toEqual(CATCH_UP_STEPS);
    expect(report.catchUp.spansAfterEnd).toBeGreaterThan(0);
    expect(report.catchUp.staleFades).toBe(0);
    expect(report.catchUp.replays).toBe(0);
    expect(report.catchUp.durations).toEqual(["0ms", "150ms"]);

    expect(report.drain.steps).toEqual(DRAIN_STEPS);
    expect(report.drain.fullTextMs).toBeLessThan(300);
    expect(report.drain.spansAfterEnd).toBeGreaterThan(0);
    expect(report.drain.staleFades).toBe(0);
    expect(report.drain.replays).toBe(0);

    expect(report.mount).toEqual({
      firstFrameWhole: true,
      spanParagraphs: [9],
      durations: ["150ms"],
      fades: true,
    });

    expect(report.hidden.pacingBeforeHiding).toBe(true);
    expect(report.hidden.firstFrameWhole).toBe(true);
    expect(report.hidden.afterResume.fadingMax).toBeGreaterThan(0);
    expect(report.hidden.afterResume.staleFades).toBe(0);
    expect(report.hidden.afterResume.replays).toBe(0);
  },
);

test("reduced motion keeps the pacing and turns the fade off", { timeout: 120_000 }, async () => {
  const output = await testRenderer(ENTRY, SETUP, { motion: "reduce" });
  expect(output.startsWith("{"), output).toBe(true);
  const report = Value.Parse(Reduced, JSON.parse(output));
  console.info(`prose streaming, reduced motion: ${JSON.stringify(report)}`);

  expect(report.catchUp.steps).toEqual(CATCH_UP_STEPS);
  expect(report.drain.steps).toEqual(DRAIN_STEPS);
  expect(report.catchUp.fadingMax).toBe(0);
  expect(report.drain.fadingMax).toBe(0);
  expect(report.catchUp.fresh).toEqual({
    animated: false,
    duration: "0.15s",
    timing: "linear",
    fill: "both",
  });
  expect(report.catchUp.spansAfterEnd).toBe(0);
  expect(report.drain.spansAfterEnd).toBe(0);
});
