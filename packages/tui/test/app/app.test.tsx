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
import { followedSession } from "../../src/model/state.ts";
import { openTestHost } from "../fixture/host.ts";
import { startTui } from "../harness/tui.ts";

function userTexts(store: Store): readonly string[] {
  return (followedSession(store.state())?.view?.messages ?? []).flatMap((message) =>
    message.kind === "user" ? [JSON.stringify(message.content)] : [],
  );
}

const working = (store: Store): boolean => store.screen().run.kind === "working";

function field(store: Store) {
  const dialog = store.screen().dialog;

  return dialog?.kind === "list" ? { query: dialog.query, caret: dialog.caret } : null;
}

function secretText(store: Store): string | null {
  const dialog = store.screen().dialog;

  return dialog?.kind === "auth" && dialog.step.kind === "secret" && dialog.step.masked
    ? String.fromCodePoint(...dialog.step.codePoints)
    : null;
}

const idle = (store: Store): boolean => store.screen().run.kind === "idle";

test("without copy-on-select, a right-click copies the transcript selection and another key clears it", async () => {
  await using fixture = await openTestHost();
  fixture.reply({ content: [{ type: "text", text: "Select this answer." }] });
  await using app = await startTui({ fixture });
  await app.ready();

  await app.mockInput.typeText("hello");
  app.mockInput.pressEnter();
  const frame = await app.frame((text) => text.includes("Select this answer."));
  const row = frame.split("\n").findIndex((line) => line.includes("Select this answer."));
  const column = (frame.split("\n")[row] ?? "").split("Select")[0]?.length ?? 0;

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

test("Ctrl+Q then delete withdraws a queued message", async () => {
  await using fixture = await openTestHost();
  const release = Promise.withResolvers<void>();
  fixture.reply({ content: [{ type: "text", text: "Working on it." }], until: release.promise });
  await using app = await startTui({ fixture });
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

test("a dialog's search field moves its caret and deletes by word, as an input does", async () => {
  await using fixture = await openTestHost();
  await using app = await startTui({ fixture });
  await app.ready();

  app.mockInput.pressKey("k", { ctrl: true });
  await app.state((store) => field(store) !== null);
  await app.mockInput.typeText("mdel");
  app.mockInput.pressArrow("left");
  app.mockInput.pressArrow("left");
  app.mockInput.pressArrow("left");
  await app.mockInput.typeText("o");
  await app.state((store) => field(store)?.query === "model");
  expect(field(app.store)).toEqual({ query: "model", caret: 2 });

  app.mockInput.pressKey("e", { ctrl: true });
  await app.mockInput.typeText(" x");
  app.mockInput.pressKey("w", { ctrl: true });
  await app.state((store) => field(store)?.query === "model ");
  app.mockInput.pressKey("u", { ctrl: true });
  await app.state((store) => field(store)?.query === "");
  expect(app.store.state().local.draft.text).toBe("");
});

test("API-key login supports paste, select all, delete and repaste without exposing its value", async () => {
  await using fixture = await openTestHost();
  await using app = await startTui({ fixture });
  await app.ready();
  app.store.dispatch({ kind: "open", dialog: { kind: "auth", mode: "login", provider: "test" } });
  await app.state((store) => {
    const dialog = store.screen().dialog;

    return dialog?.kind === "auth" && dialog.step.kind === "choose";
  });
  app.mockInput.pressArrow("down");
  app.mockInput.pressEnter();
  await app.state((store) => {
    const dialog = store.screen().dialog;

    return dialog?.kind === "auth" && dialog.step.kind === "secret" && dialog.step.masked;
  });
  app.terminal.clipboard = { kind: "text", text: "sk-first-test-key" };
  app.mockInput.pressKey("v", { ctrl: true });
  await app.state((store) => secretText(store) === "sk-first-test-key");
  expect(await app.frame((frame) => frame.includes("•"))).not.toContain("sk-first-test-key");
  app.mockInput.pressKey("a", { ctrl: true });
  app.mockInput.pressBackspace();
  await app.state((store) => secretText(store) === "");
  await app.mockInput.pasteBracketedText("sk-second-test-key");
  await app.state((store) => secretText(store) === "sk-second-test-key");
  app.mockInput.pressKey("a", { meta: true });
  await app.mockInput.typeText("sk-final-test-key");
  await app.state((store) => secretText(store) === "sk-final-test-key");
  app.mockInput.pressKey("a", { super: true });
  app.mockInput.pressKey("DELETE");
  await app.state((store) => secretText(store) === "");
  app.terminal.clipboard = { kind: "text", text: "sk-final-test-key" };
  app.mockInput.pressKey("v", { super: true });
  await app.state((store) => secretText(store) === "sk-final-test-key");
  expect(app.store.state().local.draft.text).toBe("");
  expect(await app.frame((frame) => frame.includes("•"))).not.toContain("sk-final-test-key");
  app.mockInput.pressEnter();
  await app.state((store) => store.screen().dialog === null);
  expect(
    (await fixture.models.models.listAccounts("test")).map((account) => account.label),
  ).toEqual(["Account 1"]);
});

test("cancelling a login prompt releases its effect before quitting", async () => {
  await using fixture = await openTestHost();
  await using app = await startTui({ fixture });
  await app.ready();
  app.store.dispatch({ kind: "open", dialog: { kind: "auth", mode: "login", provider: "test" } });
  await app.state((store) => {
    const dialog = store.screen().dialog;

    return dialog?.kind === "auth" && dialog.step.kind === "choose";
  });
  app.mockInput.pressArrow("down");
  app.mockInput.pressEnter();
  await app.state((store) => {
    const dialog = store.screen().dialog;

    return dialog?.kind === "auth" && dialog.step.kind === "secret" && dialog.step.masked;
  });
  app.mockInput.pressEscape();
  await app.state((store) => store.screen().dialog === null);
  await app.store.settled();
  expect(await fixture.models.models.listAccounts("test")).toEqual([]);
  app.mockInput.pressKey("c", { ctrl: true });
  expect(await app.app.closing).toBe(0);
});

test("a render throw shows the error screen, logs it, and R recovers", async () => {
  await using fixture = await openTestHost();
  const [broken, setBroken] = createSignal(false);

  await using app = await startTui({
    fixture,
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

test("launching and quitting with Ctrl+C before a send creates no session and names no resume command", async () => {
  await using fixture = await openTestHost();
  await using app = await startTui({ fixture });
  await app.ready();
  await app.frame((frame) => frame.includes(COMPOSER_PLACEHOLDER));
  app.mockInput.pressCtrlC();

  expect(await app.app.closing).toBe(0);
  expect(app.store.state().facts.chat?.kind).toBe("blank");
  expect((await fixture.host.sessions.list({ parents: { kind: "all" } })).items).toEqual([]);
  const session = followedSession(app.store.state())?.id ?? null;
  expect(exitText({ session, unsent: null, failures: [], crashes: [] })).toBe("");
});

test("a signal that destroys the renderer first still resets the terminal, and closing after it is quiet", async () => {
  await using fixture = await openTestHost();
  await using app = await startTui({ fixture });
  await app.ready();

  app.renderer.destroy();
  app.terminal.closed = true;

  expect(app.terminal.titles.at(-1)).toBe(TERMINAL_TITLE_BASE);
  expect(app.terminal.statuses.filter((status) => status === CLEARED)).toHaveLength(1);
  expect(await app.app.close()).toBeUndefined();
});
