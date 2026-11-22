import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

test(
  "the commit bar offers pull requests only where GitHub is served, says why one is blocked, and shows the branch's pull request and checks",
  { timeout: 60_000 },
  async () => {
    const bridge =
      "window.nyte = { clientSurface: 'desktop', platform: 'darwin', host: { setThemePreference() {}, state: () => Promise.resolve({ workspace: undefined }), onEvent: () => () => {} } };";

    expect(
      await testRenderer(new URL("./changes-commit-bar.browser-test.tsx", import.meta.url), bridge),
    ).toBe("passed");
  },
);
