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

/** The renderer reads `window.nyte` at import time, so the page bridge is stubbed first. */
const browserBridge = `
window.__nytePicks = 0;
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
window.nyte = new Proxy(
  {
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
        pickElement: () => {
          window.__nytePicks += 1;
          return Promise.resolve(
            window.__nytePicks === 1
              ? {
                  url: "https://example.com/",
                  selector: "main > button.primary",
                  html: '<button class="primary">Save</button>',
                  image: "data:image/png;base64,AQIDBA==",
                }
              : undefined,
          );
        },
        find: () => Promise.resolve({ active: 0, total: 0 }),
        cancelDownload: resolved,
        login: resolved,
        history: () => Promise.resolve([]),
        forgetHistory: resolved,
        setBounds: () => {},
        setFocus: () => {},
      },
    },
    onEvent: () => () => {},
  },
  { get: (target, key) => (key in target ? target[key] : new Proxy({}, { get: () => resolved })) },
);
`;

test("an element picked on a page goes to the chat as its HTML, selector and crop", async () => {
  expect(
    await testRenderer(
      new URL("./add-to-chat-browser.browser-test.tsx", import.meta.url),
      browserBridge,
    ),
  ).toBe("passed");
}, 60_000);
