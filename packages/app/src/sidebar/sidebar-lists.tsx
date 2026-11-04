import { useNowMinute } from "../lib/use-now-minute.ts";
import type { SessionId, SessionInfo, WorkspaceId } from "@nyte-ai/sdk";
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
import type { ProjectInfo } from "@nyte-ai/schema";
import { useProjectDropTarget } from "../panes/session-dnd.tsx";
import type { ChatDirectory } from "../chats/index.ts";
import { useChildRows } from "../data/session-rows.ts";
import { TaskMark } from "../components/task-mark.tsx";
import { usePaneLayout, usePaneViewStateStore } from "../panes/pane-context.tsx";
import { activeSelection } from "../panes/pane-layout.ts";
import type { ChatDraft } from "../panes/session-view-state.ts";
import { preferences, useSetting } from "../preferences/index.ts";
import { useStagePage } from "../tabs/shell-state.ts";
import { DraftRow, SessionRow, type SessionPlace } from "./sidebar-rows.tsx";
import { sidebarStyles as styles } from "./sidebar.stylex.ts";
import {
  chatMark,
  COLLAPSED_SESSION_LIMIT,
  deriveShelf,
  folderView,
  hasSessionFilters,
  type ProjectGroup,
  sessionPage,
  type SessionViewGroup,
  type ShelfHold,
} from "./sidebar-view.ts";
import { type SessionShelf, type SessionViewSettings } from "../preferences/session-view.ts";

export interface ListedSession {
  readonly place: SessionPlace;
  readonly session: SessionInfo;
}

export interface ListReveal {
  readonly revealed: (key: string) => number;
  readonly reveal: (key: string, count: number, listId: string, visibleCount: number) => void;
}

export interface ListContext {
  readonly view: SessionViewSettings;
  readonly showDrafts: boolean;
  readonly activeSessionId: SessionId | undefined;
  readonly openWorkspace: WorkspaceId | null;
  readonly unavailable: ReadonlySet<WorkspaceId>;
  readonly chats: ChatDirectory;
  /** The window's unread answer, which leaves out chats the user is looking at. */
  readonly unread: ReadonlySet<SessionId>;
  readonly reveal: ListReveal;
  readonly onClearFilters: () => void;
}

interface OpenDrafts {
  readonly drafts: readonly ChatDraft[];
  readonly activeDraftId: string | undefined;
}

export function useListReveal(): ListReveal {
  const revealed = useSetting(preferences.sidebarRevealed);

  return {
    revealed: (key) => revealed[key] ?? 0,
    reveal: (key, count, listId, visibleCount) => {
      preferences.sidebarRevealed.set({ ...revealed, [key]: count });
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
  const pane = usePaneLayout((layout) => layout.focus[0]);
  const blank = usePaneLayout((layout) => activeSelection(layout).kind === "blank");
  const page = useStagePage();
  const readBlankId = (): string => store.readBlank(pane).id;
  const blankId = useSyncExternalStore(store.subscribe, readBlankId, readBlankId);

  return {
    drafts,
    activeDraftId: page === undefined && blank ? blankId : undefined,
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
    return <div {...props(text.base, styles.quiet, styles.sessionQuiet)}>No chats yet</div>;

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
}: {
  readonly drafts: readonly ChatDraft[];
  readonly activeDraftId: string | undefined;
}): ReactElement {
  return (
    <>
      {drafts.map((draft) => (
        <DraftRow key={draft.id} draft={draft} selected={draft.id === activeDraftId} />
      ))}
    </>
  );
}

export function ListedRows({
  rows,
  context,
}: {
  readonly rows: readonly ListedSession[];
  readonly context: ListContext;
}): ReactElement {
  return (
    <>
      {rows.map((listed) => (
        <ListedRow key={listed.session.id} listed={listed} context={context} />
      ))}
    </>
  );
}

function ListedRow({
  listed,
  context,
  subagents,
}: {
  readonly listed: ListedSession;
  readonly context: ListContext;
  readonly subagents?: number;
}): ReactElement {
  return (
    <SessionRow
      session={listed.session}
      selected={listed.session.id === context.activeSessionId}
      draggable={listed.place.workspace === context.openWorkspace}
      unreachable={
        listed.session.workspace !== null && context.unavailable.has(listed.session.workspace)
      }
      showUpdated={context.view.show.includes("updated")}
      subagents={subagents}
    />
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
  const { view, reveal } = context;
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
      <Drafts drafts={drafts} activeDraftId={activeDraftId} />
    </>
  );

  if (view.grouping === "inbox") {
    const shelved = (shelf: SessionShelf): readonly ListedSession[] =>
      rows.filter(
        ({ session }) => deriveShelf(session, context.chats, context.unread, hold) === shelf,
      );

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
        ? sessionPage(
            members.length,
            COLLAPSED_SESSION_LIMIT,
            reveal.revealed(shelf),
            members.findIndex(({ session }) => session.id === context.activeSessionId),
          )
        : { visible: members.length, next: 0, revealed: 0 };

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
          <ListedRows rows={visible} context={context} />
          {page.next > 0 && (
            <ShowMore
              listId={panelId}
              count={page.next}
              onClick={() => reveal.reveal(shelf, page.revealed, panelId, visible.length)}
            />
          )}
        </Shelf>
      );
    };

    return (
      <div id={listId} {...props(styles.section)}>
        {lead}
        <ListedRows rows={inbox} context={context} />
        {inbox.length === 0 && drafts.length === 0 && rows.length > 0 && (
          <div {...props(text.base, styles.quiet, styles.sessionQuiet)}>Nothing new</div>
        )}
        {shelfPanel("working", "Working", <TaskMark state="working" />, false)}
        {shelfPanel("done", "Done", <Icon name="inbox-checked" size="sm" />, true)}
        {shelfPanel("archived", "Archived", <Icon name="archive" size="sm" />, true)}
      </div>
    );
  }

  const live = rows.filter(({ session }) => chatMark(session, context.chats) !== "done").length;

  const page = sessionPage(
    rows.length,
    live + COLLAPSED_SESSION_LIMIT,
    reveal.revealed("chats"),
    rows.findIndex(({ session }) => session.id === context.activeSessionId),
  );

  const visible = rows.slice(0, page.visible);

  return (
    <div id={listId} {...props(styles.section)}>
      {lead}
      <ListedRows rows={visible} context={context} />
      {page.next > 0 && (
        <ShowMore
          listId={listId}
          count={page.next}
          onClick={() =>
            reveal.reveal("chats", page.revealed, listId, visible.length + drafts.length)
          }
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
  const { view, reveal } = context;
  const { drafts: openDrafts, activeDraftId } = useDrafts();
  const drafts = context.showDrafts && open ? openDrafts : [];
  const now = useNowMinute();

  if (sessions === undefined && drafts.length === 0) return null;

  const groups =
    sessions === undefined ? [] : folderView(sessions, view, now, context.chats, context.unread);

  const listed = groups.flatMap((group) => group.sessions);
  const selected = listed.findIndex((session) => session.id === context.activeSessionId);
  const key = `local:${place.workspace ?? "home"}`;

  const page = sessionPage(
    drafts.length + listed.length,
    COLLAPSED_SESSION_LIMIT,
    reveal.revealed(key),
    selected === -1 ? -1 : drafts.length + selected,
  );

  const visibleDrafts = drafts.slice(0, page.visible);
  const visibleGroups = groupsWithin(groups, page.visible - visibleDrafts.length);

  return (
    <div id={listId} {...props(styles.section)}>
      {visibleDrafts.length > 0 && (
        <div {...props(styles.section)}>
          {view.grouping === "status" && (
            <div {...props(text.xs, styles.sessionGroupLabel)}>Draft</div>
          )}
          <Drafts drafts={visibleDrafts} activeDraftId={activeDraftId} />
        </div>
      )}
      {sessions !== undefined && drafts.length + listed.length === 0 && (
        <EmptyList filtered={hasSessionFilters(view)} onClearFilters={context.onClearFilters} />
      )}
      {visibleGroups.map((group) => (
        <div key={group.key} {...props(styles.section)}>
          {group.label !== undefined && (
            <div {...props(text.xs, styles.sessionGroupLabel)}>{group.label}</div>
          )}
          <ListedRows
            rows={group.sessions.map((session) => ({ place, session }))}
            context={context}
          />
        </div>
      ))}
      {page.next > 0 && (
        <ShowMore
          listId={listId}
          count={page.next}
          onClick={() => reveal.reveal(key, page.revealed, listId, page.visible)}
        />
      )}
    </div>
  );
}

export function PinnedSection({
  rows,
  context,
}: {
  readonly rows: readonly ListedSession[];
  readonly context: ListContext;
}): ReactElement {
  return (
    <section aria-label="Pinned" {...props(styles.section)}>
      <div {...props(styles.sectionHeader, styles.sectionTitle)}>
        <span {...props(styles.sectionLabel)}>Pinned</span>
      </div>
      <ListedRows rows={rows} context={context} />
    </section>
  );
}

/**
 * One row per project with its lead and units under it, the chats a person can open and talk to.
 * Their subagents only count on their rows. A chat dragged onto the block joins the project.
 * Chats in a project leave their folders for it, as pinned chats do.
 */
export function ProjectsSection({
  groups,
  context,
  selected,
  onOpen,
  onNewChat,
  onNewProject,
}: {
  readonly groups: readonly ProjectGroup<ListedSession>[];
  readonly context: ListContext;
  /** The project whose page the stage shows. */
  readonly selected: string | undefined;
  readonly onOpen: (project: ProjectInfo) => void;
  readonly onNewChat: (project: ProjectInfo) => void;
  readonly onNewProject: () => void;
}): ReactElement {
  return (
    <section aria-label="Projects" {...props(styles.section)}>
      <div {...props(styles.sectionHeader, styles.sectionTitle)}>
        <span {...props(styles.sectionLabel)}>Projects</span>
        <Button size="2xs" iconOnly icon="plus" aria-label="New Project" onClick={onNewProject} />
      </div>
      {groups.map((group) => (
        <ProjectBlock
          key={group.project.id}
          group={group}
          context={context}
          selected={group.project.id === selected}
          onOpen={() => onOpen(group.project)}
          onNewChat={() => onNewChat(group.project)}
        />
      ))}
    </section>
  );
}

function ProjectBlock({
  group,
  context,
  selected,
  onOpen,
  onNewChat,
}: {
  readonly group: ProjectGroup<ListedSession>;
  readonly context: ListContext;
  readonly selected: boolean;
  readonly onOpen: () => void;
  readonly onNewChat: () => void;
}): ReactElement {
  const { setNodeRef, active, isOver } = useProjectDropTarget(group.project.id);
  const members = group.lead === undefined ? group.units : [group.lead, ...group.units];

  return (
    <div
      ref={setNodeRef}
      data-sidebar-group=""
      {...props(
        styles.section,
        styles.projectDrop,
        active !== null && styles.projectDropReady,
        isOver && styles.projectDropActive,
      )}
    >
      <Row
        revealActions
        selected={selected}
        xstyle={[styles.rowSurface, styles.workspaceRow, selected && styles.rowSelected]}
      >
        <Row.Primary
          xstyle={styles.workspacePrimary}
          data-sidebar-header=""
          title={projectHint(group.project)}
          aria-current={selected ? "page" : undefined}
          onClick={onOpen}
        >
          <Row.Leading xstyle={styles.rowIcon}>
            <Icon name="layers" size="sm" />
          </Row.Leading>
          <Row.Label>{group.project.name}</Row.Label>
        </Row.Primary>
        <Row.Actions placement="overlay">
          <Button
            size="sm"
            iconOnly
            icon="new-chat"
            aria-label={
              group.project.lead === null
                ? `New Chat in ${group.project.name}`
                : `Message Lead in ${group.project.name}`
            }
            onClick={onNewChat}
          />
        </Row.Actions>
      </Row>
      <div {...props(styles.sessionList)}>
        {members.map((listed) => (
          <ProjectMember key={listed.session.id} listed={listed} context={context} />
        ))}
      </div>
    </div>
  );
}

function projectHint(project: ProjectInfo): string {
  const until = project.until.kind === "goal" ? `Goal: ${project.until.goal}` : "Standing";

  return project.lead === null ? `${until}. Open it to start its lead chat.` : until;
}

function ProjectMember({
  listed,
  context,
}: {
  readonly listed: ListedSession;
  readonly context: ListContext;
}): ReactElement {
  const subagents = useChildRows(listed.session.id).length;

  return <ListedRow listed={listed} context={context} subagents={subagents} />;
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
  onMarkAllRead,
  onArchiveAll,
  onRemove,
  retained,
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
  readonly onMarkAllRead?: () => void;
  readonly onArchiveAll: (() => void) | undefined;
  readonly onRemove: () => void;
  /** The open chat, kept under the header while the workspace is folded. */
  readonly retained?: ReactNode;
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
      {onMarkAllRead !== undefined && (
        <MenuItem icon="eye" onClick={onMarkAllRead}>
          Mark All as Read
        </MenuItem>
      )}
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
            data-sidebar-header=""
            title={available ? path : `${path} (${unavailableDetail})`}
            aria-current={active ? "location" : undefined}
          />
        }
      >
        <Row.Leading xstyle={styles.rowIcon}>
          <span {...props(styles.workspaceGlyph)}>
            <span {...props(styles.workspaceFolder)}>
              <Icon name={expanded ? "folder-open" : "folder"} size="sm" />
            </span>
            <span {...props(styles.workspaceChevron, expanded && styles.workspaceChevronOpen)}>
              <Icon name="chevron-down" size="xs" />
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
    <Collapsible.Root
      open={expanded}
      onOpenChange={onExpandedChange}
      data-sidebar-group=""
      {...props(styles.section)}
    >
      <ContextMenu>
        <ContextMenuTrigger render={row} />
        <ContextMenuContent aria-label={`Options for ${name}`}>{menuItems}</ContextMenuContent>
      </ContextMenu>
      <Collapsible.Panel {...props(styles.sessionList)}>{children}</Collapsible.Panel>
      {retained}
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
    <Collapsible.Root
      open={open}
      onOpenChange={onOpenChange}
      data-sidebar-group=""
      xstyle={styles.section}
    >
      <Collapsible.Trigger
        variant="plain"
        data-sidebar-header=""
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
