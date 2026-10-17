import { expect, test } from "vitest";
import { testRenderer } from "../../../test/renderer.ts";

test(
  "the question tray's label shares the title's edge and centres the chevron",
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
