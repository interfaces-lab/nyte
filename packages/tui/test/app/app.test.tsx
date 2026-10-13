/**
 * The whole app over the real in-process host, driven by keys: boot, send,
 * queue while working, stop, withdraw, answer a question, survive a render
 * throw, and quit with the resume command.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { MouseButtons } from "@opentui/core/testing";
import { createSignal } from "solid-js";
import { exitText } from "../../src/app/main.tsx";
import type { Store } from "../../src/app/store.ts";
import { COMPOSER_PLACEHOLDER } from "../../src/lib/constants.ts";
import { TERMINAL_TITLE_BASE } from "../../src/lib/format.ts";
import { CLEARED } from "../../src/lib/program-status.ts";
import { openTestHost } from "../fixture/host.ts";
import { startApp } from "./start.tsx";

function userTexts(store: Store): readonly string[] {
  return (store.state().facts.session?.view?.messages ?? []).flatMap((message) =>
    message.kind === "user" ? [JSON.stringify(message.content)] : [],
  );
}

const working = (store: Store): boolean => store.screen().run.kind === "working";
const idle = (store: Store): boolean => store.screen().run.kind === "idle";

test("boots to a ready composer", async () => {
  await using fixture = await openTestHost();
  await using app = await startApp(fixture);
  await app.ready();

  expect(await app.frame((frame) => frame.includes(COMPOSER_PLACEHOLDER))).not.toContain("Loading");
});

test("typing and Enter sends the draft", async () => {
  await using fixture = await openTestHost();
  fixture.reply({ content: [{ type: "text", text: "Hello back." }] });
  await using app = await startApp(fixture);
  await app.ready();

  await app.mockInput.typeText("hello there");
  app.mockInput.pressEnter();

  expect(JSON.stringify((await fixture.requested(1)).context.messages)).toContain("hello there");
  await app.state(idle);
  expect(app.store.state().local.draft.text).toBe("");
});

test("without copy-on-select, a right-click copies the transcript selection and another key clears it", async () => {
  await using fixture = await openTestHost();
  fixture.reply({ content: [{ type: "text", text: "Select this answer." }] });
  await using app = await startApp(fixture);
  await app.ready();

  await app.mockInput.typeText("hello");
  app.mockInput.pressEnter();
  const frame = await app.frame((text) => text.includes("Select this answer."));
  const row = frame.split("\n").findIndex((line) => line.includes("Select this answer."));
  const column = (frame.split("\n")[row] ?? "").indexOf("Select");

  await app.mockMouse.drag(column, row, column + 5, row);
  await app.renderOnce();
  expect(app.renderer.hasSelection).toBe(true);

  await app.mockMouse.pressDown(column + 2, row, MouseButtons.RIGHT);
  expect(app.terminal.copies).toEqual(["Select"]);
  expect(app.renderer.hasSelection).toBe(true);

  app.mockInput.pressKey("x");
  await app.renderOnce();
  expect(app.renderer.hasSelection).toBe(false);
});

test("Ctrl+Enter while working queues the draft for the next turn", async () => {
  await using fixture = await openTestHost();
  const release = Promise.withResolvers<void>();

  fixture.reply(
    { content: [{ type: "text", text: "Working on it." }], until: release.promise },
    { content: [{ type: "text", text: "Done later." }] },
  );

  await using app = await startApp(fixture);
  await app.ready();
  await app.mockInput.typeText("first");
  app.mockInput.pressEnter();
  await app.state(working);

  await app.mockInput.typeText("later");
  app.mockInput.pressEnter({ ctrl: true });
  await app.state((store) => store.screen().queue.some((row) => row.text === "later"));

  expect(app.store.screen().queue.find((row) => row.text === "later")).toMatchObject({
    delivery: "queue",
  });
  expect(fixture.requests).toHaveLength(1);

  release.resolve();
  expect(JSON.stringify((await fixture.requested(2)).context.messages)).toContain("later");
});

test("Esc stops the run", async () => {
  await using fixture = await openTestHost();
  fixture.reply({ content: [{ type: "text", text: "A long answer." }], hold: true });
  await using app = await startApp(fixture);
  await app.ready();

  await app.mockInput.typeText("go on");
  app.mockInput.pressEnter();
  await app.state(working);

  app.mockInput.pressEscape();
  await app.state(idle);

  expect(fixture.requests).toHaveLength(1);
});

test("Ctrl+Q then delete withdraws a queued message", async () => {
  await using fixture = await openTestHost();
  const release = Promise.withResolvers<void>();
  fixture.reply({ content: [{ type: "text", text: "Working on it." }], until: release.promise });
  await using app = await startApp(fixture);
  await app.ready();

  await app.mockInput.typeText("first");
  app.mockInput.pressEnter();
  await app.state(working);
  await app.mockInput.typeText("never mind");
  app.mockInput.pressEnter({ ctrl: true });
  await app.state((store) => store.screen().queue.length === 1);

  app.mockInput.pressKey("q", { ctrl: true });
  await app.state((store) => store.screen().dialog?.kind === "list");
  app.mockInput.pressKey("d", { ctrl: true });
  await app.state((store) => store.screen().queue.length === 0);

  expect(userTexts(app.store).some((text) => text.includes("never mind"))).toBe(false);
  release.resolve();
  await app.state(idle);
  await app.store.settled();
  expect(fixture.requests).toHaveLength(1);
});

test("a question shows, and a typed answer answers it", async () => {
  await using fixture = await openTestHost();

  fixture.reply(
    {
      content: [
        {
          type: "toolCall",
          id: "ask",
          name: "question",
          arguments: { prompt: "Pick a colour?", options: ["Red", "Blue"] },
        },
      ],
    },
    { content: [{ type: "text", text: "Green it is." }] },
  );

  await using app = await startApp(fixture);
  await app.ready();
  await app.mockInput.typeText("ask me");
  app.mockInput.pressEnter();
  await app.frame((frame) => frame.includes("Pick a colour?"));

  await app.mockInput.typeText("Green");
  await app.state((store) => store.state().local.question.answering === "Green");
  app.mockInput.pressEnter();

  expect(JSON.stringify((await fixture.requested(2)).context.messages)).toContain("Green");
  await app.state(idle);
  expect(userTexts(app.store).some((text) => text.includes("Green"))).toBe(false);
});

test("a render throw shows the error screen, logs it, and R recovers", async () => {
  await using fixture = await openTestHost();
  const [broken, setBroken] = createSignal(false);

  await using app = await startApp(fixture, {
    kit: (kit) => ({
      ...kit,
      theme: () => {
        if (broken()) throw new Error("The palette exploded.");

        return kit.theme();
      },
    }),
  });

  await app.ready();
  setBroken(true);
  await app.frame((frame) => frame.includes("Something went wrong"));

  expect(readFileSync(join(app.home, "logs", "tui.log"), "utf8")).toContain(
    "The palette exploded.",
  );
  expect(app.store.state().local.failures.at(-1)).toMatchObject({
    origin: "render",
    message: "The palette exploded.",
  });

  setBroken(false);
  app.mockInput.pressKey("r");
  await app.frame((frame) => frame.includes(COMPOSER_PLACEHOLDER));
});

test("Ctrl+C on an empty composer quits, and the exit names the resume command", async () => {
  await using fixture = await openTestHost();
  await using app = await startApp(fixture);
  await app.ready();
  const session = app.store.state().facts.session?.id;

  if (session === undefined) throw new Error("No session was followed.");
  app.mockInput.pressCtrlC();

  expect(await app.app.closing).toBe(0);
  expect(exitText({ session, failures: [], crashes: [] })).toBe(
    `\nTo resume previous session\nnyte --session=${session}\n`,
  );
});

test("a signal that destroys the renderer first still resets the terminal, and closing after it is quiet", async () => {
  await using fixture = await openTestHost();
  await using app = await startApp(fixture);
  await app.ready();

  app.renderer.destroy();
  app.terminal.closed = true;

  expect(app.terminal.titles.at(-1)).toBe(TERMINAL_TITLE_BASE);
  expect(app.terminal.statuses.filter((status) => status === CLEARED)).toHaveLength(1);
  expect(await app.app.close()).toBeUndefined();
});
