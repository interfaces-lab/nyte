import "../../test/window-bridge.ts";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterContextProvider } from "@tanstack/react-router";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { ReactElement } from "react";
import type { Execution, HeadInfo, SessionInfo, WorkspaceInfo } from "@nyte-ai/sdk";
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
import { WindowTabStrip } from "./window-tab-strip.tsx";
import { windowTabs } from "./window-tabs.ts";

type State = "working" | "waiting" | "failed" | "unread" | "read";

const RUN = {
  id: asId<"run">("run"),
  head: asId<"head">("main"),
  startedAt: 1,
  attempt: 1,
  origin: { kind: "input", message: asId<"message">("m") },
} as const;

const LIVE: Execution = { kind: "live", run: RUN, phase: "responding", stopping: false };

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
      execution: state === "working" ? LIVE : state === "failed" ? FAILED : COMPLETED,
      unread: state === "unread",
      background: { working: 0, waiting: state === "waiting" ? 1 : 0 },
    },
  ];
}

function chat(name: string, state: State): SessionInfo {
  return sessionRow(name, { workspace: asId<"workspace">("alpha"), heads: heads(state) });
}

const folder: WorkspaceInfo = {
  id: asId<"workspace">("alpha"),
  target: { kind: "local", path: "/work/alpha" },
  identity: asId("identity"),
  availability: { kind: "available" },
  projectResources: null,
  trusted: true,
  projectSources: [],
  addedBy: asId("tester"),
  sessions: 0,
  writers: [],
  isolation: null,
};

interface Listed {
  readonly Solo: State;
  readonly Left: State;
  readonly Right: State;
}

let states: Listed = { Solo: "read", Left: "read", Right: "read" };

/** Outside the host's capped lists, so only its own read finds it, and no sidebar row asks for it. */
const quiet = chat("Quiet", "waiting");

const list = () => Object.entries(states).map(([name, state]) => chat(name, state));

const sessions = viewStream<readonly SessionInfo[]>(list());

const scripted = scriptedConnection({
  sessions,
  workspaces: [folder],
  session: (id) => (id === quiet.id ? { info: async () => quiet } : {}),
});

installConnection(scripted.connection, scripted.live);

function painted(): Promise<void> {
  return new Promise((resolve) =>
    window.requestAnimationFrame(() => window.setTimeout(() => resolve(), 0)),
  );
}

async function until(predicate: () => boolean, what: string): Promise<void> {
  const deadline = performance.now() + 10_000;

  while (!predicate()) {
    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await painted();
  }
}

function markLabel(holder: Element | null | undefined): string {
  return holder?.querySelector('[role="img"]')?.getAttribute("aria-label") ?? "none";
}

/** The mark on the chat's sidebar row, and whether the row's title reads as unread. */
function sidebarMark(name: string): string {
  const label = [...document.querySelectorAll('[data-slot="row-label"]')].find(
    (element) => element.textContent === name,
  );

  if (label === undefined) return "no row";

  return markLabel(label.closest('[data-slot="row-primary"]'));
}

/** The mark on the tab, and ", unread" when the tab's name says so. */
function tabMark(tooltip: string): string {
  const tab = [...document.querySelectorAll('[role="tab"]')].find((element) =>
    element.getAttribute("aria-label")?.startsWith(tooltip),
  );

  if (tab === undefined) return "no tab";
  const unread = tab.getAttribute("aria-label")?.includes(", unread") === true;

  return `${markLabel(tab)}${unread ? ", unread" : ""}`;
}

async function change(next: Partial<Listed>, row: keyof Listed): Promise<void> {
  const before = sidebarMark(row);
  states = { ...states, ...next };
  sessions.push(list());
  await until(() => sidebarMark(row) !== before, `${row}'s row to change`);
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

/** A blank tab stays in front, so no chat counts as read by being looked at. */
export async function run(): Promise<string> {
  queryClient.clear();
  windowTabs.start({ id: "tab-status", launch: undefined });
  windowTabs.openChat(asId<"session">("Solo"), "permanent");
  windowTabs.openChat(asId<"session">("Left"), "permanent");
  const controller = windowTabs.controller();
  controller.drop(asId<"session">("Right"), controller.getSnapshot().focus[0], "right");
  controller.selectSession(asId<"session">("Left"));
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

    const solo: { readonly state: State; readonly row: string; readonly tab: string }[] = [];

    for (const state of ["working", "waiting", "failed", "unread", "read"] as const) {
      await change({ Solo: state }, "Solo");
      solo.push({ state, row: sidebarMark("Solo"), tab: tabMark("Solo") });
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

    for (let frame = 0; frame < 100 && tabMark("Quiet") === "no tab"; frame += 1) await painted();

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
