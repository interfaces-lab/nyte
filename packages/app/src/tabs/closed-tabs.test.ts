import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

test(
  "a closed tab reopens a chat the capped session list leaves out, and forgets one archived or deleted",
  { timeout: 120_000 },
  async () => {
    const report: unknown = JSON.parse(
      await testRenderer(
        new URL("./closed-tabs.browser-test.tsx", import.meta.url),
        `window.nyte = { clientSurface: "desktop", platform: "linux", host: { setThemePreference() {} } };`,
      ),
    );

    expect(report).toEqual({ opened: "deleted, archived, quiet", kept: "quiet" });
  },
);
