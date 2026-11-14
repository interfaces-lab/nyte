import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

test(
  "a closed tab reopens a chat the capped session list leaves out, forgets one archived or deleted, and Settings gives way to a notified chat",
  { timeout: 120_000 },
  async () => {
    const report: unknown = JSON.parse(
      await testRenderer(
        new URL("./closed-tabs.browser-test.tsx", import.meta.url),
        `window.nyte = { clientSurface: "desktop", platform: "linux", host: { setThemePreference() {} } };`,
      ),
    );

    expect(report).toEqual({
      kept: "quiet",
      settings: [
        "a notification shows its chat: /session/other-2, tab other-2",
        "Settings closes onto the chat a notification opened under it: /session/other-3, tab other-3",
      ],
    });
  },
);
