import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

test(
  "a new chat's send held for the host starts once, where its draft is",
  { timeout: 90_000 },
  async () => {
    expect(
      await testRenderer(
        new URL("./blank-conversation.browser-test.tsx", import.meta.url),
        `window.nyte = { clientSurface: "desktop", platform: "linux", host: { setThemePreference() {} } };`,
      ),
    ).toBe("passed");
  },
);
