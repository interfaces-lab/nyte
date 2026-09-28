import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

test(
  "read-only messages share Lexical chips, preserve selection, and open links",
  { timeout: 60_000 },
  async () => {
    expect(
      await testRenderer(
        new URL("./message-content.browser-test.tsx", import.meta.url),
        "localStorage.setItem('nyte:trusted-link-hosts:v1', JSON.stringify(['example.com'])); window.openedLinks = []; window.nyte = { host: { openExternal: async ({url}) => { window.openedLinks.push(url); } } };",
      ),
    ).toBe("passed");
  },
);
