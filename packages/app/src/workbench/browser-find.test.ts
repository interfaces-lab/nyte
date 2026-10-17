import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

const setup = `
const finds = [];
window.__nyteFinds = finds;
window.nyte = {
  host: {
    browser: {
      find: (input) => {
        if (input.text !== "") finds.push(input.text);
        return Promise.resolve({ active: 0, total: 0 });
      },
    },
  },
};
`;

test("find waits for a finished composition, and Escape hands back the keyboard", async () => {
  expect(
    await testRenderer(new URL("./browser-find.browser-test.tsx", import.meta.url), setup),
  ).toBe("passed");
}, 60_000);
