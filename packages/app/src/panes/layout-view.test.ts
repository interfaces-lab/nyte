import { Type } from "typebox";
import { Value } from "typebox/value";
import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

const Step = Type.Object({
  name: Type.String(),
  sameElements: Type.Boolean(),
  scrollTop: Type.Number(),
  topRow: Type.Union([Type.String(), Type.Null()]),
  order: Type.Array(Type.String()),
  commits: Type.Object({
    "render:conversation": Type.Number(),
    "render:transcript-row": Type.Number(),
    "render:composer": Type.Number(),
  }),
});

const KEPT_IN_PLACE = ["focus", "resize", "zoom", "unzoom"];

const Report = Type.Object({
  scrollTop: Type.Number(),
  topRow: Type.Union([Type.String(), Type.Null()]),
  steps: Type.Array(Step),
});

test(
  "focusing, resizing, zooming and moving a pane keep each chat's element, and only a move redraws a chat",
  { timeout: 120_000 },
  async () => {
    const output = await testRenderer(
      new URL("./layout-view.browser-test.tsx", import.meta.url),
      `window.nyte = { clientSurface: "desktop", platform: "linux", host: { setThemePreference() {} } };`,
    );

    expect(output.startsWith("{"), output).toBe(true);
    const report = Value.Parse(Report, JSON.parse(output));
    console.info(`layout view: ${JSON.stringify(report)}`);
    expect(report.scrollTop).toBeGreaterThan(0);
    expect(report.topRow).not.toBeNull();

    const steps = new Map(report.steps.map((step) => [step.name, step]));

    for (const name of KEPT_IN_PLACE) {
      const step = steps.get(name);
      expect(step?.sameElements, name).toBe(true);
      expect(step?.topRow, name).toBe(report.topRow);
      expect(step?.commits["render:conversation"], name).toBe(0);
      expect(step?.commits["render:transcript-row"], name).toBe(0);
      expect(step?.order, name).toEqual(["left", "right"]);
    }

    expect(steps.get("focus")?.scrollTop).toBe(report.scrollTop);
    const resized = steps.get("resize")?.scrollTop;
    expect(steps.get("zoom")?.scrollTop).toBe(resized);
    expect(steps.get("unzoom")?.scrollTop).toBe(resized);

    const moved = steps.get("move");
    expect(moved?.sameElements).toBe(true);
    expect(moved?.order).toEqual(["right", "left"]);
  },
);
