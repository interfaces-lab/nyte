import { Type } from "typebox";
import { Value } from "typebox/value";
import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

const Report = Type.Object({
  deltas: Type.Number(),
  mountedRows: Type.Number(),
  turnViewUpdates: Type.Number(),
  turnViewMounts: Type.Number(),
  updatesPerDelta: Type.Number(),
  commitMsPerDelta: Type.Number(),
});

test("a streamed delta re-renders only the streaming row", { timeout: 120_000 }, async () => {
  const output = await testRenderer(
    new URL("./transcript-streaming.browser-test.tsx", import.meta.url),
    `window.nyte = { clientSurface: "desktop", platform: "linux", host: { setThemePreference() {} } };`,
  );

  const report = Value.Parse(Report, JSON.parse(output));
  console.info(`transcript streaming: ${JSON.stringify(report)}`);

  expect(report.updatesPerDelta).toBeLessThanOrEqual(1);
});
