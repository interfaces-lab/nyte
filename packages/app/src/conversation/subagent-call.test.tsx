import "../../test/web-bridge.ts";
import { afterAll, expect, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionInfo } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { SubagentCallView } from "./subagent-call.tsx";
import { SubagentSessionsProvider } from "./subagent-sessions.ts";
import { transcriptRows } from "./transcript-rows.ts";
import { TurnItemView } from "./turn-view.tsx";
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

const create = settledTool(
  "task",
  { kind: "delegate", child: null, role: "create", title: "Map the workbench" },
  "Started subagent child.",
);

const childSession: SessionInfo = sessionRow("child", {
  name: "Map the workbench",
  parent,
  call: create.state.call,
});

const turn = endedTurn([create]);

test("a create call finds its child by the call that made it", () => {
  const client = new QueryClient();
  client.setQueryData(["sessions", "children", parent], [childSession]);

  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <SubagentSessionsProvider value={{ children: [childSession], open: () => {} }}>
        {transcriptRows({
          loading: false,
          failed: false,
          turns: [turn],
          changes: [],
          landing: [],
          held: false,
          retrying: undefined,
          working: false,
          running: false,
        }).map((row) =>
          row.kind === "part" ? (
            <TurnItemView
              key={row.messageId}
              row={row}
              running={false}
              density="compact"
              cwd={undefined}
            />
          ) : null,
        )}
      </SubagentSessionsProvider>
    </QueryClientProvider>,
  );

  client.clear();
  expect(html.match(/>Completed</g)?.length).toBe(1);
});

test("a running create call whose child is not listed yet is starting up", () => {
  const client = new QueryClient();

  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <SubagentSessionsProvider value={{ children: [], open: () => {} }}>
        <SubagentCallView
          title="Map the workbench"
          message={{
            ...create,
            state: { ...create.state, phase: "running", progress: null },
            status: { kind: "live", run: null },
          }}
          cwd={undefined}
        />
      </SubagentSessionsProvider>
    </QueryClientProvider>,
  );

  client.clear();
  expect(html.match(/>Starting up</g)?.length).toBe(1);
  expect(html).not.toContain(">Completed<");
});
