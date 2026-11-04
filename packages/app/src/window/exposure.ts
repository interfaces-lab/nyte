import type { SessionId } from "@nyte-ai/sdk";
import type { ChatDirectory } from "../chats/index.ts";
import { tabShown } from "../panes/layout.ts";
import { chatPanes } from "../panes/pane-layout.ts";
import { activeTab } from "../tabs/model.ts";
import type { WindowState } from "../tabs/model.ts";
import type { TrayView } from "./tray.ts";

export interface WindowView {
  readonly tabs: WindowState;
  readonly trays: ReadonlyMap<SessionId, TrayView>;
  /** Settings has the stage, so no chat is on screen. */
  readonly settings: boolean;
  /** The workbench is maximized over the chats. */
  readonly covered: boolean;
  /** The window is visible and has focus. */
  readonly focused: boolean;
  readonly chats: ChatDirectory;
}

export interface Exposure {
  /** Chats on screen: every pane of the active tab and the agent its tray shows. */
  readonly shown: ReadonlySet<SessionId>;
  /** Shown chats the user can read now: uncovered, in a focused window. A chat under its tray's agent is covered. */
  readonly looking: ReadonlySet<SessionId>;
  /** Chats whose completed run left a reply past the read mark, except those the user is looking at. */
  readonly unread: ReadonlySet<SessionId>;
}

const NONE: ReadonlySet<SessionId> = new Set();

export function expose(view: WindowView): Exposure {
  const placed = place(view);
  const unread = new Set([...unreadOnHost(view.chats)].filter((id) => !placed.looking.has(id)));

  return { ...placed, unread };
}

/** Includes chats the user is looking at: until a visit moves the mark, this still holds the chat just opened. */
export function unreadOnHost(chats: ChatDirectory): ReadonlySet<SessionId> {
  return new Set(
    [...chats.values()].flatMap((chat) =>
      chat.unreadTip !== null && chat.status.kind === "completed" ? [chat.id] : [],
    ),
  );
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

  const details = panes.flatMap((parent) => detail(parent) ?? []);

  return {
    shown: new Set([...panes, ...details]),
    looking:
      view.focused && !view.covered
        ? new Set([...panes.filter((parent) => detail(parent) === undefined), ...details])
        : NONE,
  };
}
