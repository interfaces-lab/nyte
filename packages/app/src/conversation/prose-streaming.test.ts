import { Type } from "typebox";
import { Value } from "typebox/value";
import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

const SETUP = `window.nyte = { clientSurface: "desktop", host: { setThemePreference() {} } };`;

const ENTRY = new URL("./prose-streaming.browser-test.tsx", import.meta.url);

const Fades = {
  staleFades: Type.Number(),
  replays: Type.Number(),
  spansMax: Type.Number(),
  fadingMax: Type.Number(),
  oldestFadeMs: Type.Number(),
  emptyChips: Type.Number(),
  chipFades: Type.Number(),
};

const Paced = Type.Object({
  blocks: Type.Number(),
  deltas: Type.Number(),
  streamMs: Type.Number(),
  textChanges: Type.Number(),
  markdownRenders: Type.Number(),
  rendersPerDelta: Type.Number(),
  completed: Type.Boolean(),
  offWordFrames: Type.Number(),
  flushesAfterLastDelta: Type.Number(),
  lastDeltaToFullTextMs: Type.Number(),
  lastDeltaToStillMs: Type.Number(),
  tailSpans: Type.Number(),
  settledBlockSpans: Type.Number(),
  settlingRenders: Type.Number(),
  spansAfterSettling: Type.Number(),
  idleRenders: Type.Number(),
  ...Fades,
  burst: Type.Object({
    flushes: Type.Number(),
    endToFullTextMs: Type.Number(),
    steps: Type.Array(Type.Number()),
    overBudget: Type.Number(),
    offWord: Type.Number(),
    ...Fades,
  }),
  mount: Type.Object({
    firstFrameWhole: Type.Boolean(),
    fadingAtMount: Type.Number(),
    spansAtMount: Type.Number(),
    ...Fades,
  }),
  hidden: Type.Object({
    spansBeforeHiding: Type.Number(),
    firstFrameWhole: Type.Boolean(),
    fadingAfterResume: Type.Number(),
    afterResume: Type.Object(Fades),
    afterSettledResume: Type.Object(Fades),
  }),
});

const Reduced = Type.Object({
  reduced: Type.Literal(true),
  deltas: Type.Number(),
  lagging: Type.Number(),
  whole: Type.Boolean(),
  rendersPerDelta: Type.Number(),
  fadingMax: Type.Number(),
  spansMax: Type.Number(),
});

test(
  "a streamed answer reveals in paced word chunks and fades only the newest text",
  { timeout: 120_000 },
  async () => {
    const output = await testRenderer(ENTRY, SETUP, { motion: "no-preference" });
    expect(output.startsWith("{"), output).toBe(true);
    const report = Value.Parse(Paced, JSON.parse(output));
    console.info(`prose streaming: ${JSON.stringify(report)}`);

    expect(report.blocks).toBe(10);
    expect(report.completed).toBe(true);
    expect(report.markdownRenders).toBeLessThanOrEqual(report.deltas + 2 * report.blocks);
    expect(report.offWordFrames).toBe(0);
    expect(report.flushesAfterLastDelta).toBeLessThanOrEqual(8);
    expect(report.staleFades).toBe(0);
    expect(report.replays).toBe(0);
    expect(report.oldestFadeMs).toBeLessThan(200);
    expect(report.emptyChips).toBe(0);
    expect(report.chipFades).toBeGreaterThan(0);
    expect(report.settledBlockSpans).toBe(0);
    expect(report.spansAfterSettling).toBe(0);
    expect(report.idleRenders).toBe(0);

    expect(report.burst.flushes).toBeGreaterThan(1);
    expect(report.burst.flushes).toBeLessThanOrEqual(8);
    expect(report.burst.overBudget).toBe(0);
    expect(report.burst.offWord).toBe(0);
    expect(report.burst.endToFullTextMs).toBeLessThanOrEqual(250);
    expect(report.burst.staleFades).toBe(0);
    expect(report.burst.replays).toBe(0);

    expect(report.mount.firstFrameWhole).toBe(true);
    expect(report.mount.fadingAtMount).toBe(0);
    expect(report.mount.spansAtMount).toBe(0);
    expect(report.mount.staleFades).toBe(0);

    expect(report.hidden.spansBeforeHiding).toBeGreaterThan(0);
    expect(report.hidden.firstFrameWhole).toBe(true);
    expect(report.hidden.fadingAfterResume).toBe(0);
    expect(report.hidden.afterResume.fadingMax).toBeGreaterThan(0);
    expect(report.hidden.afterResume.staleFades).toBe(0);
    expect(report.hidden.afterResume.replays).toBe(0);
    expect(report.hidden.afterSettledResume.fadingMax).toBeGreaterThan(0);
    expect(report.hidden.afterSettledResume.staleFades).toBe(0);
    expect(report.hidden.afterSettledResume.replays).toBe(0);
  },
);

test("reduced motion shows streamed text as it arrives", { timeout: 120_000 }, async () => {
  const output = await testRenderer(ENTRY, SETUP, { motion: "reduce" });
  expect(output.startsWith("{"), output).toBe(true);
  const report = Value.Parse(Reduced, JSON.parse(output));
  console.info(`prose streaming, reduced motion: ${JSON.stringify(report)}`);

  expect(report.lagging).toBe(0);
  expect(report.whole).toBe(true);
  expect(report.rendersPerDelta).toBeLessThanOrEqual(1);
  expect(report.fadingMax).toBe(0);
  expect(report.spansMax).toBe(0);
});
