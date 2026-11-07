import type { ReactElement } from "react";
import type { SessionInfo } from "@nyte-ai/sdk";
import { MenuItem, MenuSeparator } from "@nyte-ai/ui/menu";
import { forkChat } from "../data/session-actions.ts";
import { ChatCopyMenuItems } from "./chat-card.tsx";

export interface ChatMenuHandlers {
  readonly onPin: () => void;
  readonly onRename: () => void;
  readonly onMarkRead: () => void;
  readonly onOpenBeside: () => void;
  readonly onArchive: () => void;
  readonly onDelete: () => void;
}

export function ChatMenuItems({
  session,
  title,
  unread,
  handlers,
}: {
  readonly session: SessionInfo;
  readonly title: string;
  readonly unread: boolean;
  readonly handlers: ChatMenuHandlers;
}): ReactElement {
  const subagent = session.parent !== null;

  return (
    <>
      <MenuItem
        icon={session.pinned ? "unpin" : "pin"}
        disabled={subagent}
        title={subagent ? "Subagent chats can't be pinned" : undefined}
        onClick={handlers.onPin}
      >
        {session.pinned ? "Unpin Chat" : "Pin Chat"}
      </MenuItem>
      <MenuItem icon="pencil" onClick={handlers.onRename}>
        Rename Chat…
      </MenuItem>
      <MenuItem icon="fork" onClick={() => void forkChat(session.id)}>
        Fork Chat
      </MenuItem>
      {unread && (
        <MenuItem icon="eye" onClick={handlers.onMarkRead}>
          Mark as Read
        </MenuItem>
      )}
      <MenuItem icon="split-right" onClick={handlers.onOpenBeside}>
        Open Chat to the Side
      </MenuItem>
      <MenuItem icon="copy" onClick={() => void navigator.clipboard.writeText(title)}>
        Copy Chat Title
      </MenuItem>
      <ChatCopyMenuItems sessionId={session.id} />
      <MenuItem
        icon={session.archived ? "unarchive" : "archive"}
        disabled={subagent}
        title={subagent ? "Subagent chats can't be archived" : undefined}
        onClick={handlers.onArchive}
      >
        {session.archived ? "Restore Chat" : "Archive Chat"}
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        icon="trash"
        variant="danger"
        disabled={subagent}
        title={subagent ? "Subagent chats can't be deleted" : undefined}
        onClick={handlers.onDelete}
      >
        Delete Chat…
      </MenuItem>
    </>
  );
}
