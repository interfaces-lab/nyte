import { expect, test } from "vitest";
import { testRenderer } from "../../../../test/renderer.ts";

/** The renderer reads `window.nyte` at import time, so the bridge is stubbed first. */
const setup = `
const recorded = [];
window.__nyteBounds = recorded;
const state = {
  url: "https://example.com/",
  title: "Example",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  secure: "https",
  blocking: false,
  blocked: 0,
  agentHolders: 0,
};
const resolved = () => Promise.resolve(undefined);
window.nyte = new Proxy(
  {
    host: {
      openExternal: resolved,
      browser: {
        open: () => Promise.resolve(state),
        navigate: resolved,
        menu: resolved,
        perform: resolved,
        close: resolved,
        captureFrame: resolved,
        setBounds: (message) => recorded.push(message),
      },
    },
    onEvent: () => () => {},
  },
  { get: (target, key) => (key in target ? target[key] : new Proxy({}, { get: () => resolved })) },
);
`;

test("a menu over a browser panel hides the page and gives it back on close", async () => {
  expect(
    await testRenderer(new URL("./browser-occlusion.browser-test.tsx", import.meta.url), setup),
  ).toBe("passed");
}, 60_000);
