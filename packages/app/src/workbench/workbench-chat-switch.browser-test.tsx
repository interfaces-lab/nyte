import "../conversation/transcript-render-counter.ts";
import "../../test/window-bridge.ts";
import "./panels.deferred.tsx";
import { CodeView } from "@pierre/diffs/react";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterContextProvider } from "@tanstack/react-router";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type {
  Configuration,
  FilesApi,
  Message,
  ModelCatalogView,
  RunView,
  SessionView,
} from "@nyte-ai/sdk";
import { SdkError } from "@nyte-ai/sdk";
import { asId, asSeq } from "@nyte-ai/schema";
import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import type { HostState } from "../nyte.ts";
import { mentionFile } from "../conversation/message-references.ts";
import { PaneControllerProvider } from "../layout/pane-context.tsx";
import { PaneController } from "../layout/pane-controller.ts";
import { SessionDndProvider } from "../layout/session-dnd.tsx";
import { keys, queryClient } from "../queries.ts";
import { installConnection } from "../sdk.tsx";
import { SessionScreen } from "../screens/session-screen.tsx";
import { createAppRouter } from "../router.tsx";
import "../theme/tokens.stylex.ts";
import { scriptedConnection, viewStream } from "../../test/scripted-connection.ts";
import type { ViewStream } from "../../test/scripted-connection.ts";
import { USAGE, endedTurn, sessionRow } from "../../test/view-fixtures.ts";
import { renderCount, resetRenders } from "../conversation/transcript-render-counter.ts";
import { ChangesPanel } from "./changes-panel.tsx";
import { ChangesToolbar } from "./changes-toolbar.tsx";
import { workbenchController, workbenchViewKey } from "./controller.ts";
import { TextFileEditor } from "./file-editor.tsx";
import { fileActions } from "./file-store.ts";
import { FilesPanel } from "./files-panel.tsx";
import { Workbench } from "./workbench.tsx";

const NAMES = ["alpha", "bravo", "charlie"] as const;

type Name = (typeof NAMES)[number];

const TURNS = 20;

const DELTAS = 60;

const STREAM_MS = 16;

const WORKSPACE = { id: asId<"workspace">("fixture"), path: "/repo", name: "repo" };

const FILE = mentionFile(WORKSPACE.path, { path: "src/large.ts", kind: "file" });

const CONTENTS = Array.from(
  { length: 5_000 },
  (_, line) => `export const value${String(line)} = ${String(line)};`,
).join("\n");

const WATCHED = {
  Workbench,
  FilesPanel,
  TextFileEditor,
  CodeView,
  ChangesPanel,
  ChangesToolbar,
} as const;

type Counts = Record<keyof typeof WATCHED, number>;

interface Chat {
  readonly name: Name;
  readonly stream: ViewStream;
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

    const prompt: Message = {
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
    };

    const { info } = endedTurn([], {
      id: turn,
      prompt: prompt.id,
      run: live ? run.id : null,
      steps: 2,
      state: live
        ? { kind: "working", activity: null }
        : { kind: "ended", end: { kind: "completed", usage: USAGE } },
    });

    return { info, messages: live ? [prompt] : [prompt, answer(index, `${name} answer`, false)] };
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

  return { name, stream: viewStream(view("Streaming")), view, live: "Streaming" };
}

const chats = new Map(NAMES.map((name) => [name, chat(name)]));

function find(name: Name): Chat {
  const found = chats.get(name);

  if (found === undefined) throw new Error(`No chat named ${name}`);

  return found;
}

const refuse = async (): Promise<never> => {
  throw new SdkError("unavailable", "Not scripted.");
};

const files: FilesApi = {
  read: async (path) => ({ kind: "text", path, contents: CONTENTS, version: asId("v1") }),
  bytes: refuse,
  stat: refuse,
  write: refuse,
  remove: refuse,
  batch: () => {
    throw new SdkError("unavailable", "Not scripted.");
  },
  format: refuse,
  scan: async function* () {
    yield {
      kind: "entries",
      entries: [{ path: "src/large.ts", kind: "file", size: 1, version: null }],
    };
    yield { kind: "complete" };
  },
  find: refuse,
  search: async function* () {
    yield { kind: "complete" };
  },
  watch: async function* () {
    yield* [];
    await new Promise<never>(() => undefined);
  },
  upload: refuse,
};

const { connection } = scriptedConnection({
  sessions: NAMES.map((name) => sessionRow(name, { name })),
  views: new Map([...chats.values()].map((entry) => [asId<"session">(entry.name), entry.stream])),
});

installConnection({
  ...connection,
  workspace: (id) => ({
    ...connection.workspace(id),
    files: async () => ({ kind: "available", api: files }),
    git: async () => ({ kind: "unsupported", reason: "Not a repository." }),
  }),
});

const catalog = {
  generation: asId<"catalog-generation">("initial"),
  providers: [],
  default: { provider: "test", id: "test" },
} satisfies ModelCatalogView;

const host = { workspace: WORKSPACE } satisfies HostState;

function painted(): Promise<void> {
  return new Promise((resolve) =>
    window.requestAnimationFrame(() => window.setTimeout(() => resolve(), 0)),
  );
}

async function pause(ms: number): Promise<void> {
  const until = performance.now() + ms;

  while (performance.now() < until) await painted();
}

async function until(condition: () => boolean, what: string): Promise<void> {
  const started = performance.now();

  while (!condition()) {
    if (performance.now() - started > 10_000) throw new Error(`Timed out waiting for ${what}`);
    await painted();
  }
}

function reset(): void {
  for (const component of Object.values(WATCHED)) resetRenders(component);
}

function counts(): Counts {
  const read = (component: (typeof WATCHED)[keyof typeof WATCHED]): number => {
    const { mounts, updates } = renderCount(component);

    return mounts + updates;
  };

  return {
    Workbench: read(Workbench),
    FilesPanel: read(FilesPanel),
    TextFileEditor: read(TextFileEditor),
    CodeView: read(CodeView),
    ChangesPanel: read(ChangesPanel),
    ChangesToolbar: read(ChangesToolbar),
  };
}

export async function run(): Promise<string> {
  queryClient.clear();
  queryClient.setQueryData(keys.host, host);
  queryClient.setQueryData(keys.modelCatalog("initial"), catalog);
  queryClient.setQueryData(keys.mentionFiles, [FILE]);
  queryClient.setQueryData(keys.workspaceFile(FILE.path), {
    kind: "text",
    path: FILE.path,
    contents: CONTENTS,
    version: asId<"file-version">("v1"),
  });
  const view = workbenchViewKey(WORKSPACE.path);
  workbenchController.actions.openTab({
    view,
    tab: {
      kind: "changes",
      scope: { kind: "thread" },
      selectedPath: null,
      pathRevealRevision: 0,
      scrollTop: 0,
    },
    activate: true,
  });
  fileActions.open(view, FILE);

  const container = document.createElement("div");
  container.style.cssText = "display:flex;width:1400px;height:800px";
  document.body.append(container);

  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [`/session/alpha`] }),
  });

  const root = createRoot(container);
  const panes = new PaneController({ storageKey: "workbench-chat-switch-test" });
  panes.selectSession(asId<"session">("alpha"));
  reset();

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

  const show = async (name: Name): Promise<void> => {
    panes.selectSession(asId<"session">(name));
    await until(
      () => container.innerText.includes(`${name} question ${String(TURNS)}`),
      `chat ${name}`,
    );
  };

  try {
    await until(() => renderCount(CodeView).mounts > 0, "the file editor");
    await until(() => renderCount(ChangesPanel).mounts > 0, "the changes panel");
    await until(() => container.innerText.includes(`alpha question ${String(TURNS)}`), "alpha");
    await pause(500);

    const switches: Counts[] = [];

    for (const name of ["bravo", "charlie", "alpha", "charlie", "bravo", "alpha"] as const) {
      reset();
      await show(name);
      await pause(200);
      switches.push(counts());
    }

    reset();
    const active = find("alpha");

    for (let delta = 1; delta <= DELTAS; delta += 1) {
      active.live += ` token${String(delta)}`;
      active.stream.push(active.view(active.live));
      await new Promise((resolve) => setTimeout(resolve, STREAM_MS));
    }

    await until(() => container.innerText.includes(`token${String(DELTAS)}`), "the last delta");
    await pause(200);

    return JSON.stringify({ switches, deltas: DELTAS, streaming: counts() });
  } finally {
    flushSync(() => root.unmount());
    container.remove();
    queryClient.clear();
  }
}

applyDisplayMode("light");
