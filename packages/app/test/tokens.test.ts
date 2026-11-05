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
  }),
);

test(
  "appearance concerns compose without overwriting each other",
  { timeout: 60_000 },
  async () => {
    expect(await testRenderer(new URL("./appearance.fixture.ts", import.meta.url))).toBe("passed");
  },
);

test.each(["no-preference", "more"] as const)(
  "the colour stairs keep their floors and order with prefers-contrast: %s",
  { timeout: 60_000 },
  async (contrast) => {
    const result: unknown = JSON.parse(
      await testRenderer(new URL("./scope-contrast.fixture.ts", import.meta.url), "", { contrast }),
    );

    if (!Value.Check(contrastResults, result)) throw new Error("Invalid renderer contrast results");
    expect(result.length).toBeGreaterThan(0);

    for (const row of result) {
      expect(
        row.ratio,
        `${row.mode} ${row.scope} ${row.role} on ${row.surface}`,
      ).toBeGreaterThanOrEqual(row.minimum);
    }
  },
);
