/**
 * A create and the later wait on it are two calls on one child. The
 * transcript draws the child once: the create is the agent card, the await a
 * compact line that links to the same child. While the wait is live it is run
 * status, not a row: the cards say "Waiting" and the header counts down.
 */
import { afterAll, expect, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { sessionId } from "@nyte-ai/protocol";
import type { ParkedCall, SessionId, SessionInfo, ToolTurnPart, TurnPart } from "@nyte-ai/protocol";
import { SubagentInspectorProvider } from "./subagent-inspector.ts";
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

vi.hoisted(() => {
  const query = { matches: false, addEventListener: () => {}, removeEventListener: () => {} };
  vi.stubGlobal("window", {
    nyte: { host: { setThemePreference: () => {} } },
    matchMedia: () => query,
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
  startedAt: 1,
  durationMs: 0,
  parts: [
    {
      kind: "tool",
      callId: "task",
      class: { kind: "delegate", role: "create", target: { kind: "one", session: child } },
      result: { commit: "created", output: "Started Map the workbench", isError: false },
    },
    {
      kind: "tool",
      callId: "wait",
      class: {
        kind: "delegate",
        role: "await",
        target: { kind: "many", sessions: [child], mode: "all" },
      },
      result: { commit: "waited", output: "Three panels found.", isError: false },
    },
  ],
};

test("a create and its await draw one agent card and one compact line", () => {
  const client = new QueryClient();
  client.setQueryData(["sessions", "children", parent], [childSession]);
  const inspect = vi.fn();
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <SubagentInspectorProvider
        value={{ sessionId: parent, children: new Map([[child, childSession]]), inspect }}
      >
        <TurnView
          turn={turn}
          liveTools={new Map()}
          cwd={undefined}
          running={false}
          waits={NO_WAITS}
        />
      </SubagentInspectorProvider>
    </QueryClientProvider>,
  );
  client.clear();
  // The card is the only place the child's state is spelled out.
  expect(html.match(/>Completed</g)?.length).toBe(1);
  expect(html.match(/>Map the workbench</g)?.length).toBe(2);
  expect(html).toContain(">Waited for<");
  expect(html.match(/aria-label="Open Map the workbench in the Agents panel"/g)?.length).toBe(2);
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
  class: { kind: "delegate", role: "create", target: { kind: "one", session } },
  result: { commit: `created:${session}`, output: `Started ${session}`, isError: false },
});
const awaitAll: ToolTurnPart = {
  kind: "tool",
  callId: "wait-all",
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
      <SubagentInspectorProvider
        value={{
          sessionId: parent,
          children: new Map(children.map((session) => [session.sessionId, session])),
          inspect: vi.fn(),
        }}
      >
        <TurnView
          turn={{ kind: "turn", id: "turn", startedAt: 1, durationMs: 0, parts: [...parts] }}
          liveTools={new Map()}
          cwd={undefined}
          running={options.running}
          waits={liveWaits(parts, options.parked, options.running)}
        />
      </SubagentInspectorProvider>
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
  expect(html.match(/aria-label="Open Agent \w+ in the Agents panel"/g)?.length).toBe(4);
  expect(html.match(/>Waiting</g)?.length).toBe(4);
  expect(html).not.toContain(">Waiting for<");
  expect(html).toContain(">Waiting for subagents<");
  expect(html).toContain("· 1:23");
});

test("the settled await is the compact line, with no countdown", () => {
  const settled: ToolTurnPart = {
    ...awaitAll,
    result: { commit: "waited", output: "All four reported.", isError: false },
  };
  const html = render([...agents.map(createAgent), prose, settled], {
    running: true,
    parked: [],
  });
  expect(html.match(/>Waited for</g)?.length).toBe(1);
  expect(html).not.toContain(">Waiting for subagents<");
  expect(html).not.toContain(">Waiting<");
  expect(html).not.toContain("· ");
});

test("a live await on a child from an earlier turn keeps its line and counts down", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  const html = render([prose, awaitAll], { running: true, parked: [parkedWait] });
  vi.useRealTimers();
  expect(html.match(/>Waiting for</g)?.length).toBe(1);
  expect(html).toContain("· 1:23");
  expect(html).not.toContain(">Waiting for subagents<");
});
