import { expect, test } from "vitest";
import { testRenderer } from "../test/renderer.ts";

test(
  "working-ancestor consumers update only when the active ancestry changes",
  { timeout: 120_000 },
  async () => {
    const report: unknown = JSON.parse(
      await testRenderer(
        new URL("./working-sessions.browser-test.tsx", import.meta.url),
        `window.nyte = { clientSurface: "desktop", platform: "linux", host: { setThemePreference() {} } };`,
      ),
    );

    expect(report).toMatchObject({
      loading: "",
      updates: [
        { phase: "initial", shown: "middle,root-a" },
        { phase: "child metadata", shown: "middle,root-a", commits: 0 },
        { phase: "directory reorder", shown: "middle,root-a", commits: 0 },
        { phase: "another ancestor starts", shown: "middle,root-a,root-b", commits: 1 },
        { phase: "active directory reorder", shown: "middle,root-a,root-b", commits: 0 },
        { phase: "first ancestor stops", shown: "root-b", commits: 1 },
        { phase: "child changes parent", shown: "middle,root-a", commits: 1 },
        { phase: "last child stops", shown: "", commits: 1 },
      ],
    });
  },
);
