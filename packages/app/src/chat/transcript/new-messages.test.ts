import { expect, test } from "vitest";
import { testRenderer } from "../../../test/renderer.ts";

test(
  "the New divider, the new-messages pills, following and scroll to bottom behave through the real transcript",
  { timeout: 120_000 },
  async () => {
    expect(
      await testRenderer(
        new URL("./new-messages.browser-test.tsx", import.meta.url),
        `window.nyte = { clientSurface: "desktop", platform: "linux", host: { setThemePreference() {} } };`,
      ),
    ).toBe("passed");
  },
);
