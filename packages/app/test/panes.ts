import { asId } from "@nyte-ai/schema";
import { WindowDrafts } from "../src/chat/composer/drafts.ts";
import type { StorageArea } from "../src/lib/storage.ts";
import { reduceLayout } from "../src/panes/layout.ts";
import type { Layout, LayoutAction } from "../src/panes/layout.ts";
import { createLayoutStore } from "../src/panes/layout-store.ts";
import { PaneController } from "../src/panes/pane-controller.ts";
import { paneRules } from "../src/panes/pane-kinds.ts";
import type { PaneContent } from "../src/panes/pane-kinds.ts";
import { chatContent, chatPanes, showChat } from "../src/panes/pane-layout.ts";
import type { PaneSelection } from "../src/panes/pane-layout.ts";
import { SessionViewStateStore } from "../src/panes/session-view-state.ts";
import { activeTab, tabLayout } from "../src/tabs/model.ts";
import type { WindowAction, WindowState } from "../src/tabs/model.ts";

/** The pane a new `tabPanes()` starts with. */
export const PRIMARY = asId<"pane">("primary");

/** One pane showing a new chat. */
export function blankLayout(): Layout<PaneContent> {
  const tab = { id: asId<"pane-tab">("primary-chat"), content: chatContent({ kind: "blank" }) };

  return {
    root: { kind: "pane", id: PRIMARY, tabs: [tab], active: tab.id, hidden: false },
    focus: [PRIMARY],
    zoomed: null,
  };
}

/** One window tab's panes with no window around them. */
export function tabPanes(drafts?: {
  readonly storage: StorageArea;
  readonly storageKey: string;
}): PaneController {
  return new PaneController({
    store: createLayoutStore(blankLayout()),
    viewState: new SessionViewStateStore(new WindowDrafts(drafts), ""),
  });
}

export type PaneChange = (layout: Layout<PaneContent>) => readonly LayoutAction<PaneContent>[];

/** The window action that applies `change` to the active tab's layout, naming new panes with `createId`. */
export function changePanes(
  state: WindowState,
  change: PaneChange,
  createId: () => string,
): WindowAction {
  const tab = activeTab(state);
  const rules = { ...paneRules, newId: createId };

  const layout = change(tabLayout(tab)).reduce(
    (current, action) => reduceLayout(current, action, rules),
    tabLayout(tab),
  );

  return { kind: "layout", tabId: tab.id, layout };
}

/** A new chat in a pane after the focused one, as Split Right opens it. */
export const splitRight: PaneChange = (layout) => [
  {
    kind: "open",
    content: chatContent({ kind: "blank" }),
    place: { kind: "edge", pane: layout.focus[0], direction: "right", side: "after" },
    activate: true,
  },
];

export function showIn(selection: PaneSelection): PaneChange {
  return (layout) => showChat(layout, selection);
}

export const focusFirst: PaneChange = (layout) =>
  chatPanes(layout)
    .slice(0, 1)
    .map((pane) => ({ kind: "focus", pane: pane.pane }));
