import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

test(
  "the Nyte account chip and dialog sign in, link, report the lease, and unlink only on confirm",
  { timeout: 60_000 },
  async () => {
    expect(
      await testRenderer(
        new URL("./connect-dialog.browser-test.tsx", import.meta.url),
        `window.nyte = {
  host: {
    setThemePreference() {},
    openExternal: async () => undefined,
    remote: {
      state: async () => ({
        kind: "off",
        tailnet: { kind: "missing" },
        cloudflare: { kind: "unregistered" },
      }),
    },
    connect: {
      state: () => window.connectFixture.state(),
      link: () => window.connectFixture.link(),
      cancel: () => window.connectFixture.cancel(),
      setEnabled: (input) => window.connectFixture.setEnabled(input),
      unlink: () => window.connectFixture.unlink(),
      revokeDevice: (input) => window.connectFixture.revokeDevice(input),
      openAccount: () => window.connectFixture.openAccount(),
      signOut: () => window.connectFixture.signOut(),
    },
  },
};`,
      ),
    ).toBe("passed");
  },
);
