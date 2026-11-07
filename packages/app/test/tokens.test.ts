import { expect, test } from "vitest";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { testRenderer } from "./renderer.ts";

const contrastResults = Type.Array(
  Type.Object({
    mode: Type.String(),
    scope: Type.String(),
    role: Type.String(),
    surface: Type.String(),
    ratio: Type.Number(),
    minimum: Type.Number(),
    color: Type.Optional(Type.String()),
    expected: Type.Optional(Type.String()),
  }),
);

test(
  "appearance concerns compose without overwriting each other",
  { timeout: 60_000 },
  async () => {
    expect(await testRenderer(new URL("./appearance.fixture.ts", import.meta.url))).toBe("passed");
  },
);

test.each(
  (["no-preference", "more"] as const).flatMap((contrast) =>
    [
      { state: "rest", forcePseudoClasses: [] },
      { state: "hover", forcePseudoClasses: ["hover"] },
      { state: "held", forcePseudoClasses: ["hover", "active"] },
    ].map((state) => ({ contrast, ...state })),
  ),
)(
  "the colour stairs and count ink keep their contracts with $contrast contrast, $state",
  { timeout: 60_000 },
  async ({ contrast, forcePseudoClasses }) => {
    const result: unknown = JSON.parse(
      await testRenderer(new URL("./scope-contrast.fixture.tsx", import.meta.url), "", {
        contrast,
        forcePseudoClasses,
        forcePseudoSelector: "[data-count-case]",
      }),
    );

    if (!Value.Check(contrastResults, result)) throw new Error("Invalid renderer contrast results");
    expect(result.length).toBeGreaterThan(0);

    for (const row of result) {
      expect(
        row.ratio,
        `${row.mode} ${row.scope} ${row.role} on ${row.surface}`,
      ).toBeGreaterThanOrEqual(row.minimum);

      if (row.expected !== undefined) {
        expect(row.color, `${row.mode} ${row.scope} ink on ${row.surface}`).toBeDefined();

        if (row.color === undefined) throw new Error("Missing count color");

        for (const offset of [0, 2, 4])
          expect(
            Math.abs(
              Number.parseInt(row.color.slice(offset, offset + 2), 16) -
                Number.parseInt(row.expected.slice(offset, offset + 2), 16),
            ),
            `${row.mode} ${row.scope} ink on ${row.surface}: #${row.color}, expected #${row.expected}`,
          ).toBeLessThanOrEqual(1);
      }
    }
  },
);
