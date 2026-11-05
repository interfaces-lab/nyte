import "../../test/window-bridge.ts";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterContextProvider } from "@tanstack/react-router";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type {
  Execution,
  Message,
  ModelCatalogView,
  RunView,
  SessionId,
  SessionInfo,
  SessionView,
} from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import "../theme/tokens.stylex.ts";
import { installScripted, scriptedConnection, viewStream } from "../../test/scripted-connection.ts";
import { COMPLETED, endedTurn, sessionRow, sessionView } from "../../test/view-fixtures.ts";
import { tabPanes } from "../../test/panes.ts";
import type { HostState } from "../contract/nyte.ts";
import { keys, queryClient } from "../data/query-client.ts";
import { createAppRouter } from "../shell/routes.tsx";
import type { SplitDirection } from "./layout.ts";
import { LayoutView } from "./layout-view.tsx";
import { PaneControllerProvider } from "./pane-context.tsx";
import { renderPaneContent } from "./pane-views.tsx";
import { SessionDndProvider } from "./session-dnd.tsx";

const TURNS = 12;

/** The 620px desktop window's split-down pane, about 176px above its composer. */
const LAYOUT = { width: 780, height: 580 };

const RUN: RunView = {
  id: asId<"run">("split-run"),
  head: asId<"head">("main"),
  startedAt: 0,
  attempt: 1,
  origin: { kind: "input", message: asId<"message">("split-working-prompt-12") },
};

const LIVE: Execution = { kind: "live", run: RUN, phase: "responding", stopping: false };

const [FIRST, SECOND, WORKING] = ["split-first", "split-second", "split-working"].map((id) =>
  asId<"session">(id),
);

function view(session: SessionId, working: boolean): SessionView {
  const messages: Message[] = [];
  const turns = [];

  for (let index = 1; index <= TURNS; index += 1) {
    const turn = asId<"turn">(`${session}-turn-${String(index)}`);
    const prompt = asId<"message">(`${session}-prompt-${String(index)}`);
    const answer = asId<"message">(`${session}-answer-${String(index)}`);
    const live = working && index === TURNS;
    messages.push(
      {
        id: prompt,
        turn,
        at: index,
        kind: "user",
        content: `Question ${String(index)} in ${session}`,
        source: { kind: "user" },
        delivery: "queue",
        status: {
          kind: "landed",
          commit: asId<"commit">(prompt),
          run: live ? RUN.id : null,
          replaced: null,
        },
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
          markdown: `Answer ${String(index)}. ${"A sentence that fills the row. ".repeat(20)}`,
          signature: null,
        },
        version: 1,
        status: live
          ? { kind: "live", run: RUN.id }
          : { kind: "settled", commit: asId<"commit">(answer), endedAt: index },
      },
    );

    if (!live) turns.push(endedTurn([], { id: turn, prompt, steps: 2 }).info);
  }

  return sessionView({ messages, turns, execution: working ? LIVE : COMPLETED });
}

installScripted(
  scriptedConnection({
    sessions: viewStream<readonly SessionInfo[]>([
      sessionRow(FIRST),
      sessionRow(SECOND),
      sessionRow(WORKING, {}, LIVE),
    ]),
    views: new Map(
      [FIRST, SECOND, WORKING].map((id) => [id, viewStream(view(id, id === WORKING))] as const),
    ),
  }),
);

const catalog = {
  generation: asId<"catalog-generation">("initial"),
  providers: [],
  default: { provider: "test", id: "test" },
} satisfies ModelCatalogView;

const host = { workspace: undefined } satisfies HostState;

function painted(): Promise<void> {
  return new Promise((resolve) =>
    window.requestAnimationFrame(() => window.setTimeout(() => resolve(), 0)),
  );
}

async function until(predicate: () => boolean, what: string): Promise<void> {
  const deadline = performance.now() + 10_000;

  while (!predicate()) {
    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 10));
  }
}

function transcripts(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[aria-label='Messages']"));
}

/** How far the pane sits from its end, and how much of the room above its composer the conversation fills. */
function readEnd(scroller: HTMLElement) {
  const top = scroller.getBoundingClientRect().top;
  const floor = scroller.closest("section")?.querySelector("[data-composer-frame]");

  const last = Array.from(scroller.querySelectorAll<HTMLElement>("[data-row-key]"))
    .filter((row) => row.innerText.trim() !== "")
    .toSorted((first, second) => Number(second.dataset.index) - Number(first.dataset.index))[0];

  const bottom = floor?.getBoundingClientRect().top ?? scroller.getBoundingClientRect().bottom;

  return {
    distance: Math.round(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop),
    room: Math.round(bottom - top),
    conversation: Math.round(
      Math.max(0, Math.min(last?.getBoundingClientRect().bottom ?? top, bottom) - top),
    ),
    live: scroller.querySelector("[data-row-key='row:live'] [aria-busy]") !== null,
  };
}

async function journey(name: string, split: SplitDirection | null, second: SessionId) {
  queryClient.clear();
  queryClient.setQueryData(keys.host, host);
  queryClient.setQueryData(keys.modelCatalog("initial"), catalog);
  queryClient.setQueryData(keys.mentionFiles(undefined), []);

  const panes = tabPanes();
  panes.selectSession(FIRST);
  const container = document.createElement("div");
  container.style.cssText = `display:flex;width:${String(LAYOUT.width)}px;height:${String(LAYOUT.height)}px`;
  document.body.append(container);
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: ["/"] }) });
  const root = createRoot(container);

  flushSync(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <RouterContextProvider router={router}>
          <TooltipProvider delay={0} closeDelay={0} timeout={0}>
            <PaneControllerProvider controller={panes}>
              <SessionDndProvider>
                <LayoutView store={panes.store} renderTab={renderPaneContent} />
              </SessionDndProvider>
            </PaneControllerProvider>
          </TooltipProvider>
        </RouterContextProvider>
      </QueryClientProvider>,
    ),
  );

  try {
    const count = split === null ? 1 : 2;
    await until(
      () => transcripts(container)[0]?.querySelector("[data-row-key]") !== null,
      "the first transcript",
    );

    for (let frame = 0; frame < 10; frame += 1) await painted();

    if (split !== null) {
      panes.split(split);
      panes.selectSession(second);
    }

    await until(
      () =>
        transcripts(container).length === count &&
        transcripts(container).every((element) => element.querySelector("[data-row-key]") !== null),
      "every transcript",
    );

    for (let frame = 0; frame < 20; frame += 1) await painted();
    window.rendererCapture(name);
    await new Promise((resolve) =>
      document.addEventListener("renderer-captured", resolve, { once: true }),
    );

    return { name, panes: transcripts(container).map(readEnd) };
  } finally {
    flushSync(() => root.unmount());
    container.remove();
    queryClient.clear();
  }
}

export async function run(): Promise<string> {
  const results = [
    await journey("single", null, FIRST),
    await journey("down", "down", SECOND),
    await journey("down-working", "down", WORKING),
    await journey("right", "right", SECOND),
  ];

  return JSON.stringify(results);
}

applyDisplayMode("light");
