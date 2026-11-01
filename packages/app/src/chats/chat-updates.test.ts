import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

test(
  "a chat's readers update only when that chat changes, its own run stays as it ended while its background work comes and goes, and a chat the lists don't carry joins the directory from its own read",
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
        { phase: "initial", shown: "root-a:completed:1 root-b:completed:0" },
        { phase: "child metadata", shown: "root-a:completed:1 root-b:completed:0", commits: 0 },
        {
          phase: "directory reorder",
          shown: "root-a:completed:1 root-b:completed:0",
          commits: 0,
        },
        {
          phase: "another root starts background work",
          shown: "root-a:completed:1 root-b:completed:1",
          commits: 1,
        },
        {
          phase: "busy directory reorder",
          shown: "root-a:completed:1 root-b:completed:1",
          commits: 0,
        },
        {
          phase: "first root's background work ends",
          shown: "root-a:completed:0 root-b:completed:1",
          commits: 1,
        },
        {
          phase: "background work moves",
          shown: "root-a:completed:1 root-b:completed:0",
          commits: 2,
        },
        {
          phase: "last background work ends",
          shown: "root-a:completed:0 root-b:completed:0",
          commits: 1,
        },
      ],
      unlisted: ["Just started / Just started", "Renamed / Renamed", "Listed / Listed"],
    });
  },
);
