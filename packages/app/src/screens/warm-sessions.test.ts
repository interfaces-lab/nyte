import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

test(
  "a pane keeps its three most recent chats mounted and marks only the shown one read",
  { timeout: 90_000 },
  async () => {
    expect(
      await testRenderer(
        new URL("./warm-sessions.browser-test.tsx", import.meta.url),
        `window.nyte = { clientSurface: "desktop", platform: "linux", host: { setThemePreference() {} } };`,
      ),
    ).toBe("passed");
  },
);
