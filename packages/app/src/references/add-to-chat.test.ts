import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

const bridge =
  "window.nyte = { sessions: {}, watch: () => () => {}, onEvent: () => () => {}, host: { setThemePreference() {} } };";

test("a range picked in the Changes diff goes to the chat as its exact hunk", async () => {
  expect(
    await testRenderer(new URL("./add-to-chat-diff.browser-test.tsx", import.meta.url), bridge),
  ).toBe("passed");
}, 60_000);

test("a terminal selection goes to the chat with the command it followed", async () => {
  expect(
    await testRenderer(new URL("./add-to-chat-terminal.browser-test.tsx", import.meta.url), bridge),
  ).toBe("passed");
}, 60_000);

const browserBridge = `
window.__nyteChanges = [];
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
  design: { on: false, views: { xray: false, rulers: false, grid: false, contrast: false } },
};
const resolved = () => Promise.resolve(undefined);
window.nyte = new Proxy(
  {
    app: "nyte",
    host: {
      openExternal: resolved,
      setThemePreference() {},
      browser: {
        open: () => Promise.resolve(state),
        navigate: resolved,
        menu: resolved,
        perform: resolved,
        close: resolved,
        captureFrame: resolved,
        design: (input) => {
          window.__nyteChanges.push(input.change);
          return resolved();
        },
        find: () => Promise.resolve({ active: 0, total: 0 }),
        cancelDownload: resolved,
        login: resolved,
        history: () => Promise.resolve([]),
        forgetHistory: resolved,
        setFocus: () => {},
        guests: () => Promise.resolve([]),
        attach: resolved,
        setShown: () => {},
      },
    },
    onEvent: () => () => {},
  },
  { get: (target, key) => (key in target ? target[key] : new Proxy({}, { get: () => resolved })) },
);
`;

test("Design Mode asks the page's surface to turn on, and its picks reach the chat with their crops", async () => {
  expect(
    await testRenderer(
      new URL("./add-to-chat-browser.browser-test.tsx", import.meta.url),
      browserBridge,
    ),
  ).toBe("passed");
}, 60_000);
