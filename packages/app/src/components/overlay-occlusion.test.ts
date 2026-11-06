import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

const setup = `
const recorded = [];
window.__nyteBounds = recorded;
const capture = { calls: 0, mode: "still" };
window.__nyteCapture = capture;
const state = {
  url: "https://example.com/",
  title: "Example",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  secure: "https",
  blocking: "off",
  blocked: 0,
  agentHolders: 0,
  fullscreen: false,
  deniedPermissions: [],
};
const resolved = () => Promise.resolve(undefined);
const still = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const stillPainted = () => {
  const image = document.querySelector('section[aria-label="Browser"] img[src^="data:image/"]');
  return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
};
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
        captureFrame: () => {
          capture.calls += 1;
          if (capture.mode === "hold") return new Promise(() => {});
          if (capture.mode === "reject") return Promise.reject(new Error("The page is gone"));
          return Promise.resolve(capture.mode === "broken" ? "data:image/jpeg;base64,AAAA" : still);
        },
        find: () => Promise.resolve({ active: 0, total: 0 }),
        cancelDownload: resolved,
        login: resolved,
        history: () => Promise.resolve([]),
        forgetHistory: resolved,
        setBounds: (message) => recorded.push({ ...message, still: stillPainted() }),
        setFocus: () => {},
      },
    },
    onEvent: () => () => {},
  },
  { get: (target, key) => (key in target ? target[key] : new Proxy({}, { get: () => resolved })) },
);
`;

test("menus and Morph hide a browser page after its still loads and give it back on close", async () => {
  expect(
    await testRenderer(new URL("./overlay-occlusion.browser-test.tsx", import.meta.url), setup),
  ).toBe("passed");
}, 60_000);
