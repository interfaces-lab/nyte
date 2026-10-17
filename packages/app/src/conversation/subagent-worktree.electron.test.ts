import process from "node:process";
import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

test("a subagent in a worktree shows its branch where a shared one shows its folder", async () => {
  expect(
    await testRenderer(
      new URL("./subagent-worktree.browser-test.tsx", import.meta.url),
      `window.nyte = { clientSurface: "desktop", platform: "linux", host: { setThemePreference() {} } };`,
      { captures: process.env.NYTE_CAPTURES },
    ),
  ).toBe("passed");
}, 90_000);
