import "../../../test/window-bridge.ts";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterContextProvider } from "@tanstack/react-router";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { Configuration, Message, ModelCatalogView, SessionView } from "@nyte-ai/sdk";
import type { UserMessage } from "@nyte-ai/plugin/client/presentation";
import { asId, asSeq } from "@nyte-ai/schema";
import type { HostState } from "../../contract/nyte.ts";
import { PaneControllerProvider } from "../../panes/pane-context.tsx";
import { PaneController } from "../../panes/pane-controller.ts";
import { SessionDndProvider } from "../../panes/session-dnd.tsx";
import { keys, queryClient } from "../../data/query-client.ts";
import { installConnection } from "../../data/connection.ts";
import { sessionWatch } from "../../data/watches.ts";
import { SessionScreen } from "../../panes/session-screen.tsx";
import { createAppRouter } from "../../shell/routes.tsx";
import "../../theme/tokens.stylex.ts";
import { scriptedConnection, viewStream } from "../../../test/scripted-connection.ts";
import { COMPLETED, USAGE, endedTurn, sessionRow } from "../../../test/view-fixtures.ts";

const SESSION = asId<"session">("composer-keys");

const PROMPTS = [
  "Where does the session store live?",
  "Rename it to journal.",
  "Update the docs to match.",
] as const;

const DRAFT = "Half a thought";

const configuration: Configuration = {
  kind: "exact",
  model: { provider: "test", id: "test" },
  thinking: "off",
  agent: null,
  settings: {},
  settingsVersion: "1",
};

const turns = PROMPTS.map((text, index) => {
  const turn = asId<"turn">(`turn-${String(index)}`);
  const id = asId<"message">(`prompt-${String(index)}`);

  const prompt: UserMessage = {
    id,
    turn,
    at: index,
    kind: "user",
    content: text,
    source: { kind: "user" },
    delivery: "queue",
    status: { kind: "landed", commit: asId<"commit">(id), run: null, replaced: null },
    siblings: { index: 0, count: 1, ids: [] },
  };

  const reply: Message = {
    id: asId<"message">(`reply-${String(index)}`),
    turn,
    at: index,
    kind: "part",
    part: asId<"part">(`reply-${String(index)}`),
    partKind: "text",
    role: "answer",
    state: { markdown: "Done.", signature: null },
    version: 1,
    status: { kind: "settled", commit: asId<"commit">(`reply-${String(index)}`), endedAt: index },
  };

  return { prompt, reply, info: endedTurn([], { id: turn, prompt: id, steps: 1 }).info };
});

/** Opened cold in the middle of the second turn: its prompt only leads the loaded messages, and the first turn is only in the host's history. */
const leading = turns[1]?.prompt ?? null;

const view: SessionView = {
  revision: asId<"revision">("r1"),
  seenThrough: null,
  seq: asSeq(1),
  activation: { kind: "active" },
  messages: turns
    .slice(1)
    .flatMap((turn) => (turn.prompt === leading ? [turn.reply] : [turn.prompt, turn.reply])),
  queue: [],
  leadingPrompt: leading,
  parts: [],
  turns: turns.slice(1).map((turn) => turn.info),
  usage: USAGE,
  execution: COMPLETED,
  reportsHeld: false,
  background: [],
  configuration: { selected: configuration, effective: configuration },
  context: { tokens: 0, window: 0, lastRequest: null },
  heads: [],
  changes: [],
  catalog: { commands: [], settings: [], skills: [], agents: [], tools: [] },
};

const historyReads: string[] = [];

let historyGate = Promise.resolve();

installConnection(
  scriptedConnection({
    sessions: [sessionRow(SESSION)],
    views: new Map([[SESSION, viewStream(view)]]),
    session: () => ({
      history: async (input) => {
        historyReads.push(input.before);
        await historyGate;
        const page = input.before === leading?.id ? turns.slice(0, 1) : [];

        return {
          messages: page.flatMap((turn) => [turn.prompt, turn.reply]),
          leadingPrompt: null,
          turns: page.map((turn) => turn.info),
        };
      },
    }),
  }).connection,
);

async function until<T>(read: () => T | null | undefined, what: string): Promise<T> {
  const deadline = performance.now() + 5_000;

  for (;;) {
    const value = read();

    if (value !== null && value !== undefined) return value;

    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 10));
  }
}

function press(target: EventTarget, key: string, modifiers: KeyboardEventInit = {}): void {
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...modifiers }),
  );
}

function blur(): void {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

/**
 * Recall reads the history before prompts only once it walks past them, while the transcript
 * pages in before its first message, a reply.
 */
async function recallPrompts(editor: HTMLElement): Promise<void> {
  const reads = (text: string) =>
    until(() => (editor.innerText === text ? true : null), `the composer to read "${text}"`);

  editor.focus();
  document.execCommand("insertText", false, DRAFT);
  await reads(DRAFT);

  await until(() => sessionWatch(SESSION).value, "the chat's view");

  for (const shown of [PROMPTS[2], PROMPTS[1], PROMPTS[0], PROMPTS[0]]) {
    press(editor, "ArrowUp", { ctrlKey: true, altKey: true });
    await reads(shown);
  }

  for (const shown of [PROMPTS[1], PROMPTS[2], DRAFT]) {
    press(editor, "ArrowDown", { ctrlKey: true, altKey: true });
    await reads(shown);
  }

  const recallReads = historyReads.filter((id) => id.startsWith("prompt-")).join();

  if (recallReads !== "prompt-1,prompt-0")
    throw new Error(`recall read the history before ${recallReads || "nothing"}`);
}

/** Text typed while an earlier-prompts read is in flight outlives the read. */
async function typeWhileRecalling(editor: HTMLElement): Promise<void> {
  const gate = Promise.withResolvers<void>();
  historyGate = gate.promise;
  const reads = historyReads.length;

  for (const shown of [PROMPTS[2], PROMPTS[1]]) {
    press(editor, "ArrowUp", { ctrlKey: true, altKey: true });
    await until(
      () => (editor.innerText === shown ? true : null),
      `the composer to read "${shown}"`,
    );
  }

  press(editor, "ArrowUp", { ctrlKey: true, altKey: true });
  await until(() => (historyReads.length > reads ? true : null), "the earlier prompts read");
  document.execCommand("insertText", false, " Typed.");
  const typed = `${PROMPTS[1]} Typed.`;
  await until(() => (editor.innerText === typed ? true : null), "the typed text");
  gate.resolve();
  historyGate = Promise.resolve();
  await new Promise<void>((resolve) => window.setTimeout(resolve, 100));

  if (editor.innerText !== typed)
    throw new Error(`a late recall replaced the typed text with "${editor.innerText}"`);
  document.execCommand("selectAll");
  document.execCommand("insertText", false, DRAFT);
  await until(() => (editor.innerText === DRAFT ? true : null), "the draft to come back");
}

async function openModelPicker(editor: HTMLElement): Promise<void> {
  const menu = () => document.querySelector("[role='menu']");

  const trigger = editor
    .closest("[data-composer-frame]")
    ?.querySelector("button[aria-keyshortcuts]");

  if (trigger?.getAttribute("aria-keyshortcuts") !== "Control+/")
    throw new Error("the model button does not advertise Ctrl+/");

  for (const start of ["the composer", "no field"]) {
    if (start === "no field") blur();
    else editor.focus();
    press(document.activeElement ?? document.body, "/", { ctrlKey: true });
    await until(
      () => (menu()?.contains(document.activeElement) === true ? true : null),
      `Ctrl+/ from ${start} to open the model picker`,
    );
    press(document.activeElement ?? document.body, "Escape");
    await until(
      () => (menu() === null && document.activeElement === editor ? true : null),
      `closing the picker opened from ${start} to return focus to the composer`,
    );
  }
}

async function pasteFromNowhere(editor: HTMLElement): Promise<void> {
  blur();
  press(document.body, "v", { ctrlKey: true });

  if (document.activeElement !== editor)
    throw new Error("Ctrl+V outside a field left the composer");
  const clipboard = new DataTransfer();
  clipboard.setData("text/plain", "Pasted from nowhere");
  editor.dispatchEvent(
    new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }),
  );
  await until(
    () => (editor.innerText === `${DRAFT}Pasted from nowhere` ? true : null),
    "the paste to land in the composer",
  );
}

export async function run(): Promise<string> {
  queryClient.setQueryData(keys.host, { workspace: undefined } satisfies HostState);
  queryClient.setQueryData(keys.modelCatalog("initial"), {
    generation: asId<"catalog-generation">("initial"),
    providers: [],
    default: { provider: "test", id: "test" },
  } satisfies ModelCatalogView);
  queryClient.setQueryData(keys.mentionFiles, []);

  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [`/session/${SESSION}`] }),
  });

  const panes = new PaneController({ storageKey: "composer-keys" });
  panes.selectSession(SESSION);
  const stage = document.createElement("div");
  stage.style.cssText = "position:relative;display:flex;flex-direction:column;height:560px;";
  document.body.append(stage);
  const root = createRoot(stage);

  flushSync(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <RouterContextProvider router={router}>
          <TooltipProvider delay={0} closeDelay={0} timeout={0}>
            <PaneControllerProvider controller={panes}>
              <SessionDndProvider>
                <SessionScreen />
              </SessionDndProvider>
            </PaneControllerProvider>
          </TooltipProvider>
        </RouterContextProvider>
      </QueryClientProvider>,
    ),
  );

  try {
    const region = await until(
      () => stage.querySelector<HTMLElement>("[data-composer-region]"),
      "the composer",
    );

    const editor = await until(
      () => region.querySelector<HTMLElement>("[data-placeholder]"),
      "the editor",
    );

    await until(() => stage.querySelector("[aria-label='Messages'] [data-row-key]"), "the chat");
    await recallPrompts(editor);
    await typeWhileRecalling(editor);
    await openModelPicker(editor);
    await pasteFromNowhere(editor);

    flushSync(() => panes.newChat());
    await openModelPicker(
      await until(
        () => stage.querySelector<HTMLElement>("[data-placeholder^='Ask Nyte']"),
        "the new chat's editor",
      ),
    );

    return "passed";
  } finally {
    flushSync(() => root.unmount());
    stage.remove();
  }
}
