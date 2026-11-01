import { Type } from "typebox";
import { Value } from "typebox/value";
import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

const Report = Type.Object({
  snapshots: Type.Number(),
  unrelated: Type.Object({ title: Type.Number(), row: Type.Number(), unlisted: Type.Number() }),
  renamed: Type.Object({ title: Type.Number(), text: Type.String() }),
  unlisted: Type.String(),
});

test(
  "a session's readers re-render only when its own row changes",
  { timeout: 120_000 },
  async () => {
    const output = await testRenderer(
      new URL("./session-selection.browser-test.tsx", import.meta.url),
      `window.nyte = { clientSurface: "desktop", platform: "linux", host: {} };`,
    );

    const report = Value.Parse(Report, JSON.parse(output));
    console.info(`session selection: ${JSON.stringify(report)}`);

    expect(report.unrelated).toEqual({ title: 0, row: 0, unlisted: 0 });
    expect(report.renamed).toEqual({ title: 1, text: "Renamed" });
    expect(report.unlisted).toBe("Read from host");
  },
);
