import type { ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import { clientActionAriaShortcut, clientActions } from "../contract/client-actions.ts";
import { useHostState } from "../data/host.ts";
import { useRootRows } from "../data/session-rows.ts";
import { SearchPalette } from "../sidebar/search-palette.tsx";
import { shellActions, useOverlays } from "../tabs/shell-state.ts";
import { windowTabs } from "../tabs/window-tabs.ts";
import { revealChatPanel } from "../workbench/commands.ts";
import { workbenchViewKey } from "../workbench/paths.ts";

const RECENT_LIMIT = 20;

/**
 * A Code window's way back to its chats, in place of Nyte's chat list: the search palette, listing this project's
 * latest chats first. A chat it opens replaces the one in the chat panel.
 */
export function ChatHistory({ mac }: { readonly mac: boolean }): ReactElement {
  const open = useOverlays().search;
  const workspace = useHostState().data.workspace;
  const roots = useRootRows();
  const view = workbenchViewKey(workspace?.path);

  const recent = roots
    ?.filter((session) => !session.archived && session.workspace === workspace?.id)
    .toSorted((left, right) => right.lastActivityAt - left.lastActivityAt)
    .slice(0, RECENT_LIMIT);

  return (
    <SearchPalette
      open={open}
      recentSessions={recent}
      onOpenChange={shellActions.setSearchOpen}
      onOpenSession={(sessionId) => {
        windowTabs.openChat(sessionId, "permanent");
        revealChatPanel(view);
      }}
      home={false}
      onRan={(action) => {
        if (action === "chat.new") revealChatPanel(view);
      }}
      trigger={
        <Button
          iconOnly
          icon="clock"
          aria-label="Chats"
          aria-keyshortcuts={clientActionAriaShortcut(clientActions.search, mac)}
        />
      }
    />
  );
}
