import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

test.each(["fine", "coarse"] as const)(
  "the workspace menu lists each folder once, newest first, with Open Folder… in view (%s pointer)",
  { timeout: 90_000 },
  async (pointer) => {
    expect(
      await testRenderer(
        new URL("./workspace-context.browser-test.tsx", import.meta.url),
        `window.nyte = { clientSurface: "desktop", platform: "linux", host: { setThemePreference() {}, pickWorkspace: () => Promise.resolve({ kind: "cancelled" }) } };`,
        { pointer },
      ),
    ).toBe("passed");
  },
);
