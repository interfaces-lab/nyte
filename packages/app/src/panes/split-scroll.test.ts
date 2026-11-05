import process from "node:process";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

const PaneEnd = Type.Object({
  distance: Type.Number(),
  room: Type.Number(),
  conversation: Type.Number(),
  live: Type.Boolean(),
});

const Report = Type.Array(Type.Object({ name: Type.String(), panes: Type.Array(PaneEnd) }));

test(
  "a pane opens at its end with the conversation filling at least half the room above its composer, split or not, settled or working",
  { timeout: 120_000 },
  async () => {
    const output = await testRenderer(
      new URL("./split-scroll.browser-test.tsx", import.meta.url),
      `window.nyte = { clientSurface: "desktop", platform: "linux", host: { setThemePreference() {} } };`,
      { captures: process.env.NYTE_FRAME_CAPTURES },
    );

    expect(output.startsWith("["), output).toBe(true);
    const report = Value.Parse(Report, JSON.parse(output));
    console.info(`split scroll: ${JSON.stringify(report)}`);

    const working = report.flatMap((journey) =>
      journey.name.endsWith("working") ? [journey.panes[1]?.live] : [],
    );

    expect(working).toEqual([true]);

    for (const journey of report)
      for (const [index, pane] of journey.panes.entries()) {
        const where = `${journey.name} pane ${String(index)}`;
        expect(pane.distance, where).toBeLessThanOrEqual(4);
        expect(pane.conversation, where).toBeGreaterThanOrEqual(pane.room / 2);
      }
  },
);
