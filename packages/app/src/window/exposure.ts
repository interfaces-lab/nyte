import type { SessionId } from "@nyte-ai/sdk";
import type { ChatDirectory } from "../chats/index.ts";
import { orderedPanes } from "../layout/pane-layout.ts";
import { activeTab } from "../tabs/model.ts";
import type { WindowState } from "../tabs/model.ts";

/** What the window puts in front of the user, as state rather than as what happens to be mounted. */
export interface WindowView {
  readonly tabs: WindowState;
  /** The agent each chat's tray shows over it, by parent. */
  readonly details: ReadonlyMap<SessionId, SessionId>;
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
  /** Chats with a finished reply nobody has read, except those the user is looking at. */
  readonly unread: ReadonlySet<SessionId>;
}

const NONE: ReadonlySet<SessionId> = new Set();

export function expose(view: WindowView): Exposure {
  const placed = place(view);

  const unread = new Set(
    [...view.chats.values()].flatMap((chat) =>
      chat.unread && !placed.looking.has(chat.id) ? [chat.id] : [],
    ),
  );

  return { ...placed, unread };
}

function place(view: WindowView): Omit<Exposure, "unread"> {
  const tab = activeTab(view.tabs);

  if (view.settings || tab.view.kind === "page") return { shown: NONE, looking: NONE };

  const panes = orderedPanes(tab.view.layout).flatMap((pane) =>
    pane.selection.kind === "session" ? [pane.selection.sessionId] : [],
  );

  const details = panes.flatMap((parent) => {
    const child = view.details.get(parent);

    return child === undefined ? [] : [child];
  });

  return {
    shown: new Set([...panes, ...details]),
    looking:
      view.focused && !view.covered
        ? new Set([...panes.filter((parent) => !view.details.has(parent)), ...details])
        : NONE,
  };
}
