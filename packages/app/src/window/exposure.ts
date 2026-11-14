import type { SessionId } from "@nyte-ai/sdk";
import type { ChatDirectory } from "../chats/index.ts";
import type { SideChatWindow } from "../chat/side-chat/side-chat-state.ts";
import { tabShown } from "../panes/layout.ts";
import { chatPanes } from "../panes/pane-layout.ts";
import { activeTab, tabPlace } from "../tabs/model.ts";
import type { WindowState } from "../tabs/model.ts";
import type { TrayView } from "./tray.ts";

export interface WindowView {
  readonly tabs: WindowState;
  readonly trays: ReadonlyMap<SessionId, TrayView>;
  readonly sides: ReadonlyMap<SessionId, SideChatWindow>;
  readonly settings: boolean;
  readonly covered: boolean;
  readonly focused: boolean;
  readonly chats: ChatDirectory;
}

export interface Exposure {
  readonly shown: ReadonlySet<SessionId>;
  readonly looking: ReadonlySet<SessionId>;
  readonly unread: ReadonlySet<SessionId>;
}

const NONE: ReadonlySet<SessionId> = new Set();

export function expose(view: WindowView): Exposure {
  const placed = place(view);
  const unread = new Set([...unreadOnHost(view.chats)].filter((id) => !placed.looking.has(id)));

  return { ...placed, unread };
}

/**
 * The chat this window tells main it views, so a notification's click comes back to it: the active
 * tab's focused chat. Unlike `expose` it stays under Settings and a workbench that covers the panes,
 * because the click should still come to this window, and it names one pane of a split, because
 * every pane's chat is already kept from alerting while the window is focused and only the click's
 * window depends on it.
 */
export function viewedChat(tabs: WindowState): SessionId | null {
  const place = tabPlace(activeTab(tabs));

  return place.kind === "session" ? place.sessionId : null;
}

export function unreadOnHost(chats: ChatDirectory): ReadonlySet<SessionId> {
  return new Set([...chats.values()].flatMap((chat) => (chat.settledUnread ? [chat.id] : [])));
}

function place(view: WindowView): Omit<Exposure, "unread"> {
  const tab = activeTab(view.tabs);

  if (view.settings || tab.view.kind === "page") return { shown: NONE, looking: NONE };

  const layout = tab.view.layout;

  const panes = chatPanes(layout).flatMap((pane) =>
    pane.selection.kind === "session" && tabShown(layout, pane.tab)
      ? [pane.selection.sessionId]
      : [],
  );

  const detail = (parent: SessionId): SessionId | undefined => {
    const tray = view.trays.get(parent);

    return tray?.kind === "detail" ? tray.sessionId : undefined;
  };

  const side = (parent: SessionId): SessionId | undefined => {
    const window = view.sides.get(parent);

    return window?.kind === "open" && !window.folded && window.shown.kind === "chat"
      ? window.shown.id
      : undefined;
  };

  const details = panes.flatMap((parent) => detail(parent) ?? []);
  const sides = panes.flatMap((parent) => side(parent) ?? []);

  return {
    shown: new Set([...panes, ...details, ...sides]),
    looking:
      view.focused && !view.covered
        ? new Set([...panes.filter((parent) => detail(parent) === undefined), ...details, ...sides])
        : NONE,
  };
}
