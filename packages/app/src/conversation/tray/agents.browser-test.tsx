import "../../../test/window-bridge.ts";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterContextProvider } from "@tanstack/react-router";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { Message, ModelCatalogView, RunView, SessionView } from "@nyte-ai/sdk";
import { asId, asSeq } from "@nyte-ai/schema";
import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import type { HostState } from "../../nyte.ts";
import { PaneControllerProvider } from "../../layout/pane-context.tsx";
import { PaneController } from "../../layout/pane-controller.ts";
import { activePane } from "../../layout/pane-layout.ts";
import { SessionDndProvider } from "../../layout/session-dnd.tsx";
import { keys, queryClient } from "../../queries.ts";
import { installConnection } from "../../sdk.tsx";
import { SessionScreen } from "../../screens/session-screen.tsx";
import { createAppRouter } from "../../router.tsx";
import "../../theme/tokens.stylex.ts";
import "../../theme/global.css";
import { scriptedConnection, viewStream } from "../../../test/scripted-connection.ts";
import {
  COMPLETED,
  USAGE,
  endedTurn,
  sessionRow,
  settledTool,
} from "../../../test/view-fixtures.ts";

const PARENT = asId<"session">("parent");

const READS = 24;

const AGENTS = [
  { key: "core", title: "Map the core" },
  { key: "app", title: "Map the app" },
] as const;

type AgentKey = (typeof AGENTS)[number]["key"];

function latest(key: AgentKey): string {
  return `Reporting on ${key}:`;
}

function agentRun(key: string): RunView {
  return {
    id: asId<"run">(`${key}-run`),
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
    origin: { kind: "input", message: asId<"message">(`${key}-prompt`) },
  };
}

function part(
  key: string,
  id: string,
  at: number,
  live: boolean,
  content:
    | { readonly partKind: "text"; readonly markdown: string }
    | { readonly partKind: "thinking"; readonly markdown: string },
): Message {
  const shared = {
    id: asId<"message">(`${key}-${id}`),
    turn: asId<"turn">(`${key}-turn`),
    at,
    kind: "part",
    part: asId<"part">(`${key}-${id}`),
    version: 1,
    status: live
      ? ({ kind: "live", run: asId<"run">(`${key}-run`) } as const)
      : ({ kind: "settled", commit: asId<"commit">(`${key}-${id}`), endedAt: at } as const),
  } as const;

  return content.partKind === "text"
    ? {
        ...shared,
        partKind: "text",
        role: "answer",
        state: { markdown: content.markdown, signature: null },
      }
    : {
        ...shared,
        partKind: "thinking",
        role: "step",
        state: { markdown: content.markdown, merged: 1, signature: null },
      };
}

function view(
  key: string,
  messages: readonly Message[],
  running: boolean,
  prompt: string,
): SessionView {
  const turn = asId<"turn">(`${key}-turn`);
  const promptId = asId<"message">(`${key}-prompt`);

  return {
    revision: asId<"revision">(`${key}-r1`),
    seq: asSeq(1),
    activation: { kind: "active" },
    queue: [],
    leadingPrompt: null,
    parts: [],
    messages: [
      {
        id: promptId,
        turn,
        at: 0,
        kind: "user",
        content: prompt,
        source: { kind: "user" },
        delivery: "queue",
        status: { kind: "landed", commit: asId<"commit">(promptId), run: null, replaced: null },
        siblings: { index: 0, count: 1, ids: [] },
      },
      ...messages,
    ],
    turns: [
      endedTurn([], {
        id: turn,
        prompt: promptId,
        run: running ? asId<"run">(`${key}-run`) : null,
        steps: messages.length + 1,
        state: running
          ? { kind: "working", activity: null }
          : { kind: "ended", end: { kind: "completed", usage: USAGE } },
      }).info,
    ],
    usage: USAGE,
    execution: running
      ? { kind: "live", run: agentRun(key), phase: "responding", stopping: false }
      : COMPLETED,
    reportsHeld: false,
    background: [],
    configuration: {
      selected: agentRun(key).configuration,
      effective: agentRun(key).configuration,
    },
    context: { tokens: 0, window: 1_000, lastRequest: null },
    heads: [],
    changes: [],
    catalog: { commands: [], settings: [], skills: [], agents: [], tools: [] },
  };
}

function answer(key: AgentKey, live: string): Message {
  return part(key, "answer", READS + 3, true, {
    partKind: "text",
    markdown: `${latest(key)} the lease is read in one place, so I'm inlining it.${live}`,
  });
}

function agentView(key: AgentKey): SessionView {
  const reads = Array.from({ length: READS }, (_, index) => ({
    ...settledTool(`${key}-read-${String(index)}`, {
      kind: "read",
      path: `packages/${key}/src/file-${String(index)}.ts`,
    }),
    turn: asId<"turn">(`${key}-turn`),
    at: index + 3,
  }));

  return view(
    key,
    [
      part(key, "opening", 1, false, {
        partKind: "text",
        markdown: "I'll start by reading the project guidelines and the files involved.",
      }),
      part(key, "plan", 2, false, {
        partKind: "thinking",
        markdown: "Weighing where the constant should live. ".repeat(12),
      }),
      ...reads,
      answer(key, ""),
    ],
    true,
    `Trace the ${key} and report back.`,
  );
}

const agents = AGENTS.map((agent) => {
  const call = settledTool(
    `call-${agent.key}`,
    { kind: "delegate", child: asId<"session">(agent.key), role: "create", title: agent.title },
    "Started subagent.",
  );

  return {
    ...agent,
    call: { ...call, turn: asId<"turn">("parent-turn") },
    row: sessionRow(
      agent.key,
      { name: agent.title, parent: PARENT, call: call.state.call },
      { kind: "live", run: agentRun(agent.key), phase: "responding", stopping: false },
    ),
    stream: viewStream(agentView(agent.key)),
  };
});

const parent = viewStream(
  view(
    "parent",
    [
      ...agents.map((agent) => agent.call),
      part("parent", "answer", 9, false, {
        partKind: "text",
        markdown: "Two agents are working in the background.",
      }),
    ],
    false,
    "yeah wait for me on 1",
  ),
);

installConnection(
  scriptedConnection({
    sessions: agents.map((agent) => agent.row),
    views: new Map([
      [PARENT, parent] as const,
      ...agents.map((agent) => [asId<"session">(agent.key), agent.stream] as const),
    ]),
  }).connection,
);

const catalog = {
  generation: asId<"catalog-generation">("initial"),
  providers: [],
  default: { provider: "test", id: "test" },
} satisfies ModelCatalogView;

const host = { workspace: undefined } satisfies HostState;

interface Recording {
  readonly commits: readonly string[];
  readonly frames: readonly { readonly tray: string; readonly opacity: string }[];
}

function readTray(container: HTMLElement): string {
  const tray = container.querySelector("section[data-slot='tray']");

  if (tray === null) return "none";

  if (tray.firstElementChild?.hasAttribute("inert") === true) return "closing";

  if (tray.querySelector("[aria-label='Open as full chat']") === null) return "list";
  const messages = tray.querySelector("[role='region'][aria-label='Messages']");

  if (messages === null) return "shell";
  const shown = AGENTS.find((entry) => messages.textContent.includes(latest(entry.key)));

  return shown === undefined ? "loading" : `chat:${shown.key}`;
}

function frame(): Promise<number> {
  return new Promise((resolve) => window.requestAnimationFrame(resolve));
}

async function until(read: () => boolean, what: string): Promise<void> {
  const started = performance.now();

  while (!read()) {
    if (performance.now() - started > 5_000) throw new Error(`Timed out waiting for ${what}`);
    await frame();
  }
}

function button(scope: ParentNode, name: string): HTMLButtonElement {
  const found = [...scope.querySelectorAll("button")].find(
    (candidate) =>
      candidate.getAttribute("aria-label") === name || candidate.textContent.startsWith(name),
  );

  if (found === undefined) throw new Error(`No button ${name}`);

  return found;
}

async function record(
  container: HTMLElement,
  act: () => void,
  settled: string,
): Promise<Recording> {
  const commits = [readTray(container)];
  const frames: { readonly tray: string; readonly opacity: string }[] = [];

  const observer = new MutationObserver(() => {
    const tray = readTray(container);

    if (commits.at(-1) !== tray) commits.push(tray);
  });

  observer.observe(container, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true,
  });
  act();

  while (frames.at(-1)?.tray !== settled) {
    if (frames.length > 300) throw new Error(`Timed out waiting for ${settled}`);
    await frame();
    const tray = container.querySelector("section[data-slot='tray']");

    frames.push({
      tray: readTray(container),
      opacity: tray === null ? "" : getComputedStyle(tray).opacity,
    });
  }

  observer.disconnect();

  return { commits, frames };
}

function opensWhole(recording: Recording, from: string, to: string): boolean {
  return (
    !recording.commits.includes("shell") &&
    recording.frames.every(
      (entry) => entry.tray === from || (entry.tray === to && entry.opacity === "1"),
    )
  );
}

export async function run(): Promise<string> {
  queryClient.clear();
  queryClient.setQueryData(keys.host, host);
  queryClient.setQueryData(keys.modelCatalog("initial"), catalog);
  queryClient.setQueryData(keys.mentionFiles, []);
  const container = document.createElement("div");
  container.style.cssText = "display:flex;width:900px;height:760px";
  document.body.append(container);

  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [`/session/${PARENT}`] }),
  });

  const root = createRoot(container);
  const panes = new PaneController({ storageKey: "agents-tray-test" });
  panes.selectSession(PARENT);

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

  let token = 0;

  const streaming = window.setInterval(() => {
    token += 1;

    for (const agent of agents) {
      const current = agent.stream.latest();

      if (current !== undefined)
        agent.stream.push({
          ...current,
          seq: asSeq(token + 1),
          messages: [
            ...current.messages.slice(0, -1),
            answer(agent.key, ` token${String(token)}`.repeat(token % 40)),
          ],
        });
    }
  }, 25);

  const transcript = (): Element | null =>
    container.querySelector("[role='region'][aria-label='Messages']");

  const card = (title: string): HTMLButtonElement => {
    const scope = transcript();

    if (scope === null) throw new Error("No transcript");

    return button(scope, title);
  };

  await until(
    () =>
      AGENTS.every((agent) => transcript()?.textContent.includes(agent.title) === true) &&
      container.querySelector("[aria-busy='true']") === null,
    "the agent cards",
  );
  await new Promise((resolve) => window.setTimeout(resolve, 500));

  const opened = await record(container, () => card("Map the core").click(), "chat:core");

  if (!opensWhole(opened, "none", "chat:core"))
    return `Opening an agent showed its tray before its chat: ${JSON.stringify(opened)}`;

  const back = await record(container, () => button(container, "Back to agents").click(), "list");

  if (back.frames.length !== 1) return `Back to agents took a frame: ${JSON.stringify(back)}`;

  const switched = await record(
    container,
    () => button(container, "Open Map the app").click(),
    "chat:app",
  );

  if (!opensWhole(switched, "list", "chat:app"))
    return `Switching agents showed an empty tray: ${JSON.stringify(switched)}`;

  await record(container, () => button(container, "Close agents").click(), "none");
  await record(container, () => card("Map the core").click(), "chat:core");
  button(container, "Open as full chat").click();
  await until(() => {
    const selection = activePane(panes.getSnapshot().layout).selection;

    return (
      selection.kind === "session" &&
      selection.sessionId === asId<"session">("core") &&
      readTray(container) === "none" &&
      transcript()?.textContent.includes(latest("core")) === true
    );
  }, "the agent's chat in the pane");

  window.clearInterval(streaming);
  flushSync(() => root.unmount());
  container.remove();
  queryClient.clear();

  return "passed";
}

applyDisplayMode("light");
