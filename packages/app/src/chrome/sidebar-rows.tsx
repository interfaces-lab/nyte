/**
 * The rail's rows: a chat, with its status, hover actions, rename field and
 * hover card, and an unsent draft.
 */
import { failureNotice } from "@nyte-ai/plugin/client/presentation";
import type { SessionId, SessionInfo, WorkspaceId } from "@nyte-ai/sdk";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@nyte-ai/ui/context-menu";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Input } from "@nyte-ai/ui/input";
import { MenuItem, MenuSeparator } from "@nyte-ai/ui/menu";
import { Row } from "@nyte-ai/ui/row";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import { props } from "@stylexjs/stylex";
import { motion } from "motion/react";
import { useRef, useState } from "react";
import type { MouseEvent, ReactElement } from "react";
import type { GitHubRepository } from "@nyte-ai/sdk";
import { formatTimeAgo } from "../components/ui.tsx";
import { draftPreviewText } from "../conversation/message-references.ts";
import type { ChatDraft } from "../layout/session-view-state.ts";
import { useSessionDraggable } from "../layout/session-dnd.tsx";
import { sessionActivityMark } from "../session-activity.ts";
import type { OpenTarget } from "../tabs/model.ts";
import { windowTabs } from "../tabs/window-tabs.ts";
import { useDebouncedValue } from "../use-debounced-value.ts";
import { useMountEffect } from "../use-mount-effect.ts";
import { sessionWatch } from "../sdk.tsx";
import { sidebarStyles as styles } from "./sidebar.stylex.ts";
import { StatusGlyph } from "./status-glyph.tsx";

function sessionTitle(session: SessionInfo): string {
  return session.name ?? "New chat";
}

/** How long the pointer rests on a chat's row before its view starts loading. */
const WARM_DELAY_MS = 50;

/** With a tab strip, ⌘-click or middle-click opens a background tab and ⌘⇧-click shows it. */
function openTarget(event: MouseEvent): OpenTarget {
  if (!windowTabs.strip) return "here";

  if (event.button === 1) return "background";

  if (event.metaKey || event.ctrlKey) return event.shiftKey ? "foreground" : "background";

  return "here";
}

/** A new chat's unsent text, listed until it is sent or deleted. */
export function DraftRow({
  draft,
  selected,
  layoutEnabled,
  rail,
}: {
  readonly draft: ChatDraft;
  readonly selected: boolean;
  readonly layoutEnabled: boolean;
  readonly rail: RailRows;
}): ReactElement {
  const onOpen = (): void => rail.openDraft(draft.id);
  const onDelete = (): void => rail.removeDraft(draft.id);
  const title = draftPreviewText(useDebouncedValue(draft.composer.draft, 100));

  const row = (
    <Row
      render={<motion.div layout={layoutEnabled ? "position" : false} initial={false} />}
      selected={selected}
      revealActions
      xstyle={[
        styles.rowSurface,
        styles.sessionRow,
        styles.draftRow,
        selected && styles.rowSelected,
      ]}
    >
      {selected && (
        <Row.Backdrop
          xstyle={styles.sessionSelection}
          render={
            <motion.div
              key={layoutEnabled ? "moving" : "static"}
              initial={false}
              layout={layoutEnabled ? "position" : false}
              layoutId={layoutEnabled ? "selected-session" : undefined}
              layoutCrossfade={false}
            />
          }
        />
      )}
      <Row.Primary
        title={`Draft: ${title}`}
        aria-current={selected ? "page" : undefined}
        onClick={onOpen}
      >
        <Row.Leading xstyle={styles.rowIcon}>
          <span role="img" aria-label="Draft" {...props(styles.draftDot)} />
        </Row.Leading>
        <Row.Label xstyle={styles.draftLabel}>{title}</Row.Label>
        <Row.Meta xstyle={styles.rowMeta}>{formatTimeAgo(draft.updatedAt)}</Row.Meta>
      </Row.Primary>
      <Row.Actions
        placement="overlay"
        data-nyte-session-row-actions=""
        xstyle={styles.rowActionsBesideMeta}
      >
        <Button
          size="2xs"
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

function sessionAsk(session: SessionInfo): string | undefined {
  for (const head of session.heads) {
    const { execution } = head;

    if (execution.kind === "waiting" && execution.on.kind === "part") return "Needs your answer";
  }

  for (const head of session.heads) {
    const { execution } = head;

    if (execution.kind === "idle" && execution.lastRun?.end.kind === "failed")
      return failureNotice(execution.lastRun.end.failure).text;
  }

  return undefined;
}

/** One folder of the rail: Home, or a folder the user opened. */
export interface SessionPlace {
  readonly workspace: WorkspaceId | null;
  readonly path: string | null;
}

/** What every chat row in the rail shares: what is current, and what its actions do. */
export interface RailRows {
  readonly openWorkspace: WorkspaceId | null;
  readonly activeSessionId: SessionId | undefined;
  /** Folders that can't be reached; their chats stay listed and fade. */
  readonly unavailable: ReadonlySet<WorkspaceId>;
  /** The open folder's GitHub repository, for its rows' hover cards. */
  readonly repository: Pick<GitHubRepository, "owner" | "name"> | undefined;
  readonly working: ReadonlySet<SessionId>;
  readonly showUpdated: boolean;
  readonly open: (sessionId: SessionId, target: OpenTarget | "beside") => void;
  readonly rename: (sessionId: SessionId, name: string) => void;
  readonly pin: (session: SessionInfo) => void;
  readonly archive: (session: SessionInfo) => void;
  readonly remove: (sessionId: SessionId) => void;
  readonly openDraft: (draftId: string) => void;
  readonly removeDraft: (draftId: string) => void;
}

/**
 * A chat in its folder. Only the open folder's rows drag, since a pane takes
 * a chat from the current folder. A hidden panel's selection never becomes a
 * shared-layout destination. Resting the pointer on a row, or pressing it,
 * loads the chat's view so opening it shows the chat at once.
 */
export function SessionRow({
  session,
  place,
  layoutEnabled,
  rail,
}: {
  readonly session: SessionInfo;
  readonly place: SessionPlace;
  readonly layoutEnabled: boolean;
  readonly rail: RailRows;
}): ReactElement {
  const selected = session.id === rail.activeSessionId;
  const working = rail.working.has(session.id);
  const showUpdated = rail.showUpdated;
  const draggable = place.workspace === rail.openWorkspace;
  const unreachable = session.workspace !== null && rail.unavailable.has(session.workspace);
  const onOpen = (target: OpenTarget): void => rail.open(session.id, target);
  const onOpenBeside = (): void => rail.open(session.id, "beside");
  const onRename = (name: string): void => rail.rename(session.id, name);
  const onPin = (): void => rail.pin(session);
  const onArchive = (): void => rail.archive(session);
  const onDelete = (): void => rail.remove(session.id);
  const repository = place.workspace === rail.openWorkspace ? rail.repository : undefined;
  const mark = sessionActivityMark(session, working);
  const title = sessionTitle(session);
  const ask = mark === "waiting" || mark === "failed" ? sessionAsk(session) : undefined;
  const [draftName, setDraftName] = useState<string | undefined>();
  const warming = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const { isDragging, listeners, setNodeRef } = useSessionDraggable(session.id, title, !draggable);

  const cancelWarm = (): void => {
    clearTimeout(warming.current);
    warming.current = undefined;
  };

  const warm = (): void => {
    cancelWarm();

    if (!selected)
      void sessionWatch(session.id)
        .next()
        .catch(() => undefined);
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
      <Row
        render={<motion.div layout={layoutEnabled ? "position" : false} initial={false} />}
        xstyle={[styles.rowSurface, styles.sessionRenameRow]}
      >
        <Row.Leading xstyle={styles.rowIcon}>
          <StatusGlyph session={session} mark={mark} />
        </Row.Leading>
        <Row.Label>
          <Input
            aria-label={`Rename ${title}`}
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
    <>
      <MenuItem icon={session.pinned ? "unpin" : "pin"} onClick={onPin}>
        {session.pinned ? "Unpin Chat" : "Pin Chat"}
      </MenuItem>
      <MenuItem icon="pencil" onClick={() => setDraftName(title)}>
        Rename Chat…
      </MenuItem>
      <MenuItem icon="split-right" onClick={onOpenBeside}>
        Open Chat to the Side
      </MenuItem>
      <MenuItem icon="copy" onClick={() => void navigator.clipboard.writeText(title)}>
        Copy Chat Title
      </MenuItem>
      <MenuItem icon={session.archived ? "unarchive" : "archive"} onClick={onArchive}>
        {session.archived ? "Restore Chat" : "Archive Chat"}
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon="trash" variant="danger" onClick={onDelete}>
        Delete Chat…
      </MenuItem>
    </>
  );

  const titleLine = (
    <>
      <Row.Label xstyle={styles.sessionLabel}>{title}</Row.Label>
      {showUpdated && (
        <Row.Meta xstyle={styles.rowMeta}>{formatTimeAgo(session.lastActivityAt)}</Row.Meta>
      )}
    </>
  );

  const row = (
    <Row
      render={
        <motion.div ref={setNodeRef} layout={layoutEnabled ? "position" : false} initial={false} />
      }
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
      {selected && (
        <Row.Backdrop
          xstyle={styles.sessionSelection}
          render={
            <motion.div
              key={layoutEnabled ? "moving" : "static"}
              initial={false}
              layout={layoutEnabled ? "position" : false}
              layoutId={layoutEnabled ? "selected-session" : undefined}
              layoutCrossfade={false}
            />
          }
        />
      )}
      <Row.Primary
        xstyle={unreachable && styles.sessionUnreachable}
        aria-current={selected ? "page" : undefined}
        onClick={(event) => onOpen(openTarget(event))}
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
          <StatusGlyph session={session} mark={mark} />
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
          size="2xs"
          iconOnly
          icon={session.pinned ? "unpin" : "pin"}
          aria-label={`${session.pinned ? "Unpin" : "Pin"} ${title}`}
          onClick={onPin}
        />
        <Button
          size="2xs"
          iconOnly
          aria-label={`${session.archived ? "Restore" : "Archive"} ${title}`}
          onClick={onArchive}
        >
          <span {...props(styles.actionGlyphArchive)}>
            <Icon name={session.archived ? "unarchive" : "archive"} size={12} />
          </span>
        </Button>
      </Row.Actions>
    </Row>
  );

  return (
    <Tooltip disableHoverablePopup>
      <ContextMenu>
        <ContextMenuTrigger render={<TooltipTrigger render={row} />} />
        <ContextMenuContent aria-label={`Options for ${title}`}>{menuItems}</ContextMenuContent>
      </ContextMenu>
      <TooltipContent side="right" align="start" alignOffset={-4} sideOffset={4} variant="card">
        <div {...props(styles.previewTitle)}>{title}</div>
        {place.path !== null && (
          <div {...props(styles.previewDetails)}>
            {repository !== undefined && (
              <div {...props(text.sm, styles.previewDetail)}>
                <span {...props(styles.previewDetailIcon)}>
                  <Icon name="git-branch" size={14} />
                </span>
                <span {...props(styles.previewDetailText)}>
                  {repository.owner}/{repository.name}
                </span>
              </div>
            )}
            <div {...props(text.sm, styles.previewDetail)}>
              <span {...props(styles.previewDetailIcon)}>
                <Icon name="folder" size={14} />
              </span>
              <span {...props(styles.previewDetailText)}>{place.path}</span>
            </div>
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
