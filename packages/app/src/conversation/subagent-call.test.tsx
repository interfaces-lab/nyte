import "../../test/web-bridge.ts";
import { afterAll, expect, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionInfo } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { SubagentCallView } from "./subagent-call.tsx";
import { SubagentTray } from "./tray/agents.tsx";
import type { SubagentTrayView } from "./tray/agents.tsx";
import type { SubagentSession } from "./subagent-sessions.ts";
import { SubagentSessionsProvider } from "./subagent-sessions.ts";
import { TurnView } from "./turn-view.tsx";
import { endedTurn, sessionRow, settledTool } from "../../test/view-fixtures.ts";

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

const parent = asId<"session">("chat");

const child = asId<"session">("child");

const childSession: SessionInfo = sessionRow("child", { name: "Map the workbench", parent });

const create = settledTool(
  "task",
  { kind: "delegate", child, role: "create", title: "Map the workbench" },
  "Started Map the workbench",
);

const turn = endedTurn([create]);

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
          density="compact"
          cwd={undefined}
          changes={[]}
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
      id: child,
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
            message={{
              ...create,
              state: { ...create.state, phase: "running", progress: null },
              status: { kind: "live", run: null },
            }}
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
