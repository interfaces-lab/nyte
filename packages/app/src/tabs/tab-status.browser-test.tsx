import "../../test/window-bridge.ts";
import { paneLayout, runPane, selectSession } from "../../test/panes.ts";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterContextProvider } from "@tanstack/react-router";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { ReactElement } from "react";
import type { Execution, HeadInfo, HostView, SessionInfo, WorkspaceInfo } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { PaneControllerProvider } from "../panes/pane-context.tsx";
import { SessionDndProvider } from "../panes/session-dnd.tsx";
import { queryClient } from "../data/query-client.ts";
import { installConnection } from "../data/connection.ts";
import { createAppRouter } from "../shell/routes.tsx";
import { Sidebar } from "../sidebar/sidebar.tsx";
import "../theme/tokens.stylex.ts";
import { scriptedConnection, viewStream } from "../../test/scripted-connection.ts";
import { COMPLETED, sessionRow } from "../../test/view-fixtures.ts";
import { useWindowTabItems, useWindowTabsState } from "./use-window-tabs.tsx";
import { WindowTabStrip } from "../shell/window-tab-strip.tsx";
import { chatWindow } from "../window/index.ts";
import { windowTabs } from "./window-tabs.ts";

type State = "working" | "waiting" | "asking" | "failed" | "failed-unread" | "unread" | "read";

const RUN = {
  id: asId<"run">("run"),
  head: asId<"head">("main"),
  startedAt: 1,
  attempt: 1,
  origin: { kind: "input", message: asId<"message">("m") },
} as const;

const LIVE: Execution = { kind: "live", run: RUN, phase: "responding", stopping: false };

const ASKING: Execution = {
  kind: "waiting",
  run: RUN,
  on: { kind: "run", session: asId<"session">("subagent"), run: asId<"run">("subagent-run") },
};

const FAILED: Execution = {
  kind: "idle",
  lastRun: {
    id: asId<"run">("run"),
    end: { kind: "failed", failure: { class: "provider", message: "Rate limited." } },
    endedAt: 2,
  },
};

function heads(state: State): readonly HeadInfo[] {
  return [
    {
      name: asId<"head">("main"),
      tip: { kind: "commit", id: asId<"commit">("tip") },
      stack: null,
      execution:
        state === "working"
          ? LIVE
          : state === "asking"
            ? ASKING
            : state === "failed" || state === "failed-unread"
              ? FAILED
              : COMPLETED,
      unread: state === "unread" || state === "failed-unread",
      background: { working: 0, waiting: state === "waiting" || state === "asking" ? 1 : 0 },
    },
  ];
}

function chat(name: string, state: State): SessionInfo {
  return sessionRow(name, { workspace: asId<"workspace">("alpha"), heads: heads(state) });
}

function folder(id: string): WorkspaceInfo {
  return {
    id: asId<"workspace">(id),
    target: { kind: "local", path: `/work/${id}` },
    identity: asId("identity"),
    availability: { kind: "available" },
    projectResources: null,
    trusted: true,
    projectSources: [],
    addedBy: asId("tester"),
    writers: [],
    isolation: null,
  };
}

const host: HostView = {
  id: asId<"host">("scripted"),
  link: { kind: "connected" },
  operations: null,
  name: "Test",
  platform: "linux",
  version: "0.0.0",
  catalog: asId<"catalog-generation">("initial"),
  plugins: [],
  settings: [],
  views: [],
  defaultWorkspace: asId<"workspace">("home"),
  projects: [],
  authority: new Set(),
};

interface Listed {
  readonly Solo: State;
  readonly Left: State;
  readonly Right: State;
}

let states: Listed = { Solo: "read", Left: "read", Right: "read" };

const quiet = chat("Quiet", "waiting");

const list = () => Object.entries(states).map(([name, state]) => chat(name, state));

const sessions = viewStream<readonly SessionInfo[]>(list());

const scripted = scriptedConnection({
  host: viewStream(host),
  sessions,
  workspaces: [folder("alpha"), folder("home")],
  session: (id) => (id === quiet.id ? { info: async () => quiet } : {}),
});

installConnection(scripted.connection);

function nextFrame(): Promise<void> {
  return new Promise((resolve) =>
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())),
  );
}

async function until(predicate: () => boolean, what: string): Promise<void> {
  const deadline = performance.now() + 10_000;

  while (!predicate()) {
    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await nextFrame();
  }
}

function markLabel(holder: Element | null | undefined): string {
  return holder?.querySelector('[role="img"]')?.getAttribute("aria-label") ?? "none";
}

function sidebarMark(name: string): string {
  const label = [...document.querySelectorAll('[data-slot="row-label"]')].find(
    (element) => element.textContent === name,
  );

  if (label === undefined) return "no row";

  return markLabel(label.closest('[data-slot="row-primary"]'));
}

function tabMark(tooltip: string): string {
  const tab = [...document.querySelectorAll('[role="tab"]')].find((element) =>
    element.getAttribute("aria-label")?.startsWith(tooltip),
  );

  return tab === undefined ? "no tab" : markLabel(tab);
}

function tabName(tooltip: string): string {
  const name = [...document.querySelectorAll('[role="tab"]')]
    .map((element) => element.getAttribute("aria-label") ?? "")
    .find((label) => label.startsWith(tooltip));

  return name === undefined ? "no tab" : name.slice(tooltip.length);
}

function unread(name: keyof Listed): boolean {
  return chatWindow.getSnapshot().unread.has(asId<"session">(name));
}

function seen(name: keyof Listed): string {
  return `${sidebarMark(name)}|${String(unread(name))}`;
}

async function change(next: Partial<Listed>, row: keyof Listed): Promise<void> {
  const before = seen(row);
  states = { ...states, ...next };
  sessions.push(list());
  await until(() => seen(row) !== before, `${row}'s row to change`);
}

function Strip(): ReactElement {
  const state = useWindowTabsState();

  return (
    <WindowTabStrip
      tabs={useWindowTabItems(state)}
      activeTabId={state.activeTabId}
      mac
      onActivate={() => undefined}
      onClose={() => undefined}
      onKeep={() => undefined}
      onOpenParent={() => undefined}
      onNewTab={() => undefined}
      onReorder={() => undefined}
      onCloseOthers={() => undefined}
      onCloseToRight={() => undefined}
      chat={{
        rename: () => undefined,
        pin: () => undefined,
        markRead: () => undefined,
        openBeside: () => undefined,
        archive: () => undefined,
        remove: () => undefined,
      }}
    />
  );
}

export async function run(): Promise<string> {
  queryClient.clear();
  windowTabs.start({ id: "tab-status", launch: undefined });
  windowTabs.openChat(asId<"session">("Solo"), "permanent");
  windowTabs.openChat(asId<"session">("Left"), "permanent");
  const controller = windowTabs.panes();
  runPane(controller, {
    kind: "drop",
    sessionId: asId<"session">("Right"),
    pane: paneLayout(controller).focus[0],
    placement: "right",
  });
  selectSession(controller, asId<"session">("Left"));
  windowTabs.openChat(quiet.id, "permanent");
  windowTabs.dispatch({ kind: "new-tab" });

  const container = document.createElement("div");
  container.style.cssText = "display:flex;flex-direction:column;width:800px;height:900px";
  document.body.append(container);
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: ["/"] }) });
  const root = createRoot(container);

  flushSync(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <RouterContextProvider router={router}>
          <TooltipProvider delay={0} closeDelay={0} timeout={0}>
            <PaneControllerProvider>
              <SessionDndProvider>
                <Strip />
                <Sidebar />
              </SessionDndProvider>
            </PaneControllerProvider>
          </TooltipProvider>
        </RouterContextProvider>
      </QueryClientProvider>,
    ),
  );

  try {
    await until(() => sidebarMark("Solo") !== "no row", "the sidebar");

    const solo: {
      readonly state: State;
      readonly row: string;
      readonly tab: string;
      readonly name: string;
      readonly unread: boolean;
    }[] = [];

    for (const state of [
      "working",
      "asking",
      "failed",
      "failed-unread",
      "waiting",
      "unread",
      "read",
    ] as const) {
      await change({ Solo: state }, "Solo");
      solo.push({
        state,
        row: sidebarMark("Solo"),
        tab: tabMark("Solo"),
        name: tabName("Solo"),
        unread: unread("Solo"),
      });
    }

    const split = async (next: Partial<Listed>, row: keyof Listed) => {
      await change(next, row);

      return {
        left: sidebarMark("Left"),
        right: sidebarMark("Right"),
        tab: tabMark("Left | Right"),
      };
    };

    const rightUnread = await split({ Right: "unread" }, "Right");
    const leftWorking = await split({ Left: "working" }, "Left");

    for (let frame = 0; frame < 100 && tabMark("Quiet") === "no tab"; frame += 1) await nextFrame();

    const unlisted = {
      row: sidebarMark("Quiet"),
      tabs: [...document.querySelectorAll('[role="tab"]')].map((tab) =>
        tab.getAttribute("aria-label"),
      ),
      tab: tabMark("Quiet"),
    };

    return JSON.stringify({ solo, split: { rightUnread, leftWorking }, unlisted });
  } finally {
    flushSync(() => root.unmount());
    container.remove();
    queryClient.clear();
  }
}
