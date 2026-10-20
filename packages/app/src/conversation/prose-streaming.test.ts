import { Type } from "typebox";
import { Value } from "typebox/value";
import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

const Report = Type.Object({
  deltas: Type.Number(),
  revealMs: Type.Number(),
  blocks: Type.Number(),
  markdownRenders: Type.Number(),
  rendersPerDelta: Type.Number(),
  settlingRenders: Type.Number(),
  idleRenders: Type.Number(),
  fadeSpans: Type.Number(),
  unsettledSpans: Type.Number(),
});

test(
  "a streamed answer fades word by word and re-parses only its tail",
  { timeout: 120_000 },
  async () => {
    const output = await testRenderer(
      new URL("./prose-streaming.browser-test.tsx", import.meta.url),
      `window.nyte = { clientSurface: "desktop", host: { setThemePreference() {} } };`,
      { motion: "no-preference" },
    );

    const report = Value.Parse(Report, JSON.parse(output));
    console.info(`prose streaming: ${JSON.stringify(report)}`);

    expect(report.blocks).toBe(10);
    expect(report.fadeSpans).toBeGreaterThan(0);
    expect(report.rendersPerDelta).toBeLessThan(2);
    expect(report.idleRenders).toBe(0);
    expect(report.unsettledSpans).toBe(0);
  },
);
