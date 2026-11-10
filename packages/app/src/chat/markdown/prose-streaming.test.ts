import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import { expect, test } from "vitest";
import { testRenderer } from "../../../test/renderer.ts";

const SETUP = `window.nyte = { clientSurface: "desktop", host: { setThemePreference() {} } };`;

const ENTRY = new URL("./prose-streaming.browser-test.tsx", import.meta.url);

const runs = new Map<"no-preference" | "reduce", Promise<string>>();

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
  fullText: Type.Number(),
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

function render(motion: "no-preference" | "reduce"): Promise<string> {
  const run = runs.get(motion) ?? testRenderer(ENTRY, SETUP, { motion });
  runs.set(motion, run);

  return run;
}

function expectPaced(burst: Static<typeof Burst>): void {
  expect(burst.steps.length).toBeGreaterThan(1);
  expect(burst.steps).toEqual([...new Set(burst.steps)].toSorted((left, right) => left - right));
  expect(burst.steps.at(-1)).toBe(burst.fullText);
}

test(
  "a streamed answer reveals whole words and fades only new text in the tail block",
  { timeout: 120_000 },
  async () => {
    const output = await render("no-preference");
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
    expect(report.stream.durations).toHaveLength(2);
    expect(report.stream.durations).toContain("0ms");
    expect(report.stream.fresh).toMatchObject({ animated: true, fill: "both" });
    expect(report.stream.fresh?.duration).not.toBe("0s");
    expect(report.stream.settled).toMatchObject({ animated: true, duration: "0s", fill: "both" });
    expect(report.stream.spansAtEnd).toEqual([9]);
    expect(report.stream.releaseMs).toBeGreaterThanOrEqual(120);
    expect(report.stream.releaseMs).toBeLessThan(260);
    expect(report.stream.settlingRenders).toBe(1);
    expect(report.stream.idleRenders).toBe(0);

    expectPaced(report.catchUp);
    expect(report.catchUp.spansAfterEnd).toBeGreaterThan(0);
    expect(report.catchUp.staleFades).toBe(0);
    expect(report.catchUp.replays).toBe(0);
    expect(report.catchUp.durations).toEqual(report.stream.durations);

    expectPaced(report.drain);
    expect(report.drain.fullTextMs).toBeLessThan(300);
    expect(report.drain.spansAfterEnd).toBeGreaterThan(0);
    expect(report.drain.staleFades).toBe(0);
    expect(report.drain.replays).toBe(0);

    expect(report.mount).toMatchObject({ firstFrameWhole: true, spanParagraphs: [9], fades: true });
    expect(report.mount.durations).toHaveLength(1);
    expect(report.mount.durations).not.toContain("0ms");

    expect(report.hidden.pacingBeforeHiding).toBe(true);
    expect(report.hidden.firstFrameWhole).toBe(true);
    expect(report.hidden.afterResume.fadingMax).toBeGreaterThan(0);
    expect(report.hidden.afterResume.staleFades).toBe(0);
    expect(report.hidden.afterResume.replays).toBe(0);
  },
);

test("reduced motion keeps the pacing and turns the fade off", { timeout: 240_000 }, async () => {
  const output = await render("reduce");
  expect(output.startsWith("{"), output).toBe(true);
  const report = Value.Parse(Reduced, JSON.parse(output));
  console.info(`prose streaming, reduced motion: ${JSON.stringify(report)}`);
  const paced = Value.Parse(Paced, JSON.parse(await render("no-preference")));

  expectPaced(report.catchUp);
  expectPaced(report.drain);
  expect(report.catchUp.steps).toEqual(paced.catchUp.steps);
  expect(report.drain.steps).toEqual(paced.drain.steps);
  expect(report.catchUp.fadingMax).toBe(0);
  expect(report.drain.fadingMax).toBe(0);
  expect(report.catchUp.fresh).toBeUndefined();
  expect(report.catchUp.spansAfterEnd).toBe(0);
  expect(report.drain.spansAfterEnd).toBe(0);
});
