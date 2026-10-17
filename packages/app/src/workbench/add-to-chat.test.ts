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
