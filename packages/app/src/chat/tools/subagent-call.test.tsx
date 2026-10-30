import "../../../test/web-bridge.ts";
import { afterAll, expect, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionInfo } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import type { ReactNode } from "react";
import { SubagentCallView } from "./subagent-call.tsx";
import { transcriptRows } from "../transcript/transcript-rows.ts";
import { TranscriptProvider } from "../transcript/transcript.tsx";
import { TurnItemView } from "../transcript/turn-view.tsx";
import { scriptedConnection } from "../../../test/scripted-connection.ts";
import { endedTurn, sessionRow, sessionView, settledTool } from "../../../test/view-fixtures.ts";
import { installConnection } from "../../data/connection.ts";
import { sessionsWatch, sessionWatch } from "../../data/watches.ts";
import { PaneControllerProvider } from "../../panes/pane-context.tsx";
import { PaneController } from "../../panes/pane-controller.ts";

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

const unlisted = settledTool("task-unlisted", {
  kind: "delegate",
  child: null,
  role: "create",
  title: "Map the workbench",
});

function Parent({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <PaneControllerProvider controller={new PaneController({ storageKey: "subagent-call" })}>
        <TranscriptProvider paneId="primary" sessionId={parent}>
          {children}
        </TranscriptProvider>
      </PaneControllerProvider>
    </QueryClientProvider>
  );
}

test("a create call finds its child in the parent's background by the call that started it", async () => {
  installConnection(
    scriptedConnection({
      sessions: [childSession],
      views: new Map([
        [
          parent,
          [
            sessionView({
              background: [
                {
                  kind: "child",
                  id: childSession.id,
                  title: "Map the workbench",
                  state: "done",
                  startedBy: create.state.call,
                },
              ],
            }),
          ],
        ],
      ]),
    }).connection,
  );
  const leave = [
    sessionsWatch("all").subscribe(() => undefined),
    sessionWatch(parent).subscribe(() => undefined),
  ];
  await sessionsWatch("all").first();
  await sessionWatch(parent).first();

  const html = renderToStaticMarkup(
    <Parent>
      {transcriptRows({
        loading: false,
        failed: false,
        turns: [turn],
        changes: [],
        prompts: [],
        running: false,
        held: false,
        retrying: undefined,
      }).map((row) =>
        row.kind === "agents" ? (
          <TurnItemView key={row.key} row={row} running={false} density="compact" cwd={undefined} />
        ) : null,
      )}
    </Parent>,
  );

  for (const unsubscribe of leave) unsubscribe();
  expect(html.match(/>Done</g)?.length).toBe(1);
  expect(html, "the row opens the child").toContain("<button");
  expect(html).not.toContain("agents done");
});

test("a child whose chat still reads as running shows how the parent's background says it ended", async () => {
  const lagging = sessionRow(
    "lagging",
    { name: "Map the core", parent, call: create.state.call },
    {
      kind: "live",
      run: {
        id: asId<"run">("run"),
        head: asId<"head">("main"),
        startedAt: 1,
        attempt: 1,
        origin: { kind: "input", message: asId<"message">("m") },
      },
      phase: "responding",
      stopping: false,
    },
  );

  installConnection(
    scriptedConnection({
      sessions: [lagging],
      views: new Map([
        [
          parent,
          [
            sessionView({
              background: [
                {
                  kind: "child",
                  id: lagging.id,
                  title: "Map the core",
                  state: "done",
                  startedBy: create.state.call,
                },
              ],
            }),
          ],
        ],
      ]),
    }).connection,
  );

  const leave = [
    sessionsWatch("all").subscribe(() => undefined),
    sessionWatch(parent).subscribe(() => undefined),
  ];

  await sessionsWatch("all").first();
  await sessionWatch(parent).first();

  const html = renderToStaticMarkup(
    <Parent>
      <SubagentCallView
        message={create}
        toolClass={{ kind: "delegate", child: null, role: "create", title: "Map the core" }}
        cwd={undefined}
      />
    </Parent>,
  );

  for (const unsubscribe of leave) unsubscribe();
  expect(html.match(/>Done</g)?.length).toBe(1);
  expect(html).not.toContain("Working");
});

test("a running create call whose child the parent's background doesn't list yet is starting up", () => {
  const html = renderToStaticMarkup(
    <Parent>
      <SubagentCallView
        message={{
          ...unlisted,
          state: { ...unlisted.state, phase: "running", progress: null },
          status: { kind: "live", run: null },
        }}
        toolClass={{ kind: "delegate", child: null, role: "create", title: "Map the workbench" }}
        cwd={undefined}
      />
    </Parent>,
  );

  expect(html.match(/>Starting up</g)?.length).toBe(1);
  expect(html).not.toContain(">Done<");
});
