import { useNowMinute } from "../use-now-minute.ts";
import type { SessionInfo } from "@nyte-ai/sdk";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { Button } from "@nyte-ai/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@nyte-ai/ui/context-menu";
import { Icon } from "@nyte-ai/ui/icon";
import { MenuItem, MenuSeparator } from "@nyte-ai/ui/menu";
import { Row } from "@nyte-ai/ui/row";
import { focus } from "@nyte-ai/ui/styles/a11y.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { props } from "@stylexjs/stylex";
import { useState, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import { StatusDot } from "../components/ui.tsx";
import { usePaneControllerSnapshot, usePaneViewStateStore } from "../layout/pane-context.tsx";
import { activePane } from "../layout/pane-layout.ts";
import type { ChatDraft } from "../layout/session-view-state.ts";
import { sessionActivityMark } from "../session-activity.ts";
import { useStagePage } from "./shell-state.ts";
import { DraftRow, SessionRow, type RailRows, type SessionPlace } from "./sidebar-rows.tsx";
import { sidebarStyles as styles } from "./sidebar.stylex.ts";
import {
  hasSessionFilters,
  sessionsForView,
  deriveShelf,
  type SessionShelf,
  type SessionViewGroup,
  type SessionViewSettings,
  type ShelfHold,
} from "./sidebar-view.ts";

export interface ListedSession {
  readonly place: SessionPlace;
  readonly session: SessionInfo;
}

export interface ListReveal {
  readonly revealed: (key: string) => number;
  readonly reveal: (key: string, listId: string, visibleCount: number) => void;
}

export interface ListContext {
  readonly view: SessionViewSettings;
  readonly showDrafts: boolean;
  readonly rail: RailRows;
  readonly reveal: ListReveal;
  readonly onClearFilters: () => void;
}

interface OpenDrafts {
  readonly drafts: readonly ChatDraft[];
  readonly activeDraftId: string | undefined;
}

const COLLAPSED_SESSION_LIMIT = 5;

const SESSION_PAGE_SIZE = 8;

function sessionPage(total: number, base: number, revealed: number) {
  const fit = (count: number): number => (total - count <= 1 ? total : count);
  const visible = fit(base + revealed);

  return { visible, next: fit(base + revealed + SESSION_PAGE_SIZE) - visible };
}

export function useListReveal(): ListReveal {
  const [revealed, setRevealed] = useState<ReadonlyMap<string, number>>(() => new Map());

  return {
    revealed: (key) => revealed.get(key) ?? 0,
    reveal: (key, listId, visibleCount) => {
      setRevealed((current) =>
        new Map(current).set(key, (current.get(key) ?? 0) + SESSION_PAGE_SIZE),
      );
      window.requestAnimationFrame(() => {
        document
          .getElementById(listId)
          ?.querySelectorAll<HTMLElement>('[data-slot="row-primary"]')
          [visibleCount]?.focus();
      });
    },
  };
}

export function useDrafts(): OpenDrafts {
  const store = usePaneViewStateStore();
  const drafts = useSyncExternalStore(store.subscribe, store.listedDrafts, store.listedDrafts);
  const { layout } = usePaneControllerSnapshot();
  const page = useStagePage();
  const pane = activePane(layout);
  const readBlankId = (): string => store.readBlank(pane.id).id;
  const blankId = useSyncExternalStore(store.subscribe, readBlankId, readBlankId);

  return {
    drafts,
    activeDraftId: page === undefined && pane.selection.kind === "blank" ? blankId : undefined,
  };
}

function groupsWithin(
  groups: readonly SessionViewGroup[],
  limit: number,
): readonly SessionViewGroup[] {
  const kept: SessionViewGroup[] = [];
  let room = limit;

  for (const group of groups) {
    if (room <= 0) break;
    const sessions = group.sessions.slice(0, room);
    room -= sessions.length;

    if (sessions.length > 0) kept.push({ ...group, sessions });
  }

  return kept;
}

function EmptyList({
  filtered,
  onClearFilters,
}: {
  readonly filtered: boolean;
  readonly onClearFilters: () => void;
}): ReactElement {
  if (!filtered)
    return <div {...props(text.base, styles.quiet, styles.sessionQuiet)}>No sessions yet</div>;

  return (
    <>
      <div {...props(text.base, styles.quiet, styles.sessionQuiet)}>
        No chats match these filters
      </div>
      <Row variant="nav" xstyle={styles.showMore} onClick={onClearFilters}>
        Clear Filters
      </Row>
    </>
  );
}

function ShowMore({
  listId,
  count,
  onClick,
}: {
  readonly listId: string;
  readonly count: number;
  readonly onClick: () => void;
}): ReactElement {
  return (
    <Row
      variant="nav"
      aria-expanded={false}
      aria-controls={listId}
      xstyle={styles.showMore}
      onClick={onClick}
    >
      Show {count} More
    </Row>
  );
}

function Drafts({
  drafts,
  activeDraftId,
  rail,
}: {
  readonly drafts: readonly ChatDraft[];
  readonly activeDraftId: string | undefined;
  readonly rail: RailRows;
}): ReactElement {
  return (
    <>
      {drafts.map((draft) => (
        <DraftRow key={draft.id} draft={draft} selected={draft.id === activeDraftId} rail={rail} />
      ))}
    </>
  );
}

function ListedRows({
  rows,
  rail,
}: {
  readonly rows: readonly ListedSession[];
  readonly rail: RailRows;
}): ReactElement {
  return (
    <>
      {rows.map(({ place, session }) => (
        <SessionRow key={session.id} session={session} place={place} rail={rail} />
      ))}
    </>
  );
}

export function ChatsList({
  listId,
  listed,
  hold,
  context,
}: {
  readonly listId: string;
  readonly listed: readonly ListedSession[] | undefined;
  readonly hold: ShelfHold | undefined;
  readonly context: ListContext;
}): ReactElement | null {
  const { view, rail, reveal } = context;
  const { drafts: openDrafts, activeDraftId } = useDrafts();
  const [openShelves, setOpenShelves] = useState<ReadonlySet<SessionShelf>>(() => new Set());
  const drafts = context.showDrafts ? openDrafts : [];

  if (listed === undefined && drafts.length === 0) return null;
  const rows = listed ?? [];

  const lead = (
    <>
      {rows.length === 0 && drafts.length === 0 && (
        <EmptyList filtered={hasSessionFilters(view)} onClearFilters={context.onClearFilters} />
      )}
      <Drafts drafts={drafts} activeDraftId={activeDraftId} rail={rail} />
    </>
  );

  if (view.grouping === "inbox") {
    const shelved = (shelf: SessionShelf): readonly ListedSession[] =>
      rows.filter(({ session }) => deriveShelf(session, rail.working, hold) === shelf);

    const inbox = shelved("inbox");

    const shelfPanel = (
      shelf: Exclude<SessionShelf, "inbox">,
      label: string,
      leading: ReactNode,
      capped: boolean,
    ): ReactElement | null => {
      const members = shelved(shelf);

      if (members.length === 0) return null;
      const panelId = `${listId}-${shelf}`;
      const open = openShelves.has(shelf);

      const page = capped
        ? sessionPage(members.length, COLLAPSED_SESSION_LIMIT, reveal.revealed(shelf))
        : { visible: members.length, next: 0 };

      const visible = members.slice(0, page.visible);

      return (
        <Shelf
          label={label}
          count={members.length}
          leading={leading}
          panelId={panelId}
          open={open}
          onOpenChange={(next) =>
            setOpenShelves((current) => {
              const shelves = new Set(current);

              if (next) shelves.add(shelf);
              else shelves.delete(shelf);

              return shelves;
            })
          }
        >
          <ListedRows rows={visible} rail={rail} />
          {page.next > 0 && (
            <ShowMore
              listId={panelId}
              count={page.next}
              onClick={() => reveal.reveal(shelf, panelId, visible.length)}
            />
          )}
        </Shelf>
      );
    };

    return (
      <div id={listId} {...props(styles.section)}>
        {lead}
        <ListedRows rows={inbox} rail={rail} />
        {inbox.length === 0 && drafts.length === 0 && rows.length > 0 && (
          <div {...props(text.base, styles.quiet, styles.sessionQuiet)}>Nothing new</div>
        )}
        {shelfPanel("working", "Working", <StatusDot mark="working" />, false)}
        {shelfPanel("done", "Done", <Icon name="inbox-checked" size={14} />, true)}
        {shelfPanel("archived", "Archived", <Icon name="archive" size={14} />, true)}
      </div>
    );
  }

  const live = rows.filter(
    ({ session }) => sessionActivityMark(session, rail.working.has(session.id)) !== "idle",
  ).length;

  const page = sessionPage(rows.length, live + COLLAPSED_SESSION_LIMIT, reveal.revealed("chats"));
  const visible = rows.slice(0, page.visible);

  return (
    <div id={listId} {...props(styles.section)}>
      {lead}
      <ListedRows rows={visible} rail={rail} />
      {page.next > 0 && (
        <ShowMore
          listId={listId}
          count={page.next}
          onClick={() => reveal.reveal("chats", listId, visible.length + drafts.length)}
        />
      )}
    </div>
  );
}

export function FolderList({
  listId,
  place,
  sessions,
  open,
  context,
}: {
  readonly listId: string;
  readonly place: SessionPlace;
  readonly sessions: readonly SessionInfo[] | undefined;
  readonly open: boolean;
  readonly context: ListContext;
}): ReactElement | null {
  const { view, rail, reveal } = context;
  const { drafts: openDrafts, activeDraftId } = useDrafts();
  const drafts = context.showDrafts && open ? openDrafts : [];
  const now = useNowMinute();

  if (sessions === undefined && drafts.length === 0) return null;

  const groups =
    sessions === undefined ? [] : sessionsForView(sessions, view, "local", now, rail.working);

  const listedCount = groups.reduce((count, group) => count + group.sessions.length, drafts.length);
  const key = `local:${place.workspace ?? "home"}`;
  const page = sessionPage(listedCount, COLLAPSED_SESSION_LIMIT, reveal.revealed(key));
  const visibleDrafts = drafts.slice(0, page.visible);
  const visibleGroups = groupsWithin(groups, page.visible - visibleDrafts.length);

  return (
    <div id={listId} {...props(styles.section)}>
      {visibleDrafts.length > 0 && (
        <div {...props(styles.section)}>
          {view.grouping === "status" && (
            <div {...props(text.xs, styles.sessionGroupLabel)}>Draft</div>
          )}
          <Drafts drafts={visibleDrafts} activeDraftId={activeDraftId} rail={rail} />
        </div>
      )}
      {sessions !== undefined && listedCount === 0 && (
        <EmptyList filtered={hasSessionFilters(view)} onClearFilters={context.onClearFilters} />
      )}
      {visibleGroups.map((group) => (
        <div key={group.key} {...props(styles.section)}>
          {group.label !== undefined && (
            <div {...props(text.xs, styles.sessionGroupLabel)}>{group.label}</div>
          )}
          <ListedRows rows={group.sessions.map((session) => ({ place, session }))} rail={rail} />
        </div>
      ))}
      {page.next > 0 && (
        <ShowMore
          listId={listId}
          count={page.next}
          onClick={() => reveal.reveal(key, listId, page.visible)}
        />
      )}
    </div>
  );
}

export function WorkspaceRow({
  name,
  path,
  available,
  unavailableDetail = "folder unavailable, saved chats are still available",
  active,
  expanded,
  onExpandedChange,
  onNewChat,
  onArchiveAll,
  onRemove,
  children,
}: {
  readonly name: string;
  readonly path: string;
  readonly available: boolean;
  readonly unavailableDetail?: string;
  readonly active: boolean;
  readonly expanded: boolean;
  readonly onExpandedChange: (expanded: boolean) => void;
  readonly onNewChat: (() => void) | undefined;
  readonly onArchiveAll: (() => void) | undefined;
  readonly onRemove: () => void;
  readonly children: ReactNode;
}): ReactElement {
  const menuItems = (
    <>
      <MenuItem
        icon="new-chat-folder"
        disabled={onNewChat === undefined}
        onClick={() => onNewChat?.()}
      >
        New Chat
      </MenuItem>
      {onArchiveAll !== undefined && (
        <MenuItem icon="archive" onClick={onArchiveAll}>
          Archive All Chats…
        </MenuItem>
      )}
      <MenuSeparator />
      <MenuItem icon="trash" variant="danger" onClick={onRemove}>
        Remove Workspace from Sidebar
      </MenuItem>
    </>
  );

  const row = (
    <Row
      revealActions
      xstyle={[styles.rowSurface, styles.workspaceRow, !available && styles.workspaceUnavailable]}
    >
      <Row.Primary
        xstyle={styles.workspacePrimary}
        render={
          <Collapsible.Trigger
            variant="plain"
            title={available ? path : `${path} (${unavailableDetail})`}
            aria-current={active ? "location" : undefined}
          />
        }
      >
        <Row.Leading xstyle={styles.rowIcon}>
          <span {...props(styles.workspaceGlyph)}>
            <span {...props(styles.workspaceFolder)}>
              <Icon name={expanded ? "folder-open" : "folder"} size={14} />
            </span>
            <span {...props(styles.workspaceChevron, expanded && styles.workspaceChevronOpen)}>
              <Icon name="chevron-down" size={13} />
            </span>
          </span>
        </Row.Leading>
        <Row.Label>{name}</Row.Label>
      </Row.Primary>
      <Row.Actions placement="overlay">
        <Button
          size="sm"
          iconOnly
          icon="new-chat-folder"
          aria-label={`New Chat in ${name}`}
          disabled={onNewChat === undefined}
          onClick={onNewChat}
        />
      </Row.Actions>
    </Row>
  );

  return (
    <Collapsible.Root open={expanded} onOpenChange={onExpandedChange} {...props(styles.section)}>
      <ContextMenu>
        <ContextMenuTrigger render={row} />
        <ContextMenuContent aria-label={`Options for ${name}`}>{menuItems}</ContextMenuContent>
      </ContextMenu>
      <Collapsible.Panel {...props(styles.sessionList)}>{children}</Collapsible.Panel>
    </Collapsible.Root>
  );
}

function Shelf({
  label,
  count,
  leading,
  panelId,
  open,
  onOpenChange,
  children,
}: {
  readonly label: string;
  readonly count: number;
  readonly leading: ReactNode;
  readonly panelId: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <Collapsible.Root open={open} onOpenChange={onOpenChange} xstyle={styles.section}>
      <Collapsible.Trigger
        variant="plain"
        aria-controls={panelId}
        xstyle={[text.base, styles.shelf, focus.ringInset]}
      >
        <span {...props(styles.rowIcon, styles.shelfLeading)}>{leading}</span>
        <span {...props(styles.shelfLabel)}>{label}</span>
        <span {...props(text.xs, styles.shelfCount)}>{count}</span>
        <Collapsible.Chevron xstyle={styles.shelfChevron} />
      </Collapsible.Trigger>
      <Collapsible.Panel id={panelId} hiddenUntilFound={false} xstyle={styles.shelfPanel}>
        {children}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
