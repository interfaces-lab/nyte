import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

test(
  "a pane mounts only the chat it shows, keeps the rows of the chats it showed, and marks only the shown one read",
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
