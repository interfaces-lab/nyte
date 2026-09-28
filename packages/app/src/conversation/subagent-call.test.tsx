/**
 * A create and the later wait on it are two calls on one child. The
 * transcript draws the child once, as the agent card. A wait on carded
 * children draws nothing: while live it is run status, the header naming what
 * the run waits on and counting down; once settled the cards already say how
 * each child ended. Only a wait on children carded elsewhere keeps a line.
 */
import { afterAll, expect, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { sessionId } from "@nyte-ai/protocol";
import type { ParkedCall, SessionId, SessionInfo, ToolTurnPart, TurnPart } from "@nyte-ai/protocol";
import { SubagentCallView } from "./subagent-call.tsx";
import { SubagentTray } from "./tray/agents.tsx";
import type { SubagentTrayView } from "./tray/agents.tsx";
import type { SubagentSession } from "./subagent-sessions.ts";
import { SubagentSessionsProvider } from "./subagent-sessions.ts";
import { NO_WAITS, liveWaits } from "./transcript-presentation.ts";
import type { RenderedTurn } from "./transcript-rows.ts";
import { TurnView } from "./turn-view.tsx";

vi.mock("../outbox-storage.ts", () => ({
  createIndexedDbOutboxStorage: () => ({
    load: async () => [],
    put: async () => undefined,
    remove: async () => undefined,
  }),
}));

vi.mock("../nyte.ts", () => ({ nyte: { host: { setThemePreference: () => {} } } }));

vi.hoisted(() => {
  const query = { matches: false, addEventListener: () => {}, removeEventListener: () => {} };
  vi.stubGlobal("window", {
    matchMedia: () => query,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  const styleHost = { insertBefore: () => {}, appendChild: () => {}, firstChild: null };
  vi.stubGlobal("document", {
    documentElement: { dataset: {}, style: { setProperty: () => {} } },
    getElementsByTagName: () => [styleHost],
    createElement: () => ({ setAttribute: () => {}, appendChild: () => {}, textContent: "" }),
    createTextNode: (text: string) => ({ text }),
    head: styleHost,
  });
});
afterAll(() => vi.unstubAllGlobals());

const parent = sessionId("chat");
const child = sessionId("child");
const childSession: SessionInfo = {
  sessionId: child,
  activation: { kind: "active" },
  name: "Map the workbench",
  createdAt: 1,
  lastActivityAt: 2,
  pinned: false,
  archived: false,
  heads: [
    {
      head: "main",
      tip: null,
      run: {
        runId: "child-run",
        head: "main",
        origin: { kind: "user" },
        root: "child-run",
        phase: { kind: "done" },
        startedAt: 1,
        attempts: 1,
        config: {},
      },
    },
  ],
  config: {},
  parent: { sessionId: parent, runId: "run", callId: "task", depth: 1 },
};

const turn: RenderedTurn = {
  kind: "turn",
  id: "turn",
  run: { kind: "none" },
  startedAt: 1,
  durationMs: 0,
  parts: [
    {
      kind: "tool",
      callId: "task",
      at: 1,
      class: {
        kind: "delegate",
        role: "create",
        title: "Map the workbench",
        target: { kind: "one", session: child },
      },
      result: { commit: "created", output: "Started Map the workbench", isError: false },
    },
    {
      kind: "tool",
      callId: "wait",
      at: 1,
      class: {
        kind: "delegate",
        role: "await",
        target: { kind: "many", sessions: [child], mode: "all" },
      },
      result: { commit: "waited", output: "Three panels found.", isError: false },
    },
  ],
};

test("a create draws one agent card and its settled await draws nothing", () => {
  const client = new QueryClient();
  client.setQueryData(["sessions", "children", parent], [childSession]);
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <SubagentSessionsProvider
        value={{ children: new Map([[child, childSession]]), open: () => {} }}
      >
        <TurnView
          turn={turn}
          liveTools={new Map()}
          cwd={undefined}
          onOpenChanges={() => {}}
          running={false}
          waits={NO_WAITS}
        />
      </SubagentSessionsProvider>
    </QueryClientProvider>,
  );
  client.clear();
  expect(html.match(/>Completed</g)?.length).toBe(1);
  expect(html).not.toContain(">Waited on<");
});

const agents = [
  sessionId("north"),
  sessionId("south"),
  sessionId("east"),
  sessionId("west"),
] satisfies readonly [SessionId, ...SessionId[]];
const createAgent = (session: (typeof agents)[number]): ToolTurnPart => ({
  kind: "tool",
  callId: `create:${session}`,
  at: 1,
  class: {
    kind: "delegate",
    role: "create",
    title: `Agent ${session}`,
    target: { kind: "one", session },
  },
  result: { commit: `created:${session}`, output: `Started ${session}`, isError: false },
});
const awaitAll: ToolTurnPart = {
  kind: "tool",
  callId: "wait-all",
  at: 1,
  class: {
    kind: "delegate",
    role: "await",
    target: { kind: "many", sessions: agents, mode: "all" },
  },
};
const parkedWait: ParkedCall = {
  runId: "run",
  callId: "wait-all",
  waitId: "wait-1",
  tool: "await",
  args: { agents: [...agents], mode: "all", timeoutMs: 83_000 },
  until: 1_083_000,
};
const prose: TurnPart = {
  kind: "assistant",
  commit: "a",
  contentIndex: 0,
  text: "Four agents are mapping the panels.",
  at: 1,
};
const workingRun = { ...childSession.heads[0]?.run, phase: { kind: "tools" } } as const;

function render(
  parts: readonly TurnPart[],
  options: { readonly running: boolean; readonly parked: readonly ParkedCall[] },
): string {
  const client = new QueryClient();
  client.setQueryData(
    ["sessions", "children", parent],
    agents.map((session) => ({
      ...childSession,
      sessionId: session,
      name: `Agent ${session}`,
      heads: [{ head: "main", tip: null, run: workingRun }],
    })),
  );
  const children =
    client.getQueryData<readonly SessionInfo[]>(["sessions", "children", parent]) ?? [];
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <SubagentSessionsProvider
        value={{
          children: new Map(children.map((session) => [session.sessionId, session])),
          open: () => {},
        }}
      >
        <TurnView
          turn={{
            kind: "turn",
            id: "turn",
            run: { kind: "none" },
            startedAt: 1,
            durationMs: 0,
            parts: [...parts],
          }}
          liveTools={new Map()}
          cwd={undefined}
          onOpenChanges={() => {}}
          running={options.running}
          waits={liveWaits(parts, options.parked, options.running)}
        />
      </SubagentSessionsProvider>
    </QueryClientProvider>,
  );
  client.clear();
  return html;
}

test("a live await on agents created in the turn is run status, not a row", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  const html = render([...agents.map(createAgent), prose, awaitAll], {
    running: true,
    parked: [parkedWait],
  });
  vi.useRealTimers();
  expect(html.match(/>Planning next moves</g)?.length).toBe(4);
  expect(html.match(/>Waiting on</g)?.length).toBe(1);
  expect(html).toContain(">4 agents<");
  expect(html).toContain("· 1:23");
});

test("a settled await on carded agents draws nothing", () => {
  const settled: ToolTurnPart = {
    ...awaitAll,
    result: { commit: "waited", output: "All four reported.", isError: false },
  };
  const html = render([...agents.map(createAgent), prose, settled], {
    running: true,
    parked: [],
  });
  expect(html).not.toContain(">Waited on<");
  expect(html).not.toContain(">Waiting on<");
  expect(html).not.toContain("· ");
});

test("a live await on children from an earlier turn is run status too", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  const html = render([prose, awaitAll], { running: true, parked: [parkedWait] });
  vi.useRealTimers();
  expect(html.match(/>Waiting on</g)?.length).toBe(1);
  expect(html).toContain(">4 agents<");
  expect(html.match(/· 1:23/g)?.length).toBe(1);
});

for (const kind of ["list", "detail"] as const) {
  test(`a provisional agent is starting and has no stop action in ${kind}`, () => {
    const client = new QueryClient();
    const provisional: SubagentSession = {
      kind: "provisional",
      sessionId: child,
      title: "Map the workbench",
      startedAt: 1,
    };
    const view: SubagentTrayView =
      kind === "list"
        ? { kind: "list", retainedSessionId: child }
        : { kind: "detail", sessionId: child };
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <SubagentSessionsProvider
          value={{ children: new Map([[child, provisional]]), open: () => {} }}
        >
          <SubagentCallView
            session={child}
            title={provisional.title}
            phase="running"
            density="detailed"
            cwd={undefined}
          />
          <SubagentTray
            parentSessionId={parent}
            agents={[provisional]}
            view={view}
            onViewChange={() => {}}
            onExpand={() => {}}
            onRelease={() => {}}
            viewport={null}
            detail={null}
          />
        </SubagentSessionsProvider>
      </QueryClientProvider>,
    );
    client.clear();
    expect(html.match(/>Starting up</g)?.length).toBe(1);
    expect(html.match(/>Starting</g)?.length ?? 0).toBe(kind === "list" ? 1 : 0);
    expect(html).not.toContain(">Planning next moves<");
    expect(html).not.toContain(">Stop<");
    expect(html).not.toContain(">Stop all<");
  });
}
