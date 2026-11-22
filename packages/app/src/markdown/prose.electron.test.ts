import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

test(
  "prose keeps one tree across settle and streams Mermaid as source",
  { timeout: 60_000 },
  async () => {
    expect(
      await testRenderer(
        new URL("./prose.browser-test.tsx", import.meta.url),
        `window.nyte = { clientSurface: "desktop", host: { setThemePreference() {} } };
const media = window.matchMedia.bind(window);
window.matchMedia = (query) => media(query.includes("prefers-reduced-motion") ? "not all" : query);`,
      ),
    ).toBe("passed");
  },
);
