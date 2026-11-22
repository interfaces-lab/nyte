import { Type } from "typebox";
import { Value } from "typebox/value";
import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

const Report = Type.Object({
  reduced: Type.Boolean(),
  longest: Type.Number(),
  fades: Type.Record(Type.String(), Type.Array(Type.String())),
});

const FADES = {
  static: [],
  live: ["History.", "Tail"],
  inline: ["sum"],
  append: ["grows."],
  block: ["Fresh", "Next", "block."],
  reveal: ["hidden"],
  resumed: ["resumed"],
  settle: [],
};

test.each(["no-preference", "reduce"] as const)(
  "streamed prose fades only new words: %s",
  { timeout: 60_000 },
  async (motion) => {
    const output = await testRenderer(
      new URL("./prose-streaming.browser-test.tsx", import.meta.url),
      `window.nyte = { clientSurface: "desktop", host: { setThemePreference() {} } };`,
      { motion },
    );

    expect(output.startsWith("{"), output).toBe(true);
    const report = Value.Parse(Report, JSON.parse(output));
    const reduced = motion === "reduce";

    expect(report.reduced).toBe(reduced);
    expect(report.fades).toEqual(
      reduced ? Object.fromEntries(Object.keys(FADES).map((name) => [name, []])) : FADES,
    );
    expect(report.longest > 0 && report.longest < 200).toBe(!reduced);
  },
);
