import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

test(
  "a waiting grandchild the capped session list leaves out still asks in the root chat, and its subagents stay stoppable",
  { timeout: 120_000 },
  async () => {
    expect(
      await testRenderer(
        new URL("./capped-lists.browser-test.tsx", import.meta.url),
        `window.nyte = { clientSurface: "desktop", platform: "linux", host: { setThemePreference() {} } };`,
      ),
    ).toBe("passed");
  },
);
