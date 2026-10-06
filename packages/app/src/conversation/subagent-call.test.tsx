import "../../test/web-bridge.ts";
import { afterAll, expect, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { sessionId } from "@nyte-ai/protocol";
import type { SessionInfo } from "@nyte-ai/protocol";
import { SubagentCallView } from "./subagent-call.tsx";
import { SubagentTray } from "./tray/agents.tsx";
import type { SubagentTrayView } from "./tray/agents.tsx";
import type { SubagentSession } from "./subagent-sessions.ts";
import { SubagentSessionsProvider } from "./subagent-sessions.ts";
import type { RenderedTurn } from "./transcript-rows.ts";
import { TurnView } from "./turn-view.tsx";

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
    documentElement: {
      classList: { toggle: () => {} },
      dataset: {},
      style: { setProperty: () => {} },
    },
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
  workspace: { kind: "local", id: "fixture", cwd: "/" },
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
      state: { kind: "success", commit: "created" },
      output: "Started Map the workbench",
    },
  ],
};

test("a create draws one agent card", () => {
  const client = new QueryClient();
  client.setQueryData(["sessions", "children", parent], [childSession]);

  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <SubagentSessionsProvider
        value={{ children: new Map([[child, childSession]]), open: () => {} }}
      >
        <TurnView
          turn={turn}
          continuations={[]}
          liveTools={new Map()}
          cwd={undefined}
          onOpenChanges={() => {}}
          running={false}
        />
      </SubagentSessionsProvider>
    </QueryClientProvider>,
  );

  client.clear();
  expect(html.match(/>Completed</g)?.length).toBe(1);
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
            state={{ kind: "running" }}
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
