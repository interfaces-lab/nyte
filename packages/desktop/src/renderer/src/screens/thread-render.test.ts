import { expect, test } from "vitest";
import { testRenderer } from "../../../../test/renderer.ts";

test(
  "thread rows preserve identity across landing and live deltas",
  { timeout: 60_000 },
  async () => {
    expect(
      await testRenderer(
        new URL("./thread-render.browser-test.tsx", import.meta.url),
        `window.threadRenderEmit = undefined;
window.nyte = {
  host: { setThemePreference() {} },
  sessions: {
    snapshot: async () => window.threadRenderSnapshot,
    metadata: async () => window.threadRenderMetadata
  },
  runs: {
    diff: async ({ runs }) => runs.map((run) => ({ run, diff: { kind: "recorded", files: [] } }))
  },
  watch(_input, emit) {
    window.threadRenderEmit = emit;
    return () => { window.threadRenderEmit = undefined; };
  }
};`,
      ),
    ).toBe("passed");
  },
);
