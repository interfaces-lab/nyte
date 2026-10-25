import "../../test/window-bridge.ts";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterContextProvider } from "@tanstack/react-router";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import type { Message, ModelCatalogView, SessionId, SessionInfo, SessionView } from "@nyte-ai/sdk";
import { asId, asSeq } from "@nyte-ai/schema";
import type { HostState } from "../nyte.ts";
import { PaneControllerProvider } from "../layout/pane-context.tsx";
import { PaneController } from "../layout/pane-controller.ts";
import type { ScrollViewState } from "../layout/session-view-state.ts";
import { SessionDndProvider } from "../layout/session-dnd.tsx";
import { keys, queryClient } from "../queries.ts";
import { installConnection, sessionWatch } from "../sdk.tsx";
import { SessionScreen } from "./session-screen.tsx";
import { createAppRouter } from "../router.tsx";
import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import "../theme/tokens.stylex.ts";
import { scriptedConnection, viewStream } from "../../test/scripted-connection.ts";
import { COMPLETED, USAGE, endedTurn, sessionRow } from "../../test/view-fixtures.ts";

const TURNS = 24;

const [A, B, C, D] = ["warm-a", "warm-b", "warm-c", "warm-d"].map((id) => asId<"session">(id));

function view(session: string): SessionView {
  const messages: Message[] = [];
  const turns = [];

  for (let index = 1; index <= TURNS; index += 1) {
    const turn = asId<"turn">(`${session}-turn-${String(index)}`);
    const prompt = asId<"message">(`${session}-prompt-${String(index)}`);
    const answer = asId<"message">(`${session}-answer-${String(index)}`);
    messages.push(
      {
        id: prompt,
        turn,
        at: index,
        kind: "user",
        content: `Question ${String(index)} in ${session}`,
        source: { kind: "user" },
        delivery: "queue",
        status: { kind: "landed", commit: asId<"commit">(prompt), run: null, replaced: null },
        siblings: { index: 0, count: 1, ids: [] },
      },
      {
        id: answer,
        turn,
        at: index,
        kind: "part",
        part: asId<"part">(answer),
        partKind: "text",
        role: "answer",
        state: {
          markdown: `Answer ${String(index)}. ${"A sentence that fills the row. ".repeat(12)}`,
          signature: null,
        },
        version: 1,
        status: { kind: "settled", commit: asId<"commit">(answer), endedAt: index },
      },
    );
    turns.push(endedTurn([], { id: turn, prompt, steps: 2 }).info);
  }

  return {
    revision: asId<"revision">("r1"),
    seq: asSeq(1),
    activation: { kind: "active" },
    messages,
    queue: [],
    leadingPrompt: null,
    parts: [],
    turns,
    usage: USAGE,
    execution: COMPLETED,
    reportsHeld: false,
    background: [],
    configuration: { selected: null, effective: null },
    context: { tokens: 0, window: 1_000, lastRequest: null },
    heads: [],
    changes: [],
    catalog: { commands: [], settings: [], skills: [], agents: [], tools: [] },
  };
}

const listed = viewStream<readonly SessionInfo[]>([A, B, C, D].map((id) => sessionRow(id)));

installConnection(
  scriptedConnection({
    sessions: listed,
    views: new Map([A, B, C, D].map((id) => [id, [view(id)]])),
  }).connection,
);

const catalog = {
  generation: asId<"catalog-generation">("initial"),
  providers: [],
  default: { provider: "test", id: "test" },
} satisfies ModelCatalogView;

const host = { workspace: undefined } satisfies HostState;

const panes = new PaneController({ storageKey: "warm-sessions-test" });

let renderFailure: unknown;

function mount(container: HTMLElement): Root {
  queryClient.setQueryData(keys.host, host);
  queryClient.setQueryData(keys.modelCatalog("initial"), catalog);
  queryClient.setQueryData(keys.mentionFiles, []);

  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: ["/"] }) });

  const root = createRoot(container, {
    onUncaughtError: (error) => {
      renderFailure = error;
    },
  });

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

  return root;
}

async function until(predicate: () => boolean, what: string): Promise<void> {
  const deadline = performance.now() + 5_000;

  while (!predicate()) {
    if (renderFailure !== undefined) throw renderFailure;

    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 10));
  }
}

function painted(): Promise<void> {
  return new Promise((resolve) =>
    window.requestAnimationFrame(() => window.setTimeout(() => resolve(), 0)),
  );
}

interface Shown {
  readonly viewport: HTMLElement;
  readonly composer: HTMLElement;
  readonly editor: HTMLElement;
}

function findShown(container: HTMLElement, sessionId: SessionId): Shown | undefined {
  const viewport = Array.from(
    container.querySelectorAll<HTMLElement>("[aria-label='Messages']"),
  ).find((element) => element.checkVisibility());

  const editor = Array.from(
    container.querySelectorAll<HTMLElement>("[aria-multiline][aria-label='Message']"),
  ).find((element) => element.checkVisibility());

  const composer = editor?.closest<HTMLElement>("[data-composer-frame]");

  if (
    viewport === undefined ||
    editor === undefined ||
    composer === null ||
    composer === undefined ||
    viewport.querySelector(`[data-row-key*='${sessionId}-']`) === null
  )
    return undefined;

  return { viewport, composer, editor };
}

async function show(container: HTMLElement, sessionId: SessionId): Promise<Shown> {
  panes.selectSession(sessionId);
  let shown: Shown | undefined;
  await until(() => {
    shown = findShown(container, sessionId);

    return shown !== undefined;
  }, `session ${sessionId}`);
  await painted();

  if (shown === undefined) throw new Error(`Session ${sessionId} is not shown`);

  return shown;
}

async function type(editor: HTMLElement, text: string): Promise<void> {
  editor.focus();
  window.getSelection()?.collapse(editor, editor.childNodes.length);
  await painted();
  document.execCommand("insertText", false, text);
  await painted();
}

function readScroll(sessionId: SessionId): ScrollViewState | undefined {
  return panes.viewState.readSession(sessionId, "primary").scroll.primary;
}

const failures: string[] = [];

const consoleErrors: string[] = [];

const reportError = console.error.bind(console);

console.error = (...args: unknown[]): void => {
  consoleErrors.push(
    args.map((arg) => (arg instanceof Error ? (arg.stack ?? arg.message) : String(arg))).join(" "),
  );
  reportError(...args);
};

function expectRule(passed: boolean, message: string): void {
  if (!passed) failures.push(message);
}

async function checkRules(): Promise<string> {
  queryClient.clear();
  const container = document.createElement("div");
  container.style.cssText = "display:flex;width:900px;height:700px";
  document.body.append(container);
  const root = mount(container);

  try {
    const d = await show(container, D);
    const a = await show(container, A);
    expectRule(!d.viewport.checkVisibility(), "a hidden session stays visible");
    await type(a.editor, "Draft for A");
    a.viewport.scrollTop = 600;
    await painted();
    const aScrollTop = a.viewport.scrollTop;

    const b = await show(container, B);
    await painted();
    expectRule(sessionWatch(A).active, "a hidden hot session released its watch");
    const aSnapshot = readScroll(A);
    expectRule(
      aSnapshot?.kind === "anchor",
      `hiding a scrolled session wrote ${JSON.stringify(aSnapshot)}`,
    );

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
    expectRule(
      document.activeElement === b.editor,
      "typing focused a composer other than the shown one",
    );

    const back = await show(container, A);
    expectRule(back.viewport === a.viewport, "switching back remounted the transcript");
    expectRule(back.composer === a.composer, "switching back remounted the composer");
    expectRule(
      back.editor.textContent?.includes("Draft for A") === true,
      `switching back lost the draft: ${JSON.stringify(back.editor.textContent)}`,
    );
    expectRule(
      Math.abs(back.viewport.scrollTop - aScrollTop) <= 1,
      `switching back moved the scroll from ${String(aScrollTop)} to ${String(back.viewport.scrollTop)}`,
    );
    const bSnapshot = readScroll(B);
    expectRule(
      JSON.stringify(bSnapshot) === JSON.stringify({ kind: "end" }),
      `hiding a session at its end wrote ${JSON.stringify(bSnapshot)}`,
    );

    const dSnapshot = readScroll(D);
    await show(container, C);
    expectRule(!d.viewport.isConnected, "the least recent session stayed mounted");
    expectRule(!d.composer.isConnected, "the least recent composer stayed mounted");
    expectRule(readScroll(D) === dSnapshot, "evicting a hidden session wrote its scroll snapshot");
    expectRule(readScroll(B) === bSnapshot, "a hidden session wrote its scroll snapshot");
    expectRule(a.viewport.isConnected && b.viewport.isConnected, "a hot session was unmounted");
    await until(() => !sessionWatch(D).active, "the evicted session to release its watch");

    listed.push([A, C, D].map((id) => sessionRow(id)));
    await until(() => !b.viewport.isConnected, "the deleted hidden session to unmount");
    expectRule(!b.composer.isConnected, "a deleted hidden session kept its composer mounted");
    expectRule(a.viewport.isConnected, "deleting another session unmounted a hot one");

    expectRule(consoleErrors.length === 0, `console errors:\n${consoleErrors.join("\n")}`);

    return failures.length === 0 ? "passed" : failures.join("\n");
  } finally {
    flushSync(() => root.unmount());
    container.remove();
    queryClient.clear();
  }
}

export function run(): Promise<string> {
  const watchdog = new Promise<string>((resolve) =>
    window.setTimeout(() => resolve(`timed out\n${failures.join("\n")}`), 35_000),
  );

  return Promise.race([checkRules(), watchdog]);
}

applyDisplayMode("light");
