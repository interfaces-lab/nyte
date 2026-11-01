import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

test(
  "a new device's code outlasts a lagging device list and leaves on claim, removal, or expiry",
  { timeout: 60_000 },
  async () => {
    expect(
      await testRenderer(
        new URL("./server-settings-tunnel.browser-test.tsx", import.meta.url),
        `window.nyte = {
  host: {
    setThemePreference() {},
    openExternal: async () => undefined,
    remote: {
      state: () => window.tunnelFixture.state(),
      pair: (input) => window.tunnelFixture.pair(input),
      start: () => window.tunnelFixture.state(),
      stop: async () => undefined,
      revoke: async () => undefined,
    },
    connect: { state: async () => ({ kind: "unavailable", reason: "not_configured" }) },
  },
};`,
      ),
    ).toBe("passed");
  },
);
