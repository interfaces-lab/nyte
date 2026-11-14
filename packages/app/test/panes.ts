import { asId } from "@nyte-ai/schema";
import type { SessionId } from "@nyte-ai/sdk";
import { WindowDrafts } from "../src/chat/composer/drafts.ts";
import type { StorageArea } from "../src/lib/storage.ts";
import type { Layout, LayoutAction } from "../src/panes/layout.ts";
import type { PaneContent } from "../src/panes/pane-kinds.ts";
import { chatContent, chatPanes, showChat } from "../src/panes/pane-layout.ts";
import type { PaneSelection } from "../src/panes/pane-layout.ts";
import type { PaneCommand } from "../src/panes/pane-commands.ts";
import { SessionViewStateStore } from "../src/panes/session-view-state.ts";
import { activeTab, tabLayout } from "../src/tabs/model.ts";
import type { BlankDrafts, WindowAction, WindowState } from "../src/tabs/model.ts";
import { WindowStore } from "../src/tabs/window-store.ts";
import type { TabPanes } from "../src/tabs/window-store.ts";

export const PRIMARY = asId<"pane">("primary");

const TAB = "";

export function blankLayout(): Layout<PaneContent> {
  const tab = { id: asId<"pane-tab">("primary-chat"), content: chatContent({ kind: "blank" }) };

  return {
    root: { kind: "pane", id: PRIMARY, tabs: [tab], active: tab.id, hidden: false },
    focus: [PRIMARY],
    zoomed: null,
  };
}

/** A window of one blank tab whose pane is `PRIMARY`, apart from the app's window. */
export function tabPanes(drafts?: {
  readonly storage: StorageArea;
  readonly storageKey: string;
}): TabPanes {
  const windowDrafts = new WindowDrafts(drafts);

  const store = new WindowStore(
    {
      tabs: [{ id: TAB, view: { kind: "panes", layout: blankLayout() } }],
      activeTabId: TAB,
      recent: [],
      closed: [],
    },
    () => windowDrafts,
  );

  return store.tab(TAB);
}

export function runPane(panes: TabPanes, command: PaneCommand): void {
  panes.window.run(panes.tabId, command);
}

export function selectSession(panes: TabPanes, sessionId: SessionId): void {
  runPane(panes, { kind: "show", selection: { kind: "session", sessionId } });
}

export function paneLayout(panes: TabPanes): Layout<PaneContent> {
  return panes.layout.getSnapshot();
}

/** Blank drafts of a window nobody typed in. */
export const noDrafts: BlankDrafts = (tabId, pane) =>
  new SessionViewStateStore(new WindowDrafts(), tabId).readBlank(pane);

export type PaneChange = (layout: Layout<PaneContent>) => readonly LayoutAction<PaneContent>[];

export function changePanes(state: WindowState, change: PaneChange): WindowAction {
  const tab = activeTab(state);

  return { kind: "arrange", tabId: tab.id, actions: change(tabLayout(tab)) };
}

export const splitRight: PaneChange = (layout) => [
  {
    kind: "open",
    content: chatContent({ kind: "blank" }),
    place: { kind: "edge", pane: layout.focus[0], direction: "right", side: "after" },
  },
];

export function showIn(selection: PaneSelection): PaneChange {
  return (layout) => showChat(layout, selection);
}

export const focusFirst: PaneChange = (layout) =>
  chatPanes(layout)
    .slice(0, 1)
    .map((pane) => ({ kind: "focus", pane: pane.pane }));
