import "../../test/window-bridge.ts";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterContextProvider } from "@tanstack/react-router";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { Configuration, Message, ModelCatalogView, SessionView } from "@nyte-ai/sdk";
import { asId, asSeq } from "@nyte-ai/schema";
import type { HostState } from "../contract/nyte.ts";
import { PaneControllerProvider } from "../panes/pane-context.tsx";
import { PaneController } from "../panes/pane-controller.ts";
import { SessionDndProvider } from "../panes/session-dnd.tsx";
import { keys, queryClient } from "../data/query-client.ts";
import { installConnection } from "../data/connection.ts";
import { sessionWatch } from "../data/watches.ts";
import { SessionScreen } from "../panes/session-screen.tsx";
import { createAppRouter } from "../shell/routes.tsx";
import "../theme/tokens.stylex.ts";
import { scriptedConnection, viewStream } from "../../test/scripted-connection.ts";
import { COMPLETED, USAGE, endedTurn, sessionRow } from "../../test/view-fixtures.ts";

const SESSION = asId<"session">("composer-keys");

const PROMPTS = ["Where does the session store live?", "Rename it to journal."] as const;

const DRAFT = "Half a thought";

const configuration: Configuration = {
  kind: "exact",
  model: { provider: "test", id: "test" },
  thinking: "off",
  agent: null,
  settings: {},
  settingsVersion: "1",
};

const turns = PROMPTS.map((prompt, index) => {
  const turn = asId<"turn">(`turn-${String(index)}`);
  const id = asId<"message">(`prompt-${String(index)}`);

  const messages: readonly Message[] = [
    {
      id,
      turn,
      at: index,
      kind: "user",
      content: prompt,
      source: { kind: "user" },
      delivery: "queue",
      status: { kind: "landed", commit: asId<"commit">(id), run: null, replaced: null },
      siblings: { index: 0, count: 1, ids: [] },
    },
    {
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
    },
  ];

  return { messages, info: endedTurn([], { id: turn, prompt: id, steps: 1 }).info };
});

const view: SessionView = {
  revision: asId<"revision">("r1"),
  seenThrough: null,
  seq: asSeq(1),
  activation: { kind: "active" },
  messages: turns.flatMap((turn) => turn.messages),
  queue: [],
  leadingPrompt: null,
  parts: [],
  turns: turns.map((turn) => turn.info),
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

installConnection(
  scriptedConnection({
    sessions: [sessionRow(SESSION)],
    views: new Map([[SESSION, viewStream(view)]]),
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

/** Ctrl+Alt+Up walks back through the chat's prompts and stops at the oldest; Down returns to the draft. */
async function recallPrompts(editor: HTMLElement): Promise<void> {
  const reads = (text: string) =>
    until(() => (editor.innerText === text ? true : null), `the composer to read "${text}"`);

  editor.focus();
  document.execCommand("insertText", false, DRAFT);
  await reads(DRAFT);

  await until(() => sessionWatch(SESSION).value, "the chat's view");

  for (const shown of [PROMPTS[1], PROMPTS[0], PROMPTS[0]]) {
    press(editor, "ArrowUp", { ctrlKey: true, altKey: true });
    await reads(shown);
  }

  for (const shown of [PROMPTS[1], DRAFT]) {
    press(editor, "ArrowDown", { ctrlKey: true, altKey: true });
    await reads(shown);
  }
}

/** Ctrl+/ opens the model picker from the composer or from no field, and closing it returns to the composer. */
async function openModelPicker(region: HTMLElement, editor: HTMLElement): Promise<void> {
  const menu = () => document.querySelector("[role='menu']");
  const trigger = region.querySelector("button[aria-keyshortcuts]");

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

/** Ctrl+V with no field focused moves focus into the composer, where the paste lands. */
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
    await openModelPicker(region, editor);
    await pasteFromNowhere(editor);

    return "passed";
  } finally {
    flushSync(() => root.unmount());
    stage.remove();
  }
}
