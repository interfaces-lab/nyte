import type { BrowserApi, Page } from "@nyte-ai/core";
import { asId } from "@nyte-ai/schema";
import type { PageSnapshot } from "@nyte-ai/schema";
import { isPart, tool } from "@nyte-ai/core";
import { expect, it } from "vitest";
import browserTools from "../src/browser-tools.ts";
import { fakeModels, open } from "./fake-models.ts";

function fakeBrowser() {
  const calls: string[] = [];
  const snapshot: PageSnapshot = {
    revision: asId("rev1"),
    nodes: [{ ref: "e1", role: "button", name: "Go", editable: false, depth: 0 }],
  };
  const applied = { kind: "applied", snapshot } as const;
  const after = <T>(call: string, value: T): T => {
    calls.push(call);

    return value;
  };

  const page: Page = {
    id: asId("p1"),
    view: async () => ({
      id: asId("p1"),
      url: "https://nyte.test",
      title: "Nyte",
      loading: false,
      revision: asId("rev1"),
      canGoBack: false,
      canGoForward: false,
    }),
    watch: async function* () {},
    snapshot: async () => after("snapshot", snapshot),
    navigate: async (url) => after(`navigate ${url}`, applied),
    back: async () => applied,
    forward: async () => applied,
    reload: async () => applied,
    stopLoading: async () => applied,
    click: async (input) => after(`click ${input.ref}`, applied),
    type: async (input) => after(`type ${input.ref} ${input.text}`, applied),
    press: async (input) => after(`press ${input.key}`, applied),
    scroll: async (input) => after(`scroll ${input.direction}`, applied),
    wait: async (condition) => after(`wait ${condition.kind}`, applied),
    console: async () => after("console", [{ level: "log", text: "ready", at: 1 }]),
    capture: async () => {
      throw new Error("No capture in tests.");
    },
    evaluate: async (expression) => after(`evaluate ${expression}`, { kind: "value", value: 2 }),
    close: async () => undefined,
    [Symbol.asyncDispose]: async () => undefined,
  };

  const browser: BrowserApi = {
    open: async (input) => after(`open ${input.url}`, page),
    adopt: async () => page,
    list: async () => [{ id: asId("p1"), url: "https://nyte.test", title: "Nyte", holders: 1 }],
    watch: async function* () {},
  };

  return { calls, browser };
}

it("drives the workspace browser: open, click, type, console and evaluate", async () => {
  const { calls, browser } = fakeBrowser();
  const fake = fakeModels();

  fake.reply(
    {
      content: [
        {
          type: "toolCall",
          id: "b1",
          name: "browser_open",
          arguments: { url: "https://nyte.test" },
        },
        { type: "toolCall", id: "b2", name: "browser_click", arguments: { ref: "e1" } },
        {
          type: "toolCall",
          id: "b3",
          name: "browser_type",
          arguments: { ref: "e1", text: "hi", page: "p1" },
        },
        { type: "toolCall", id: "b4", name: "browser_console", arguments: {} },
        {
          type: "toolCall",
          id: "b5",
          name: "browser_evaluate",
          arguments: { expression: "1 + 1" },
        },
      ],
    },
    { content: [{ type: "text", text: "Done." }] },
  );

  await using host = await open(fake, [browserTools], { browser });
  const session = await host.sessions.create();
  await (await session.send("Browse.")).settled();

  expect(calls).toEqual([
    "open https://nyte.test",
    "snapshot",
    "click e1",
    "type e1 hi",
    "console",
    "evaluate 1 + 1",
  ]);

  const texts = (await session.view()).messages.flatMap((message) =>
    isPart(message, tool) &&
    message.state.phase === "settled" &&
    message.state.outcome.kind === "ok"
      ? message.state.outcome.content.flatMap((item) => (item.kind === "text" ? [item.text] : []))
      : [],
  );

  expect(texts).toEqual([
    'Page p1: Nyte (https://nyte.test)\nRevision rev1\n[e1] button "Go"',
    'Revision rev1\n[e1] button "Go"',
    'Revision rev1\n[e1] button "Go"',
    "[log] ready",
    "2",
  ]);
});
