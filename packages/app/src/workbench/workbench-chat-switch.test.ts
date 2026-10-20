import { Type } from "typebox";
import { Value } from "typebox/value";
import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

const Counts = Type.Object({
  Workbench: Type.Number(),
  FilesPanel: Type.Number(),
  TextFileEditor: Type.Number(),
  CodeView: Type.Number(),
  ChangesPanel: Type.Number(),
  ChangesToolbar: Type.Number(),
});

const Report = Type.Object({
  switches: Type.Array(Counts),
  deltas: Type.Number(),
  streaming: Counts,
});

test(
  "switching chats and streaming one render nothing in the workbench but its chat's changes",
  { timeout: 120_000 },
  async () => {
    const output = await testRenderer(
      new URL("./workbench-chat-switch.browser-test.tsx", import.meta.url),
      `window.nyte = { clientSurface: "desktop", platform: "linux", host: { setThemePreference() {} } };`,
    );

    const report = Value.Parse(Report, JSON.parse(output));
    console.info(`workbench chat switch: ${JSON.stringify(report)}`);

    expect(
      report.switches.map((counts) => [
        counts.Workbench,
        counts.FilesPanel,
        counts.TextFileEditor,
        counts.CodeView,
        counts.ChangesPanel,
      ]),
    ).toEqual(Array.from({ length: 6 }, () => [0, 0, 0, 0, 1]));
    expect(report.deltas).toBe(60);
    expect(report.streaming).toEqual({
      Workbench: 0,
      FilesPanel: 0,
      TextFileEditor: 0,
      CodeView: 0,
      ChangesPanel: 0,
      ChangesToolbar: 0,
    });
  },
);
