import "./transcript-render-counter.ts";
import "../../test/window-bridge.ts";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterContextProvider } from "@tanstack/react-router";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { Message, ModelCatalogView, RunView, SessionView, TurnInfo } from "@nyte-ai/sdk";
import { asId, asSeq } from "@nyte-ai/schema";
import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import type { HostState } from "../nyte.ts";
import { PaneControllerProvider } from "../layout/pane-context.tsx";
import { SessionDndProvider } from "../layout/session-dnd.tsx";
import { keys, queryClient } from "../queries.ts";
import { installConnection } from "../sdk.tsx";
import { ThreadScreen } from "../screens/thread.tsx";
import { createAppRouter } from "../router.tsx";
import "../theme/tokens.stylex.ts";
import { scriptedConnection, viewStream } from "../../test/scripted-connection.ts";
import { USAGE, endedTurn, sessionRow, settledTool } from "../../test/view-fixtures.ts";
import { lastCommit, renderCount, resetRenders } from "./transcript-render-counter.ts";
import { TurnView } from "./turn-view.tsx";

const ID = asId<"session">("transcript-streaming");

/** Four messages a turn: 2,000 in the transcript. */
const TURNS = 500;

const DELTAS = 500;

const liveRun: RunView = {
  id: asId<"run">("live-run"),
  head: asId<"head">("main"),
  startedAt: 0,
  attempt: 1,
  configuration: {
    kind: "exact",
    model: { provider: "test", id: "test" },
    thinking: "off",
    agent: null,
    settings: {},
    settingsVersion: "1",
  },
  origin: { kind: "input", message: asId<"message">(`prompt-${String(TURNS)}`) },
};

const ended: TurnInfo["state"] = { kind: "ended", end: { kind: "completed", usage: USAGE } };

const turnId = (index: number) => asId<"turn">(`turn-${String(index)}`);

function prose(index: number, markdown: string, live: boolean): Message {
  return {
    id: asId<"message">(`answer-${String(index)}`),
    turn: turnId(index),
    at: index,
    kind: "part",
    part: asId<"part">(`answer-${String(index)}`),
    partKind: "text",
    role: "answer",
    state: { markdown, signature: null },
    version: 1,
    status: live
      ? { kind: "live", run: liveRun.id }
      : { kind: "settled", commit: asId<"commit">(`answer-${String(index)}`), endedAt: index },
  };
}

function turn(index: number) {
  const live = index === TURNS;
  const file = `src/file-${String(index)}.ts`;

  const messages: Message[] = [
    {
      id: asId<"message">(`prompt-${String(index)}`),
      turn: turnId(index),
      at: index,
      kind: "user",
      content: `Question ${String(index)}`,
      source: { kind: "user" },
      delivery: "queue",
      status: {
        kind: "landed",
        commit: asId<"commit">(`prompt-${String(index)}`),
        run: null,
        replaced: null,
      },
      siblings: { index: 0, count: 1, ids: [] },
    },
    { ...settledTool(`read-${String(index)}`, { kind: "read", path: file }), turn: turnId(index) },
    { ...settledTool(`edit-${String(index)}`, { kind: "edit", path: file }), turn: turnId(index) },
    prose(index, `Answer ${String(index)}. The transcript holds its rows.`, false),
  ];

  const { info } = endedTurn([], {
    id: turnId(index),
    prompt: asId<"message">(`prompt-${String(index)}`),
    run: live ? liveRun.id : null,
    steps: messages.length,
    state: live ? { kind: "working", activity: null } : ended,
  });

  return { info, messages: live ? messages.slice(0, 3) : messages };
}

const turns = Array.from({ length: TURNS }, (_, index) => turn(index + 1));

const settled = turns.flatMap((entry) => entry.messages);

const infos = turns.map((entry) => entry.info);

const unchanged = {
  revision: asId<"revision">("r1"),
  seq: asSeq(1),
  activation: { kind: "active" },
  parts: [],
  turns: infos,
  execution: { kind: "live", run: liveRun, phase: "responding", stopping: false },
  background: [],
  configuration: { selected: liveRun.configuration, effective: liveRun.configuration },
  context: { tokens: 0, window: 1_000, lastRequest: null },
  heads: [],
  changes: [],
  catalog: { commands: [], settings: [], skills: [], agents: [], tools: [] },
} as const satisfies Omit<SessionView, "messages">;

/** Each delta replaces the live answer only, as the fold does: everything else keeps its identity. */
function view(liveText: string): SessionView {
  return { ...unchanged, messages: [...settled, prose(TURNS, liveText, true)] };
}

let liveText = "Streaming";

const stream = viewStream(view(liveText));

installConnection(
  scriptedConnection({
    sessions: [sessionRow("transcript-streaming", { name: "Streaming" })],
    views: new Map([[ID, stream]]),
  }).connection,
);

const catalog = {
  generation: asId<"catalog-generation">("initial"),
  providers: [],
  default: { provider: "test", id: "test" },
} satisfies ModelCatalogView;

const host = { workspace: undefined, platform: "linux" } satisfies HostState;

function painted(): Promise<void> {
  return new Promise((resolve) =>
    window.requestAnimationFrame(() => window.setTimeout(() => resolve(), 0)),
  );
}

async function until(predicate: () => boolean, what: string): Promise<void> {
  const deadline = performance.now() + 10_000;

  while (!predicate()) {
    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await painted();
  }
}

/** Streams `DELTAS` deltas into a 2,000-message transcript and reports TurnView renders. */
export async function run(): Promise<string> {
  queryClient.clear();
  queryClient.setQueryData(keys.host, host);
  queryClient.setQueryData(keys.modelCatalog("initial"), catalog);
  queryClient.setQueryData(keys.mentionFiles, []);
  const container = document.createElement("div");
  container.style.cssText = "display:flex;width:900px;height:700px";
  document.body.append(container);

  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [`/session/${ID}`] }),
  });

  const root = createRoot(container);

  flushSync(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <RouterContextProvider router={router}>
          <TooltipProvider delay={0} closeDelay={0} timeout={0}>
            <PaneControllerProvider workspaceKey="transcript-streaming-test">
              <SessionDndProvider>
                <ThreadScreen routeSessionId={ID} />
              </SessionDndProvider>
            </PaneControllerProvider>
          </TooltipProvider>
        </RouterContextProvider>
      </QueryClientProvider>,
    ),
  );

  try {
    await until(
      () => container.textContent?.includes(`Question ${String(TURNS)}`) === true,
      "the last turn",
    );

    for (let index = 0; index < 10; index += 1) await painted();
    resetRenders(TurnView);
    let rendering = 0;

    for (let index = 0; index < DELTAS; index += 1) {
      liveText += ` delta ${String(index)}`;
      const pushed = performance.now();
      stream.push(view(liveText));
      await painted();
      rendering += lastCommit() - pushed;
    }

    const mounted = container.querySelectorAll("[data-message-id]").length;
    const counts = renderCount(TurnView);

    return JSON.stringify({
      deltas: DELTAS,
      mountedRows: mounted,
      turnViewUpdates: counts.updates,
      turnViewMounts: counts.mounts,
      updatesPerDelta: counts.updates / DELTAS,
      commitMsPerDelta: rendering / DELTAS,
    });
  } finally {
    flushSync(() => root.unmount());
    container.remove();
    queryClient.clear();
  }
}

applyDisplayMode("light");
