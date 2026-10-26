import "../../test/window-bridge.ts";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterContextProvider } from "@tanstack/react-router";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type {
  Configuration,
  Message,
  ModelCatalogView,
  RunView,
  SessionId,
  SessionView,
  TurnInfo,
} from "@nyte-ai/sdk";
import { asId, asSeq } from "@nyte-ai/schema";
import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import type { HostState } from "../nyte.ts";
import { PaneControllerProvider } from "../layout/pane-context.tsx";
import { PaneController } from "../layout/pane-controller.ts";
import { SessionDndProvider } from "../layout/session-dnd.tsx";
import { keys, queryClient } from "../queries.ts";
import { installConnection } from "../sdk.tsx";
import { SessionScreen } from "./session-screen.tsx";
import { createAppRouter } from "../router.tsx";
import "../theme/tokens.stylex.ts";
import { scriptedConnection, viewStream } from "../../test/scripted-connection.ts";
import type { ViewStream } from "../../test/scripted-connection.ts";
import { USAGE, endedTurn, sessionRow, settledTool } from "../../test/view-fixtures.ts";

const NAMES = ["alpha", "bravo", "charlie"] as const;

type Name = (typeof NAMES)[number];

const TURNS = 200;

const STREAM_MS = 16;

const LIVE_TOOLS = 60;

const ROUND_TRIP_MS = 300;

const ended: TurnInfo["state"] = { kind: "ended", end: { kind: "completed", usage: USAGE } };

const ANSWER = [
  "The change keeps the rows the transcript already holds and moves the cost out of the delta path.",
  "",
  "- the projector keys rows by message id",
  "- each row subscribes to its own content",
  "- the virtualizer keeps its measurements",
  "",
  "```ts",
  "export function project(view: SessionView): readonly Row[] {",
  "  return view.messages.map((message) => ({ key: message.id }));",
  "}",
  "```",
  "",
  "That leaves one row to render per token.",
].join("\n");

interface Chat {
  readonly id: SessionId;
  readonly name: Name;
  readonly stream: ViewStream;
  readonly settled: readonly Message[];
  readonly view: (live: string) => SessionView;
  live: string;
}

function chat(name: Name): Chat {
  const configuration: Configuration = {
    kind: "exact",
    model: { provider: "test", id: "test" },
    thinking: "off",
    agent: null,
    settings: {},
    settingsVersion: "1",
  };

  const run: RunView = {
    id: asId<"run">(`${name}-run`),
    head: asId<"head">("main"),
    startedAt: 0,
    attempt: 1,
    origin: { kind: "input", message: asId<"message">(`${name}-prompt-${String(TURNS)}`) },
  };

  const answer = (index: number, markdown: string, live: boolean): Message => ({
    id: asId<"message">(`${name}-answer-${String(index)}`),
    turn: asId<"turn">(`${name}-turn-${String(index)}`),
    at: index,
    kind: "part",
    part: asId<"part">(`${name}-answer-${String(index)}`),
    partKind: "text",
    role: "answer",
    state: { markdown, signature: null },
    version: 1,
    status: live
      ? { kind: "live", run: run.id }
      : {
          kind: "settled",
          commit: asId<"commit">(`${name}-answer-${String(index)}`),
          endedAt: index,
        },
  });

  const turns = Array.from({ length: TURNS }, (_, offset) => {
    const index = offset + 1;
    const live = index === TURNS;
    const turn = asId<"turn">(`${name}-turn-${String(index)}`);
    const file = `src/${name}-${String(index)}.ts`;

    const messages: Message[] = [
      {
        id: asId<"message">(`${name}-prompt-${String(index)}`),
        turn,
        at: index,
        kind: "user",
        content: `${name} question ${String(index)}`,
        source: { kind: "user" },
        delivery: "queue",
        status: {
          kind: "landed",
          commit: asId<"commit">(`${name}-prompt-${String(index)}`),
          run: null,
          replaced: null,
        },
        siblings: { index: 0, count: 1, ids: [] },
      },
      { ...settledTool(`${name}-read-${String(index)}`, { kind: "read", path: file }), turn },
      { ...settledTool(`${name}-edit-${String(index)}`, { kind: "edit", path: file }), turn },
      answer(index, ANSWER, false),
    ];

    const { info } = endedTurn([], {
      id: turn,
      prompt: asId<"message">(`${name}-prompt-${String(index)}`),
      run: live ? run.id : null,
      steps: messages.length,
      state: live ? { kind: "working", activity: null } : ended,
    });

    const work = Array.from({ length: LIVE_TOOLS }, (_, step) => ({
      ...settledTool(`${name}-work-${String(step)}`, { kind: "read", path: file }),
      turn,
    }));

    return { info, messages: live ? [...messages.slice(0, 1), ...work] : messages };
  });

  const settled = turns.flatMap((entry) => entry.messages);

  const base = {
    revision: asId<"revision">(`${name}-r1`),
    seq: asSeq(1),
    activation: { kind: "active" },
    queue: [],
    leadingPrompt: null,
    parts: [],
    turns: turns.map((entry) => entry.info),
    usage: USAGE,
    execution: { kind: "live", run, phase: "responding", stopping: false },
    reportsHeld: false,
    background: [],
    configuration: { selected: configuration, effective: configuration },
    context: { tokens: 0, window: 1_000, lastRequest: null },
    heads: [],
    changes: [],
    catalog: { commands: [], settings: [], skills: [], agents: [], tools: [] },
  } as const satisfies Omit<SessionView, "messages">;

  const view = (live: string): SessionView => ({
    ...base,
    messages: [...settled, answer(TURNS, live, true)],
  });

  return {
    id: asId<"session">(name),
    name,
    stream: viewStream(view("Streaming")),
    settled,
    view,
    live: "Streaming",
  };
}

const chats = new Map(NAMES.map((name) => [name, chat(name)]));

function find(name: Name): Chat {
  const found = chats.get(name);

  if (found === undefined) throw new Error(`No chat named ${name}`);

  return found;
}

function roundTrip(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ROUND_TRIP_MS));
}

function leadingPrompt(view: SessionView, start: number): SessionView["leadingPrompt"] {
  const turn = view.turns.find((info) => info.id === view.messages[start]?.turn);
  const at = view.messages.findIndex((message) => message.id === turn?.prompt);
  const prompt = at < 0 || at >= start ? undefined : view.messages[at];

  return prompt?.kind === "user" ? prompt : null;
}

installConnection(
  scriptedConnection({
    sessions: NAMES.map((name) => sessionRow(name, { name })),
    views: new Map([...chats.values()].map((entry) => [entry.id, entry.stream])),
    session: (id) => {
      const entry = [...chats.values()].find((candidate) => candidate.id === id);

      if (entry === undefined) return {};

      return {
        watch: async function* (options) {
          await roundTrip();

          const initial = entry.view(entry.live);

          const start = Math.max(
            0,
            initial.messages.length - (options?.tail ?? initial.messages.length),
          );

          const first = initial.turns.findIndex(
            (turn) => turn.id === initial.messages[start]?.turn,
          );

          const turns = initial.turns.slice(Math.max(0, first));

          for await (const view of entry.stream.watch())
            yield {
              ...view,
              messages: view.messages.slice(start),
              leadingPrompt: leadingPrompt(view, start),
              turns,
            };
        },
        history: async ({ before, limit }) => {
          await roundTrip();
          const view = entry.view(entry.live);
          const end = view.messages.findIndex((message) => message.id === before);
          const start = Math.max(0, end - limit);
          const messages = view.messages.slice(start, Math.max(0, end));
          const held = new Set(messages.map((message) => message.turn));

          return {
            messages,
            leadingPrompt: messages.length === 0 ? null : leadingPrompt(view, start),
            turns: view.turns.filter((turn) => held.has(turn.id)),
          };
        },
      };
    },
  }).connection,
);

const catalog = {
  generation: asId<"catalog-generation">("initial"),
  providers: [],
  default: { provider: "test", id: "test" },
} satisfies ModelCatalogView;

const host = { workspace: undefined } satisfies HostState;

function frame(): Promise<number> {
  return new Promise((resolve) => window.requestAnimationFrame(resolve));
}

function painted(): Promise<void> {
  return new Promise((resolve) =>
    window.requestAnimationFrame(() => window.setTimeout(() => resolve(), 0)),
  );
}

async function pause(ms: number): Promise<void> {
  const until = performance.now() + ms;

  while (performance.now() < until) await painted();
}

export async function run(): Promise<string> {
  queryClient.clear();
  queryClient.setQueryData(keys.host, host);
  queryClient.setQueryData(keys.modelCatalog("initial"), catalog);
  queryClient.setQueryData(keys.mentionFiles, []);
  const container = document.createElement("div");
  container.style.cssText = "display:flex;width:900px;height:700px";
  document.body.append(container);

  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [`/session/alpha`] }),
  });

  const root = createRoot(container);
  const panes = new PaneController({ storageKey: "session-switching-test" });
  panes.selectSession(find("alpha").id);

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

  const show = async (name: Name): Promise<number> => {
    const started = performance.now();
    const latest = `${find(name).live.split(" ").at(-1) ?? ""} `;
    panes.selectSession(find(name).id);

    for (;;) {
      const at = await frame();
      const text = container.innerText;

      if (text.includes(`${name} question ${String(TURNS)}`) && text.includes(latest))
        return at - started;

      if (performance.now() - started > 10_000) throw new Error(`Timed out showing ${name}`);
    }
  };

  let token = 0;

  const streaming = window.setInterval(() => {
    for (const entry of chats.values()) {
      token += 1;
      entry.live += ` token${String(token)}`;
      entry.stream.push(entry.view(entry.live));
    }
  }, STREAM_MS);

  try {
    let opening = 0;

    for (const name of NAMES) opening = Math.max(opening, await show(name));
    const gapShown = container.innerText.includes("Show Earlier Steps");

    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Show Earlier Steps")
      ?.click();

    const gapStarted = performance.now();

    while (
      container.innerText.includes("Show Earlier Steps") ||
      !container.innerText.includes(`charlie question ${String(TURNS)}`)
    ) {
      if (performance.now() - gapStarted > 10_000)
        throw new Error("The earlier steps never loaded");
      await frame();
    }

    const gapClosed = performance.now() - gapStarted;
    await pause(1_000);
    const switches: string[] = [];
    let slowest = 0;

    for (let round = 0; round < 3; round += 1) {
      for (const name of ["bravo", "alpha", "charlie"] as const) {
        const ms = await show(name);
        switches.push(`${name}:${ms.toFixed(0)}`);
        slowest = Math.max(slowest, ms);
      }

      await pause(500);
    }

    return JSON.stringify({
      opening,
      gapShown,
      gapClosed,
      switches,
      slowest,
      roundTrip: ROUND_TRIP_MS,
    });
  } finally {
    window.clearInterval(streaming);
    flushSync(() => root.unmount());
    container.remove();
    queryClient.clear();
  }
}

applyDisplayMode("light");
