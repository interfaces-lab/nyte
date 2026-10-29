import { expect, test } from "vitest";
import { testRenderer } from "../../../test/renderer.ts";

test(
  "the question tray lines its label up with the title and shows a failed answer or dismissal",
  { timeout: 60_000 },
  async () => {
    expect(
      await testRenderer(
        new URL("./questions.browser-test.tsx", import.meta.url),
        "window.nyte = { host: { setThemePreference() {} } };",
      ),
    ).toBe("passed");
  },
);
