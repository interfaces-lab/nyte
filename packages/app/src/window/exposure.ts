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
