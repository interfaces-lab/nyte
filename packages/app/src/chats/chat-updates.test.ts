import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

test(
  "a chat's readers update only when that chat changes, and a chat the lists don't carry joins the directory from its own read",
  { timeout: 120_000 },
  async () => {
    const report: unknown = JSON.parse(
      await testRenderer(
        new URL("./chat-updates.browser-test.tsx", import.meta.url),
        `window.nyte = { clientSurface: "desktop", platform: "linux", host: { setThemePreference() {} } };`,
      ),
    );

    expect(report).toMatchObject({
      loading: "loading loading",
      updates: [
        { phase: "initial", shown: "root-a:subagent-working root-b:completed" },
        { phase: "child metadata", shown: "root-a:subagent-working root-b:completed", commits: 0 },
        {
          phase: "directory reorder",
          shown: "root-a:subagent-working root-b:completed",
          commits: 0,
        },
        {
          phase: "another ancestor starts",
          shown: "root-a:subagent-working root-b:subagent-working",
          commits: 1,
        },
        {
          phase: "active directory reorder",
          shown: "root-a:subagent-working root-b:subagent-working",
          commits: 0,
        },
        {
          phase: "first ancestor stops",
          shown: "root-a:completed root-b:subagent-working",
          commits: 1,
        },
        {
          phase: "child changes parent",
          shown: "root-a:subagent-working root-b:completed",
          commits: 2,
        },
        { phase: "last child stops", shown: "root-a:completed root-b:completed", commits: 1 },
      ],
      unlisted: ["Just started / Just started", "Renamed / Renamed", "Listed / Listed"],
    });
  },
);
