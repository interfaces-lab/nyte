import { Type } from "typebox";
import { Value } from "typebox/value";
import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

/** `switched` is every round trip the switches cost; their times depend on the machine drawing them, so they are reported, not asserted. */
const Report = Type.Object({
  opening: Type.Number(),
  gapShown: Type.Boolean(),
  gapClosed: Type.Number(),
  switches: Type.Array(Type.String()),
  switched: Type.Array(Type.String()),
  slowest: Type.Number(),
  roundTrip: Type.Number(),
});

test(
  "switching between streaming chats shows each one's current turn, prompt included, without a round trip",
  { timeout: 120_000 },
  async () => {
    const output = await testRenderer(
      new URL("./session-switching.browser-test.tsx", import.meta.url),
      `window.nyte = { clientSurface: "desktop", platform: "linux", host: { setThemePreference() {} } };`,
    );

    const report = Value.Parse(Report, JSON.parse(output));
    console.info(`session switching: ${JSON.stringify(report)}`);

    expect(report.opening).toBeLessThan(2 * report.roundTrip);
    expect(report.gapShown).toBe(true);
    expect(report.switched).toEqual([]);
  },
);
