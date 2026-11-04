import {
  backgroundLabel,
  failureNotice,
  sessionTitle,
  taskLabel,
} from "@nyte-ai/plugin/client/presentation";
import type { TaskState } from "@nyte-ai/plugin/client/presentation";
import type { SessionId, SessionInfo, WorkspaceId } from "@nyte-ai/sdk";
import { ConfirmDialog } from "@nyte-ai/ui/alert-dialog";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@nyte-ai/ui/context-menu";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Input } from "@nyte-ai/ui/input";
import { MenuItem } from "@nyte-ai/ui/menu";
import { Row } from "@nyte-ai/ui/row";
import { srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { PreviewCard } from "@nyte-ai/ui/preview-card";
import { props } from "@stylexjs/stylex";
import { useRef, useState } from "react";
import type { MouseEvent, ReactElement } from "react";
import { ChatCardContent, ChatCardTrigger } from "../components/chat-card.tsx";
import { ChatMenuItems } from "../components/chat-menu.tsx";
import { formatTimeAgo } from "../lib/format.ts";
import { draftPreviewText } from "../references/message-references.ts";
import type { ChatDraft } from "../panes/session-view-state.ts";
import { useSessionDraggable } from "../panes/session-dnd.tsx";
import type { Chat } from "../chats/index.ts";
import { chatDirectory, useChat } from "../chats/index.ts";
import type { OpenIntent } from "../tabs/model.ts";
import { windowTabs } from "../tabs/window-tabs.ts";
import { useDebouncedValue } from "../lib/use-debounced-value.ts";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { useNowMinute } from "../lib/use-now-minute.ts";
import { chatStore, warmSession } from "../data/chat-store.ts";
import { sidebarStyles as styles } from "./sidebar.stylex.ts";
import { chatWindow, useChatMark } from "../window/index.ts";
import { sessionActions } from "../data/session-rows.ts";
import { shellActions } from "../tabs/shell-state.ts";
import { hideFromPanes } from "../panes/pane-context.tsx";
import { sessionIsRunning } from "./sidebar-view.ts";
import { TaskMark } from "../components/task-mark.tsx";

const WARM_DELAY_MS = 50;

/** Reads the minute clock itself so only the label re-renders each minute. */
function TimeAgo({ timestamp }: { readonly timestamp: number }): string {
  return formatTimeAgo(timestamp, useNowMinute());
}

function openIntent(event: MouseEvent): OpenIntent {
  return event.button === 1 || ((event.metaKey || event.ctrlKey) && !event.shiftKey)
    ? "background"
    : "preview";
}

export function DraftRow({
  draft,
  selected,
}: {
  readonly draft: ChatDraft;
  readonly selected: boolean;
}): ReactElement {
  const onOpen = (): void => windowTabs.showDraft(draft.id);
  const onDelete = () => windowTabs.controller().removeDraft(draft.id);
  const title = draftPreviewText(useDebouncedValue(draft.composer.draft, 100));

  const row = (
    <Row
      selected={selected}
      revealActions
      xstyle={[
        styles.rowSurface,
        styles.sessionRow,
        styles.draftRow,
        selected && styles.rowSelected,
      ]}
    >
      {selected && <Row.Backdrop xstyle={styles.sessionSelection} />}
      <Row.Primary
        title={`Draft: ${title}`}
        aria-current={selected ? "page" : undefined}
        onClick={onOpen}
      >
        <Row.Leading xstyle={styles.rowIcon}>
          <span role="img" aria-label="Draft" {...props(styles.draftDot)} />
        </Row.Leading>
        <Row.Label xstyle={styles.draftLabel}>{title}</Row.Label>
        <Row.Meta xstyle={styles.rowMeta}>
          <TimeAgo timestamp={draft.updatedAt} />
        </Row.Meta>
      </Row.Primary>
      <Row.Actions
        placement="overlay"
        data-nyte-session-row-actions=""
        xstyle={styles.rowActionsBesideMeta}
      >
        <Button
          size="sm"
          iconOnly
          icon="trash"
          aria-label={`Delete Draft: ${title}`}
          onClick={onDelete}
        />
      </Row.Actions>
    </Row>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger render={row} />
      <ContextMenuContent aria-label={`Options for draft: ${title}`}>
        <MenuItem icon="trash" variant="danger" onClick={onDelete}>
          Delete Draft
        </MenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export interface SessionPlace {
  readonly workspace: WorkspaceId | null;
  readonly path: string | null;
}

/** Shows the chat at once; the window tabs open its folder on the host after it. */
function showSession(sessionId: SessionId, target: OpenIntent | "beside"): void {
  if (target !== "beside") {
    windowTabs.openChat(sessionId, target);

    return;
  }

  shellActions.showWorkspace();
  const controller = windowTabs.controller();
  controller.drop(sessionId, controller.getSnapshot().focus[0], "right");
}

export function SessionRow({
  session,
  selected,
  draggable,
  unreachable,
  showUpdated,
  subagents,
}: {
  readonly session: SessionInfo;
  readonly selected: boolean;
  readonly draggable: boolean;
  readonly unreachable: boolean;
  readonly showUpdated: boolean;
  readonly subagents?: number;
}): ReactElement {
  const chat = useChat(session.id);
  const shown = chat.kind === "ready" ? chat.chat : undefined;
  const mark = useChatMark(session.id);

  return (
    <SessionRowView
      session={session}
      selected={selected}
      draggable={draggable}
      unreachable={unreachable}
      showUpdated={showUpdated}
      subagents={subagents}
      mark={mark.state}
      unread={mark.unread}
      ask={shown === undefined ? undefined : askLine(shown, mark.state)}
    />
  );
}

/** A chat's row drawn from its mark and ask line, which a settings preview passes itself. */
export function SessionRowView({
  session,
  selected,
  draggable,
  unreachable,
  showUpdated,
  subagents,
  mark,
  unread,
  ask,
}: {
  readonly session: SessionInfo;
  readonly selected: boolean;
  readonly draggable: boolean;
  readonly unreachable: boolean;
  readonly showUpdated: boolean;
  /** Subagents the chat started, counted on its row instead of listed under it. */
  readonly subagents?: number;
  readonly mark: TaskState;
  readonly unread: boolean;
  readonly ask: string | undefined;
}): ReactElement {
  const onOpen = (intent: OpenIntent): void => showSession(session.id, intent);
  const onOpenBeside = (): void => showSession(session.id, "beside");

  const onRename = (name: string): void =>
    void sessionActions.rename({ sessionId: session.id, name });

  const onPin = (): void => sessionActions.pin({ sessionId: session.id, pinned: !session.pinned });
  const title = sessionTitle(session);

  const [draftName, setDraftName] = useState<string | undefined>();
  const [confirming, setConfirming] = useState<"archive" | "delete">();
  const returnFocus = useRef<HTMLButtonElement>(null);

  const onArchive = (): void => {
    if (!session.archived && sessionIsRunning(session, chatDirectory())) setConfirming("archive");
    else sessionActions.archive([session.id], !session.archived);
  };

  const onDelete = (): void => setConfirming("delete");

  const closeOnDismiss = (open: boolean): void => {
    if (!open) setConfirming(undefined);
  };

  const warming = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const { isDragging, listeners, setNodeRef } = useSessionDraggable(session.id, title, !draggable);

  const cancelWarm = (): void => {
    clearTimeout(warming.current);
    warming.current = undefined;
  };

  const warm = (): void => {
    cancelWarm();

    if (!selected) warmSession(session.id);
  };

  useMountEffect(() => cancelWarm);

  const commitRename = (): void => {
    if (draftName === undefined) return;
    const name = draftName.replaceAll(/\s+/g, " ").trim();
    setDraftName(undefined);

    if (name !== "" && name !== title) onRename(name);
  };

  if (draftName !== undefined) {
    return (
      <Row xstyle={[styles.rowSurface, styles.sessionRenameRow]}>
        <Row.Leading xstyle={styles.rowIcon}>
          <TaskMark state={mark} unread={unread} />
        </Row.Leading>
        <Row.Label>
          <Input
            aria-label={`Rename ${title}`}
            autoFocus
            xstyle={styles.sessionRenameInput}
            value={draftName}
            onFocus={(event) => event.currentTarget.select()}
            onValueChange={setDraftName}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitRename();

              if (event.key === "Escape") setDraftName(undefined);
            }}
          />
        </Row.Label>
      </Row>
    );
  }

  const menuItems = (
    <ChatMenuItems
      session={session}
      title={title}
      unread={unread}
      handlers={{
        onPin,
        onRename: () => setDraftName(title),
        onMarkRead: () => chatWindow.markRead([session.id]),
        onOpenBeside,
        onArchive,
        onDelete,
      }}
    />
  );

  const subagentsLabel = `${String(subagents)} ${subagents === 1 ? "subagent" : "subagents"}`;

  const titleLine = (
    <>
      <Row.Label xstyle={[styles.sessionLabel, unread && styles.unreadLabel]}>{title}</Row.Label>
      {subagents !== undefined && subagents > 0 && (
        <Row.Meta xstyle={styles.subagentCount} title={subagentsLabel}>
          <Icon name="agent" size="xs" />
          <span aria-hidden="true">{subagents}</span>
          <span {...props(srOnly)}>{subagentsLabel}</span>
        </Row.Meta>
      )}
      {showUpdated && (
        <Row.Meta xstyle={styles.rowMeta}>
          <TimeAgo timestamp={session.lastActivityAt} />
        </Row.Meta>
      )}
    </>
  );

  const row = (
    <Row
      render={<div ref={setNodeRef} />}
      selected={selected}
      revealActions
      xstyle={[
        styles.rowSurface,
        styles.sessionRow,
        selected && styles.rowSelected,
        isDragging && styles.rowDragging,
        ask !== undefined && styles.sessionRowAsk,
      ]}
    >
      {selected && <Row.Backdrop xstyle={styles.sessionSelection} />}
      <Row.Primary
        xstyle={unreachable && styles.sessionUnreachable}
        aria-current={selected ? "page" : undefined}
        onClick={(event) => onOpen(openIntent(event))}
        onDoubleClick={() => setDraftName(title)}
        onPointerEnter={() => {
          cancelWarm();
          warming.current = setTimeout(warm, WARM_DELAY_MS);
        }}
        onPointerLeave={cancelWarm}
        onPointerDownCapture={warm}
        onAuxClick={(event) => {
          if (event.button === 1 && windowTabs.strip) onOpen("background");
        }}
        {...listeners}
      >
        <Row.Leading xstyle={[styles.rowIcon, ask !== undefined && styles.rowIconAsk]}>
          <TaskMark state={mark} unread={unread} />
        </Row.Leading>
        {ask === undefined ? (
          titleLine
        ) : (
          <Row.Body>
            <span {...props(styles.sessionTitleLine)}>{titleLine}</span>
            <Row.Description
              xstyle={[mark === "failed" ? intent.danger : intent.warning, styles.sessionAsk]}
            >
              {ask}
            </Row.Description>
          </Row.Body>
        )}
      </Row.Primary>
      <Row.Actions
        placement="overlay"
        data-nyte-session-row-actions=""
        xstyle={[
          showUpdated && styles.rowActionsBesideMeta,
          ask !== undefined && styles.rowActionsAsk,
        ]}
      >
        <Button
          size="sm"
          iconOnly
          icon={session.pinned ? "unpin" : "pin"}
          aria-label={`${session.pinned ? "Unpin" : "Pin"} ${title}`}
          onClick={onPin}
        />
        <Button
          size="sm"
          iconOnly
          aria-label={`${session.archived ? "Restore" : "Archive"} ${title}`}
          onClick={onArchive}
        >
          <span {...props(styles.actionGlyphArchive)}>
            <Icon name={session.archived ? "unarchive" : "archive"} size="xs" />
          </span>
        </Button>
      </Row.Actions>
    </Row>
  );

  return (
    <>
      <PreviewCard>
        <ContextMenu>
          <ContextMenuTrigger render={<ChatCardTrigger render={row} />} />
          <ContextMenuContent aria-label={`Options for ${title}`}>{menuItems}</ContextMenuContent>
        </ContextMenu>
        <ChatCardContent placement="row" label={title} sessions={[session.id]} />
      </PreviewCard>
      {confirming === "delete" && (
        <ConfirmDialog
          open
          title="Delete Chat"
          confirmLabel="Delete Chat"
          description="The chat disappears now. Undo from the notification before it closes."
          finalFocus={returnFocus}
          onOpenChange={closeOnDismiss}
          onConfirm={() => {
            setConfirming(undefined);
            sessionActions.delete(session.id, hideFromPanes);
          }}
        />
      )}
      {confirming === "archive" && (
        <ConfirmDialog
          open
          finalFocus={returnFocus}
          title="Archive Working Chat"
          description="It keeps working in the archive. Restore it from the Archived filter."
          confirmLabel="Archive Chat"
          onOpenChange={closeOnDismiss}
          onConfirm={() => {
            setConfirming(undefined);
            sessionActions.archive([session.id], true);
          }}
        />
      )}
    </>
  );
}

export function NeighbourWarm({
  active,
  neighbours,
}: {
  readonly active: SessionId;
  readonly neighbours: readonly SessionId[];
}): null {
  useMountEffect(() => {
    const opened = chatStore(active);
    let leave: (() => void) | undefined;
    let frame: number | undefined;
    let idle: number | undefined;

    const afterPaint = (): void => {
      frame = requestAnimationFrame(() => {
        idle = requestIdleCallback(() => {
          for (const sessionId of neighbours) warmSession(sessionId);
        });
      });
    };

    if (opened.value === undefined)
      leave = opened.subscribe(() => {
        if (opened.value === undefined) return;
        leave?.();
        leave = undefined;
        afterPaint();
      });
    else afterPaint();

    return () => {
      leave?.();

      if (frame !== undefined) cancelAnimationFrame(frame);

      if (idle !== undefined) cancelIdleCallback(idle);
    };
  });

  return null;
}

function askLine(chat: Chat, mark: TaskState): string | undefined {
  if (chat.status.kind === "waiting-for-approval") return taskLabel(mark);

  if (mark === "waiting") return backgroundLabel(chat.background);

  return mark === "failed" && chat.status.kind === "failed"
    ? failureNotice(chat.status.failure).text
    : undefined;
}
