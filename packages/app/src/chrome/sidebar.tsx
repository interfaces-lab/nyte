import { intent } from "@nyte-ai/ui/surface-theme";
/**
 * The rail: new chat, search, customize, environments, and settings on top,
 * then a persistent workspace collection. Every folder expands independently over its
 * cached sessions, and the collection header owns folder opening. The Cloud
 * folder appears once a cloud chat exists. Settings opens a second layer of the
 * same rail, with a Back row where the primary actions were.
 * Everything you switch between lives in this one column.
 *
 * Every row shares one geometry: a leading icon slot, the label, and one
 * trailing column for shortcuts, timestamps, and hover actions. Labels
 * therefore start and end on the same edges from the top of the rail to the
 * footer.
 *
 * Row edit state lives at the rail root so a directory refetch cannot drop an
 * in-progress rename.
 *
 * Based on https://github.com/interfaces-lab/honk/blob/main/packages/app/src/desktop-extensions/vertical-sidebar/view.tsx
 */
import { draftPreviewText } from "../conversation/message-references.ts";
import { failureNotice } from "../conversation/tool-copy.ts";
import { props } from "@stylexjs/stylex";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { Row } from "@nyte-ai/ui/row";
import { Link, useMatch, useRouter } from "@tanstack/react-router";
import { LayoutGroup, motion, MotionConfig } from "motion/react";
import type { Transition } from "motion/react";
import { useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { MouseEvent, ReactElement, ReactNode } from "react";
import type { SessionId, SessionInfo, WorkspaceId } from "@nyte-ai/sdk";
import type { SessionMark } from "../view-helpers.ts";
import type { ChatDraft } from "../layout/session-view-state.ts";
import { ConfirmDialog } from "@nyte-ai/ui/alert-dialog";
import { Icon, type IconName } from "@nyte-ai/ui/icon";
import { Input } from "@nyte-ai/ui/input";
import { StatusDot } from "../components/ui.tsx";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@nyte-ai/ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import { MenuItem, MenuSeparator } from "@nyte-ai/ui/menu";
import { formatTimeAgo } from "../components/ui.tsx";
import { StatusGlyph } from "./status-glyph.tsx";
import { focus } from "@nyte-ai/ui/styles/a11y.stylex";
import { Button } from "@nyte-ai/ui/button";
import { Kbd } from "@nyte-ai/ui/kbd";
import { Toggle } from "@nyte-ai/ui/toggle";
import {
  activePaneController,
  paneControllerForWorkspace,
  usePaneActions,
  usePaneControllerSnapshot,
  usePaneViewStateStore,
} from "../layout/pane-context.tsx";
import { useSessionRemoval } from "../layout/use-session-removal.ts";
import { activePane } from "../layout/pane-layout.ts";
import { useSessionDraggable } from "../layout/session-dnd.tsx";
import { macPlatform } from "../platform.ts";
import {
  sessionFolderPath,
  useForgetWorkspace,
  useHostState,
  useRenameSession,
  useServerState,
  useSessionActions,
  useWorkingSessionIds,
  useWorkspaceSessionDirectory,
  useWorkspaces,
  type RailWorkspace,
} from "../queries.ts";
import { nyte } from "../nyte.ts";
import { useDebouncedValue } from "../use-debounced-value.ts";
import { sessionActivityMark } from "../session-activity.ts";

import { sidebarStyles as styles } from "./sidebar.stylex.ts";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { AccountFooterMenu } from "./account-footer.tsx";
import { useGitHubState } from "./github-account.ts";
import { folderPicker } from "./open-workspace.tsx";
import { SearchPalette } from "./search-palette.tsx";
import { WorkspaceControls } from "./sidebar-filter.tsx";
import {
  clearSessionFilters,
  DEFAULT_SESSION_VIEW,
  hasSessionFilters,
  sessionOrder,
  sessionsForNavigation,
  sessionsForView,
  shelfOf,
  type SessionShelf,
  type SessionViewSettings,
  type ShelfHold,
} from "./sidebar-view.ts";
import { closeSettings, SettingsNavigation, type SettingsSection } from "../settings/index.ts";
import { shellActions, useShellState } from "./shell-state.ts";
import { activateWorkspace } from "./use-show-session.ts";
import type { OpenTarget } from "../tabs/model.ts";
import { windowTabs } from "../tabs/window-tabs.ts";
import { clientActionAriaShortcut, clientActionKeys, clientActions } from "../client-actions.ts";
import { localSessions } from "../session-directory.ts";
import type { GitHubRepository } from "../bridge.ts";

/** Which list a sidebar panel shows: one local store, or the connected server's sessions. */
type SessionPlace =
  | { readonly kind: "local"; readonly workspace: WorkspaceId | null; readonly path: string | null }
  | { readonly kind: "cloud" };

const COLLAPSED_SESSION_LIMIT = 5;

const SESSION_PAGE_SIZE = 8;

function sessionPage(total: number, base: number, revealed: number) {
  const fit = (count: number): number => (total - count <= 1 ? total : count);
  const visible = fit(base + revealed);

  return { visible, next: fit(base + revealed + SESSION_PAGE_SIZE) - visible };
}

/** With window tabs, ⌘-click or middle-click opens a background tab and ⌘⇧-click shows it. */
function openTarget(event: MouseEvent): OpenTarget {
  if (!windowTabs.enabled) return "here";

  if (event.button === 1) return "background";

  if (event.metaKey || event.ctrlKey) return event.shiftKey ? "foreground" : "background";

  return "here";
}

const INSTANT: Transition = { duration: 0 };

/** How far a rail layer travels while it fades; the two layers pass each other by this much. */
const LAYER_SHIFT = 12;

/** Repeats collapse into one settle, the way they collapse into one notification. */
const ARCHIVE_BURST_MS = 100;

let archiveSettle: "single" | "burst" | undefined;

let lastArchiveAt = -ARCHIVE_BURST_MS;

/** Call before the archive itself, so the render it causes settles the list to match. */
function recordArchive(count: number): void {
  const at = performance.now();
  archiveSettle = count === 1 && at - lastArchiveAt > ARCHIVE_BURST_MS ? "single" : "burst";
  lastArchiveAt = at;
}

function sidebarLayoutTransition(node: HTMLElement, durationVariable: string): Transition {
  const css = getComputedStyle(node);
  const durationToken = css.getPropertyValue(durationVariable).trim();
  const duration = Number.parseFloat(durationToken) / (durationToken.endsWith("ms") ? 1000 : 1);
  const curve = css.getPropertyValue("--_sidebar-motion-easing").trim();

  const [x1, y1, x2, y2] =
    curve
      .match(/^cubic-bezier\(([^)]+)\)$/)?.[1]
      ?.split(",")
      .map(Number) ?? [];

  if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return INSTANT;

  return { type: "tween", duration, ease: [x1, y1, x2, y2] };
}

/**
 * The rail's two layers. The workspace column stays mounted under Settings so
 * scroll position and row state survive the round trip; the settings column
 * stays mounted so opening it has nothing to build. The layer that is not
 * showing is inert and transparent, which Chromium neither paints nor hit-tests.
 *
 * Opening settings sends the workspace column a step left as the settings
 * column arrives from the right; going back plays the same in reverse. Only
 * opacity and transform move, so the swap composites without touching layout
 * or repainting the list.
 */
function SidebarContent({ children }: { readonly children: ReactNode }): ReactElement {
  const settings = useMatch({ from: "/settings/$section", shouldThrow: false });
  const settingsOpen = settings !== undefined;
  const contentRef = useRef<HTMLElement>(null);
  const layoutId = useId();
  const [transitions, setTransitions] = useState({ list: INSTANT, archive: INSTANT });
  // The settings column keeps its last section through the fade out, so the
  // selection does not jump to General as it leaves.
  const [section, setSection] = useState<SettingsSection>("general");

  if (settings !== undefined && settings.params.section !== section)
    setSection(settings.params.section);

  useLayoutEffect(() => {
    const node = contentRef.current;

    if (node === null) return;
    // Motion's useReducedMotion snapshots the preference at mount; this must stay live.
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const update = (): void =>
      setTransitions(
        reducedMotion.matches
          ? { list: INSTANT, archive: INSTANT }
          : {
              list: sidebarLayoutTransition(node, "--_sidebar-motion-duration"),
              archive: sidebarLayoutTransition(node, "--_sidebar-archive-duration"),
            },
      );

    update();
    reducedMotion.addEventListener("change", update);

    return () => reducedMotion.removeEventListener("change", update);
  }, []);

  // Archiving is a dismissal, not a rearrangement: one chat leaving gets a short
  // slide, a burst of them snaps rather than reading as churn. Rows read the
  // transition as they render, so the settle is spent by the time this commits.
  const settle = archiveSettle;
  useLayoutEffect(() => {
    archiveSettle = undefined;
  });

  const transition =
    settle === undefined ? transitions.list : settle === "single" ? transitions.archive : INSTANT;

  const shift = transitions.list === INSTANT ? 0 : LAYER_SHIFT;

  // The row that opened a layer is inert once it has; its counterpart on the
  // new layer takes the focus so the keyboard does not fall to the body.
  useLayoutEffect(() => {
    const node = contentRef.current;

    if (node === null || !node.contains(document.activeElement)) return;
    node
      .querySelector<HTMLElement>("[data-sidebar-layer]:not([inert]) [data-sidebar-return]")
      ?.focus({ preventScroll: true });
  }, [settingsOpen]);

  return (
    <nav
      ref={contentRef}
      aria-label={settingsOpen ? "Settings" : "Sessions and workspaces"}
      {...props(styles.content)}
    >
      <motion.div
        data-sidebar-layer="workspace"
        inert={settingsOpen}
        initial={false}
        animate={{ opacity: settingsOpen ? 0 : 1, x: settingsOpen ? -shift : 0 }}
        transition={transitions.list}
        {...props(styles.contentLayer)}
      >
        <MotionConfig reducedMotion="never" transition={{ layout: transition }}>
          <LayoutGroup id={layoutId} inherit={false}>
            {children}
          </LayoutGroup>
        </MotionConfig>
      </motion.div>
      <motion.div
        data-sidebar-layer="settings"
        inert={!settingsOpen}
        initial={false}
        animate={{ opacity: settingsOpen ? 1 : 0, x: settingsOpen ? 0 : shift }}
        transition={transitions.list}
        {...props(styles.contentLayer)}
      >
        <SettingsNavigation section={section} />
      </motion.div>
    </nav>
  );
}

function sessionTitle(session: SessionInfo): string {
  return session.name ?? "New chat";
}

/** One confirmation surface at a time: a chat deletion or a workspace-wide archive. */
type SidebarConfirmation =
  | { readonly kind: "closed" }
  | {
      readonly kind: "delete-session";
      readonly workspacePath: string | null;
      readonly sessionId: SessionId;
      readonly title: string;
    }
  | {
      readonly kind: "archive-all";
      readonly workspaceName: string;
      readonly sessionIds: readonly SessionId[];
    };

export function Sidebar(): ReactElement {
  const sessionListId = useId();
  const panes = usePaneActions();
  const host = useHostState();
  const open = host.data?.workspace;
  const workspacePath = open?.path;
  const workspaces = useWorkspaces();
  const sessionDirectory = useWorkspaceSessionDirectory();
  const server = useServerState(false);

  const cloudFailure =
    server.data?.kind === "unavailable" ? server.data.problem.message : undefined;

  const sessionActions = useSessionActions();
  const removeSession = useSessionRemoval();
  const renameSession = useRenameSession();
  const forgetWorkspace = useForgetWorkspace();
  const { layout } = usePaneControllerSnapshot();
  const draftStore = usePaneViewStateStore();
  useSyncExternalStore(draftStore.subscribe, draftStore.getSnapshot, draftStore.getSnapshot);
  const activeWorkspaceDrafts = draftStore.drafts();
  const [confirmation, setConfirmation] = useState<SidebarConfirmation>({ kind: "closed" });
  // Confirmations open from a context menu, which has no persistent trigger to
  // return focus to; the dialog falls back to the previously focused element.
  const confirmationReturnRef = useRef<HTMLButtonElement>(null);
  const github = nyte.host.github;
  const githubState = useGitHubState(github);
  const openFolder = folderPicker();
  const footerRowRef = useRef<HTMLDivElement>(null);
  const workspaceCollectionID = useId();
  const [collectionExpanded, setCollectionExpanded] = useState(true);
  const { stage, homeVisible, sidebarVisible } = useShellState();
  const router = useRouter();
  const settingsOpen = useMatch({ from: "/settings/$section", shouldThrow: false }) !== undefined;

  const openSettings = (section: SettingsSection): void => {
    const replace = router.state.matches.some((match) => match.routeId === "/settings/$section");
    void router.navigate({ to: "/settings/$section", params: { section }, replace });
  };

  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<ReadonlySet<WorkspaceId | null>>(
    () => new Set(),
  );

  const setExpanded = (workspace: WorkspaceId | null, expanded: boolean): void => {
    setCollapsedWorkspaces((current) => {
      const next = new Set(current);

      if (expanded) next.delete(workspace);
      else next.add(workspace);

      return next;
    });
  };

  const [cloudCollapsed, setCloudCollapsed] = useState(false);
  const cloudAvailable = server.data?.kind === "connected" && cloudFailure === undefined;

  const cloudFolderVisible = cloudFailure !== undefined;

  const [revealedSessions, setRevealedSessions] = useState<ReadonlyMap<string, number>>(
    () => new Map(),
  );

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [view, setSessionView] = useState<SessionViewSettings>(DEFAULT_SESSION_VIEW);
  const flat = view.grouping === "none" || view.grouping === "inbox";
  const workingSessions = useWorkingSessionIds();
  const selection = activePane(layout).selection;
  const paneSessionId = selection.kind === "session" ? selection.sessionId : undefined;
  const onWorkspace = stage.kind === "workspace";
  const activeSessionId = onWorkspace ? paneSessionId : undefined;

  const [hold, setHold] = useState<ShelfHold | undefined>();
  const [openShelves, setOpenShelves] = useState<ReadonlySet<SessionShelf>>(() => new Set());

  const paneSession =
    paneSessionId === undefined
      ? undefined
      : sessionDirectory.data
          ?.flatMap((directory) => directory.sessions)
          .find((session) => session.id === paneSessionId);

  if (hold?.sessionId !== paneSession?.id) {
    setHold(
      paneSession === undefined
        ? undefined
        : {
            sessionId: paneSession.id,
            shelf: shelfOf(paneSession, workingSessions, undefined),
          },
    );
  }

  const activeDraftId =
    onWorkspace && selection.kind === "blank"
      ? activePaneController(workspacePath).viewState.readBlank(activePane(layout).id).id
      : undefined;

  const mac = macPlatform(host.data?.platform);
  const filtersActive = hasSessionFilters(view);

  const showDrafts =
    (view.statuses.length === 0 || view.statuses.includes("draft")) &&
    (view.pullRequests.length === 0 || view.pullRequests.includes("none")) &&
    (view.environments.length === 0 || view.environments.includes("local"));

  // One fixed, name-ordered column: a click expands a row in place instead of
  // moving the opened workspace to the top.
  const entries: readonly ({ kind: "home" } | ({ kind: "project" } & RailWorkspace))[] = [
    ...(homeVisible ? [{ kind: "home" } as const] : []),
    ...(workspaces.data ?? [])
      .toSorted((left, right) => left.name.localeCompare(right.name))
      .map((workspace) => ({ kind: "project", ...workspace }) as const),
  ];

  const showSession = async (
    place: SessionPlace,
    sessionId: SessionId,
    beside = false,
    target: OpenTarget = "here",
  ): Promise<void> => {
    const path = place.kind === "local" ? (sessionFolderPath(sessionId) ?? null) : workspacePath;

    // A background tab leaves the current folder alone until it is shown.
    if (
      target !== "background" &&
      place.kind === "local" &&
      !(await activateWorkspace(path ?? null))
    )
      return;

    if (windowTabs.enabled) {
      const controller = windowTabs.controller();

      if (beside)
        controller.drop(sessionId, activePane(controller.getSnapshot().layout).id, "right");
      else windowTabs.dispatch({ kind: "open", place: { kind: "session", sessionId }, target });

      return;
    }

    const controller = paneControllerForWorkspace(path ?? undefined);

    if (beside) controller.drop(sessionId, activePane(controller.getSnapshot().layout).id, "right");
    else controller.selectSession(sessionId);
    shellActions.showWorkspace();
    await router.navigate({ to: "/session/$sessionId", params: { sessionId } });
  };

  const showDraft = async (draftId: string): Promise<void> => {
    activePaneController(workspacePath).selectDraft(draftId);

    if (windowTabs.enabled) return;
    shellActions.showWorkspace();
    await router.navigate({ to: "/" });
  };

  const newWorkspaceChat = async (
    place: Extract<SessionPlace, { kind: "local" }>,
  ): Promise<void> => {
    if (!(await activateWorkspace(place.path))) return;
    setExpanded(place.workspace, true);
    panes.newChat(place.path);
  };

  const closeConfirmation = (): void => {
    setConfirmation({ kind: "closed" });
  };

  const previewContextFor = (place: SessionPlace): SessionPreviewContext =>
    place.kind === "cloud"
      ? { kind: "cloud" }
      : place.path === null
        ? { kind: "home" }
        : {
            kind: "workspace",
            path: place.path,
            repository:
              place.workspace === open?.id &&
              (githubState.data?.kind === "ready" || githubState.data?.kind === "signed_out")
                ? githubState.data.repository
                : undefined,
          };

  const sessionRow = (
    place: SessionPlace,
    session: SessionInfo,
    layoutEnabled: boolean,
  ): ReactElement => {
    const path =
      place.kind === "local" ? (sessionFolderPath(session.id) ?? null) : (workspacePath ?? null);

    return (
      <SessionRow
        key={session.id}
        session={session}
        elsewhere={place.kind === "cloud" ? { icon: "cloud", name: "Cloud" } : undefined}
        unreachable={
          place.kind === "cloud"
            ? cloudFailure !== undefined
            : workspaces.data?.find((workspace) => workspace.id === session.workspace)
                ?.available === false
        }
        draggable={place.kind === "cloud" || place.workspace === (open?.id ?? null)}
        previewContext={previewContextFor(place)}
        selected={session.id === activeSessionId}
        working={workingSessions.has(session.id)}
        layoutEnabled={layoutEnabled}
        showUpdated={view.show.includes("updated")}
        onOpen={(target) => void showSession(place, session.id, false, target)}
        onOpenBeside={() => void showSession(place, session.id, true)}
        onRename={(name) => renameSession.mutate({ sessionId: session.id, name })}
        onDelete={() =>
          setConfirmation({
            kind: "delete-session",
            workspacePath: path,
            sessionId: session.id,
            title: sessionTitle(session),
          })
        }
        onPin={() => {
          sessionActions.pin({
            sessionId: session.id,
            pinned: !session.pinned,
          });
        }}
        onArchive={() => {
          recordArchive(1);
          sessionActions.archive([session.id], !session.archived, (id) => removeSession(path, id));
        }}
      />
    );
  };

  /**
   * One list across every folder, ranked by what each chat needs. Anything
   * running or waiting on you always shows; finished chats fold after a few.
   */
  const revealSessionList = (key: string, listId: string, visibleCount: number): void => {
    setRevealedSessions((current) =>
      new Map(current).set(key, (current.get(key) ?? 0) + SESSION_PAGE_SIZE),
    );
    window.requestAnimationFrame(() => {
      document
        .getElementById(listId)
        ?.querySelectorAll<HTMLElement>('[data-slot="row-primary"]')
        [visibleCount]?.focus();
    });
  };

  const order = sessionOrder(view.sortByStatus, workingSessions);

  const directories = sessionDirectory.data;

  const rows =
    directories === undefined
      ? undefined
      : directories
          .flatMap((directory) => {
            if (directory.workspacePath === null && !homeVisible) return [];

            const place = {
              kind: "local",
              workspace: directory.workspacePath === null ? null : directory.workspace,
              path: directory.workspacePath,
            } as const;

            return sessionsForView(directory.sessions, view, place.kind, undefined, workingSessions)
              .flatMap((group) => group.sessions)
              .map((session) => ({ place, session }));
          })
          .toSorted((left, right) => order(left.session, right.session));

  const chatsPanel = (): ReactElement | null => {
    const drafts = showDrafts ? activeWorkspaceDrafts : [];

    if (rows === undefined && drafts.length === 0) return null;

    const listed = rows ?? [];
    const layoutEnabled = sidebarVisible && collectionExpanded;
    const listId = `${sessionListId}-chats`;

    const empty = listed.length === 0 && drafts.length === 0 && (
      <>
        {filtersActive ? (
          <>
            <div {...props(text.base, styles.quiet, styles.sessionQuiet)}>
              No chats match these filters
            </div>
            <Row
              variant="nav"
              xstyle={styles.showMore}
              onClick={() => setSessionView(clearSessionFilters(view))}
            >
              Clear Filters
            </Row>
          </>
        ) : (
          <div {...props(text.base, styles.quiet, styles.sessionQuiet)}>No sessions yet</div>
        )}
      </>
    );

    const draftRows = drafts.map((draft) => (
      <DraftRow
        key={draft.id}
        draft={draft}
        selected={draft.id === activeDraftId}
        layoutEnabled={layoutEnabled}
        onOpen={() => void showDraft(draft.id)}
        onDelete={() => activePaneController(workspacePath).removeDraft(draft.id)}
      />
    ));

    const showMore = (key: string, id: string, next: number, focusIndex: number): ReactElement => (
      <Row
        variant="nav"
        aria-expanded={false}
        aria-controls={id}
        xstyle={styles.showMore}
        onClick={() => revealSessionList(key, id, focusIndex)}
      >
        Show {next} More
      </Row>
    );

    if (view.grouping === "inbox") {
      const shelved = (shelf: SessionShelf): typeof listed =>
        listed.filter(({ session }) => shelfOf(session, workingSessions, hold) === shelf);

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
          ? sessionPage(members.length, COLLAPSED_SESSION_LIMIT, revealedSessions.get(shelf) ?? 0)
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
            {visible.map(({ place, session }) => sessionRow(place, session, layoutEnabled && open))}
            {page.next > 0 && showMore(shelf, panelId, page.next, visible.length)}
          </Shelf>
        );
      };

      return (
        <div id={listId} {...props(styles.section)}>
          {empty}
          {draftRows}
          {inbox.map(({ place, session }) => sessionRow(place, session, layoutEnabled))}
          {inbox.length === 0 && drafts.length === 0 && listed.length > 0 && (
            <div {...props(text.base, styles.quiet, styles.sessionQuiet)}>Nothing new</div>
          )}
          {shelfPanel("working", "Working", <StatusDot mark="working" />, false)}
          {shelfPanel("done", "Done", <Icon name="inbox-checked" size={14} />, true)}
          {shelfPanel("archived", "Archived", <Icon name="archive" size={14} />, true)}
        </div>
      );
    }

    const live = listed.filter(
      ({ session }) => sessionActivityMark(session, workingSessions.has(session.id)) !== "idle",
    ).length;

    const page = sessionPage(
      listed.length,
      live + COLLAPSED_SESSION_LIMIT,
      revealedSessions.get("chats") ?? 0,
    );

    const visible = listed.slice(0, page.visible);

    return (
      <div id={listId} {...props(styles.section)}>
        {empty}
        {draftRows}
        {visible.map(({ place, session }) => sessionRow(place, session, layoutEnabled))}
        {page.next > 0 && showMore("chats", listId, page.next, visible.length + drafts.length)}
      </div>
    );
  };

  const sessionPanel = (place: SessionPlace): ReactElement | null => {
    const collapsed =
      place.kind === "local" ? collapsedWorkspaces.has(place.workspace) : cloudCollapsed;

    const drafts =
      showDrafts && place.kind === "local" && place.workspace === (open?.id ?? null)
        ? activeWorkspaceDrafts
        : [];

    const sessions =
      sessionDirectory.data === undefined
        ? undefined
        : place.kind === "local"
          ? localSessions(sessionDirectory.data, place.workspace)
          : undefined;

    if (sessions === undefined && drafts.length === 0) return null;

    const sessionGroups =
      sessions === undefined
        ? []
        : sessionsForView(sessions, view, place.kind, undefined, workingSessions);

    const displayedSessionCount = sessionGroups.reduce(
      (count, group) => count + group.sessions.length,
      drafts.length,
    );

    const listKey = place.kind === "cloud" ? "cloud" : `local:${place.workspace ?? "home"}`;

    const page = sessionPage(
      displayedSessionCount,
      COLLAPSED_SESSION_LIMIT,
      revealedSessions.get(listKey) ?? 0,
    );

    const visibleLimit = page.visible;

    const visibleDrafts = drafts.slice(0, visibleLimit);
    let remaining = visibleLimit - visibleDrafts.length;

    const visibleGroups = sessionGroups.flatMap((group) => {
      const visibleSessions = group.sessions.slice(0, remaining);
      remaining -= visibleSessions.length;

      return visibleSessions.length === 0 ? [] : [{ ...group, sessions: visibleSessions }];
    });

    const listId = `${sessionListId}-${encodeURIComponent(listKey)}`;

    return (
      <div id={listId} {...props(styles.section)}>
        {visibleDrafts.length > 0 && (
          <div {...props(styles.section)}>
            {view.grouping === "status" && (
              <div {...props(text.xs, styles.sessionGroupLabel)}>Draft</div>
            )}
            {visibleDrafts.map((draft) => (
              <DraftRow
                key={draft.id}
                draft={draft}
                selected={draft.id === activeDraftId}
                layoutEnabled={sidebarVisible && collectionExpanded && !collapsed}
                onOpen={() => void showDraft(draft.id)}
                onDelete={() => activePaneController(workspacePath).removeDraft(draft.id)}
              />
            ))}
          </div>
        )}
        {sessions !== undefined &&
          !(place.kind === "cloud" && cloudFailure !== undefined) &&
          displayedSessionCount === 0 &&
          (filtersActive ? (
            <>
              <div {...props(text.base, styles.quiet, styles.sessionQuiet)}>
                No chats match these filters
              </div>
              <Row
                variant="nav"
                xstyle={styles.showMore}
                onClick={() => setSessionView(clearSessionFilters(view))}
              >
                Clear Filters
              </Row>
            </>
          ) : (
            <div {...props(text.base, styles.quiet, styles.sessionQuiet)}>No sessions yet</div>
          ))}
        {visibleGroups.map((group) => (
          <div key={group.key} {...props(styles.section)}>
            {group.label !== undefined && (
              <div {...props(text.xs, styles.sessionGroupLabel)}>{group.label}</div>
            )}
            {group.sessions.map((session) =>
              sessionRow(place, session, sidebarVisible && collectionExpanded && !collapsed),
            )}
          </div>
        ))}
        {page.next > 0 && (
          <Row
            variant="nav"
            aria-expanded={false}
            aria-controls={listId}
            xstyle={styles.showMore}
            onClick={() => revealSessionList(listKey, listId, visibleLimit)}
          >
            Show {page.next} More
          </Row>
        )}
      </div>
    );
  };

  const activeDraftIsListed =
    showDrafts && activeWorkspaceDrafts.some((draft) => draft.id === activeDraftId);

  const newChatActive =
    stage.kind === "workspace" &&
    selection.kind === "blank" &&
    !activeDraftIsListed &&
    !paletteOpen;

  return (
    <aside {...props(styles.rail)}>
      <SidebarContent>
        <>
          <div {...props(styles.primaryActions)}>
            <Row
              variant="nav"
              selected={newChatActive}
              aria-current={newChatActive ? "page" : undefined}
              xstyle={[styles.navRow, newChatActive && styles.navRowActive]}
              onClick={() => panes.newChat()}
            >
              <Row.Leading xstyle={styles.navLeading}>
                <Icon name="new-chat" size={14} />
              </Row.Leading>
              <Row.Label>New Chat</Row.Label>
              <span {...props(styles.shortcutSlot, styles.shortcutPersistent)}>
                <Kbd keys={clientActionKeys(clientActions.newChat, mac)} />
              </span>
            </Row>

            <SearchPalette
              open={paletteOpen}
              platform={host.data?.platform}
              sessionQueriesAvailable={host.data !== undefined}
              recentSessions={rows?.map(({ session }) => session)}
              onOpenChange={setPaletteOpen}
              onOpenSession={(sessionId) => {
                if (windowTabs.enabled) {
                  windowTabs.dispatch({
                    kind: "open",
                    place: { kind: "session", sessionId },
                    target: "here",
                  });

                  return;
                }

                shellActions.showWorkspace();
                panes.openSession(sessionId);
              }}
              onNewChat={() => panes.newChat()}
              onOpenFolder={openFolder}
              onOpenHome={
                open === undefined
                  ? undefined
                  : () => {
                      shellActions.showWorkspace();
                      void nyte.host.closeWorkspace();
                    }
              }
              onOpenSettings={openSettings}
              onOpenCustomize={() => shellActions.openCustomize(paneSessionId)}
              trigger={
                <Row variant="nav" xstyle={styles.navRow}>
                  <Row.Leading xstyle={styles.navLeading}>
                    <Icon name="search" size={14} />
                  </Row.Leading>
                  <Row.Label>Search</Row.Label>
                  <span {...props(styles.shortcutSlot)}>
                    <Kbd keys={clientActionKeys(clientActions.search, mac)} />
                  </span>
                </Row>
              }
            />

            <Row
              variant="nav"
              selected={stage.kind === "customize"}
              aria-haspopup="dialog"
              aria-current={stage.kind === "customize" ? "page" : undefined}
              xstyle={styles.navRow}
              onClick={() => shellActions.openCustomize(paneSessionId)}
            >
              <Row.Leading xstyle={styles.navLeading}>
                <Icon name="customize" size={14} />
              </Row.Leading>
              <Row.Label>Customize</Row.Label>
            </Row>

            {nyte.clientSurface === "desktop" && (
              <Row
                variant="nav"
                selected={stage.kind === "environments"}
                aria-haspopup="dialog"
                aria-current={stage.kind === "environments" ? "page" : undefined}
                xstyle={styles.navRow}
                onClick={() => shellActions.openEnvironments()}
              >
                <Row.Leading xstyle={styles.navLeading}>
                  <Icon name="server" size={14} />
                </Row.Leading>
                <Row.Label>Environments</Row.Label>
              </Row>
            )}

            <Row
              variant="nav"
              data-sidebar-return
              aria-keyshortcuts={clientActionAriaShortcut(clientActions.settings, mac)}
              render={
                <Link to="/settings/$section" params={{ section: "general" }} preload="render" />
              }
              xstyle={styles.navRow}
            >
              <Row.Leading xstyle={styles.navLeading}>
                <Icon name="settings" size={14} />
              </Row.Leading>
              <Row.Label>Settings</Row.Label>
              <Icon name="chevron-right" size={14} />
            </Row>
          </div>

          <motion.div layoutScroll data-nyte-scrollport {...props(styles.scroll)}>
            <section aria-label={flat ? "Chats" : "Workspaces"} {...props(styles.section)}>
              <Collapsible.Root
                open={collectionExpanded}
                onOpenChange={setCollectionExpanded}
                {...props(styles.section)}
              >
                <div {...props(styles.sectionHeader)}>
                  <Collapsible.Trigger
                    aria-controls={workspaceCollectionID}
                    xstyle={[styles.sectionToggle, focus.ringInset]}
                  >
                    <span {...props(styles.sectionLabel)}>{flat ? "Chats" : "Workspaces"}</span>
                    <Collapsible.Chevron xstyle={styles.sectionChevron} />
                  </Collapsible.Trigger>
                  <WorkspaceControls
                    value={view}
                    homeVisible={homeVisible}
                    onHomeVisibleChange={shellActions.setHomeVisible}
                    filterDisabled={sessionDirectory.data === undefined}
                    onChange={setSessionView}
                    onOpenFolder={openFolder}
                    onCollapseAll={() =>
                      flat
                        ? setCollectionExpanded(false)
                        : setCollapsedWorkspaces(
                            new Set(
                              entries.map((entry) => (entry.kind === "home" ? null : entry.id)),
                            ),
                          )
                    }
                  />
                </div>

                <Collapsible.Panel
                  id={workspaceCollectionID}
                  {...props(styles.workspaceCollection)}
                >
                  {host.isPending && (
                    <div aria-busy="true" {...props(text.base, styles.quiet)}>
                      Loading…
                    </div>
                  )}
                  {flat ? (
                    host.data !== undefined && chatsPanel()
                  ) : (
                    <>
                      {host.data !== undefined &&
                        entries.map((entry) => {
                          const active =
                            entry.kind === "home" ? open === undefined : open?.id === entry.id;

                          const path = entry.kind === "home" ? null : entry.path;

                          const place = {
                            kind: "local",
                            workspace: entry.kind === "home" ? null : entry.id,
                            path,
                          } as const;

                          const sessions =
                            sessionDirectory.data === undefined
                              ? undefined
                              : localSessions(sessionDirectory.data, place.workspace);

                          return (
                            <WorkspaceRow
                              key={entry.kind === "home" ? "home" : entry.id}
                              name={entry.kind === "home" ? "Home" : entry.name}
                              path={entry.kind === "home" ? "Home" : entry.path}
                              available={entry.kind === "home" || entry.available !== false}
                              active={active}
                              expanded={!collapsedWorkspaces.has(place.workspace)}
                              onExpandedChange={(next) => setExpanded(place.workspace, next)}
                              onNewChat={
                                entry.kind === "home" || entry.available
                                  ? () => void newWorkspaceChat(place)
                                  : undefined
                              }
                              onArchiveAll={
                                sessions === undefined
                                  ? undefined
                                  : () =>
                                      setConfirmation({
                                        kind: "archive-all",
                                        workspaceName: entry.kind === "home" ? "Home" : entry.name,
                                        sessionIds: sessionsForNavigation(sessions).map(
                                          (session) => session.id,
                                        ),
                                      })
                              }
                              onRemove={
                                entry.kind === "home"
                                  ? () => shellActions.setHomeVisible(false)
                                  : () => forgetWorkspace.mutate(entry.id)
                              }
                            >
                              {sessionPanel(place)}
                            </WorkspaceRow>
                          );
                        })}
                      {host.data !== undefined &&
                        server.data !== undefined &&
                        server.data.kind !== "none" &&
                        cloudFolderVisible && (
                          <WorkspaceRow
                            name="Cloud"
                            path={server.data.baseUrl}
                            available={cloudAvailable}
                            unavailableDetail="server unavailable; showing last loaded chats"
                            active={false}
                            expanded={!cloudCollapsed}
                            onExpandedChange={(next) => setCloudCollapsed(!next)}
                            onNewChat={undefined}
                            onArchiveAll={undefined}
                            onRemove={() => void nyte.host.server.disconnect()}
                          >
                            {cloudFailure !== undefined && (
                              <div
                                role="status"
                                {...props(text.base, styles.quiet, styles.sessionQuiet)}
                              >
                                {cloudFailure}
                              </div>
                            )}
                            {sessionPanel({ kind: "cloud" })}
                          </WorkspaceRow>
                        )}
                    </>
                  )}
                </Collapsible.Panel>
              </Collapsible.Root>
            </section>
          </motion.div>
        </>
      </SidebarContent>

      {github !== undefined && (
        <div {...props(styles.footer)}>
          <div ref={footerRowRef} {...props(styles.footerRow)}>
            <AccountFooterMenu
              github={github}
              connect={nyte.host.connect}
              anchor={footerRowRef}
              onOpenProfile={() => openSettings("profile")}
            />
            <Toggle
              iconOnly
              icon="settings"
              aria-label="Settings"
              aria-keyshortcuts={clientActionAriaShortcut(clientActions.settings, mac)}
              pressed={settingsOpen}
              onPressedChange={(pressed) =>
                pressed ? openSettings("general") : closeSettings(router)
              }
            />
          </div>
        </div>
      )}
      {confirmation.kind === "delete-session" && (
        <ConfirmDialog
          open
          title="Delete Chat"
          confirmLabel="Delete Chat"
          description="The chat disappears now. Undo from the notification before it closes."
          finalFocus={confirmationReturnRef}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) closeConfirmation();
          }}
          onConfirm={() => {
            const { sessionId, workspacePath: deletedWorkspacePath } = confirmation;
            closeConfirmation();
            sessionActions.delete(sessionId, (id) => removeSession(deletedWorkspacePath, id));
          }}
        />
      )}
      {confirmation.kind === "archive-all" && (
        <ConfirmDialog
          open
          pending={false}
          error={undefined}
          finalFocus={confirmationReturnRef}
          title={`Archive All Chats in ${confirmation.workspaceName}`}
          description="Open chats move to the archive. You can restore any of them later."
          confirmLabel={`Archive All Chats in ${confirmation.workspaceName}`}
          pendingLabel="Archiving chats…"
          onOpenChange={(nextOpen) => {
            if (!nextOpen) closeConfirmation();
          }}
          onConfirm={() => {
            closeConfirmation();
            recordArchive(confirmation.sessionIds.length);
            sessionActions.archive(confirmation.sessionIds, true, (id) =>
              removeSession(sessionFolderPath(id) ?? null, id),
            );
          }}
        />
      )}
    </aside>
  );
}

/**
 * Every folder expands independently over its cached directory. Expansion
 * does not select a workspace or make an IPC request.
 */
function WorkspaceRow({
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
  /** Absent when this workspace's chats are not loaded, so the item does not render. */
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

function DraftRow({
  draft,
  selected,
  layoutEnabled,
  onOpen,
  onDelete,
}: {
  readonly draft: ChatDraft;
  readonly selected: boolean;
  readonly layoutEnabled: boolean;
  readonly onOpen: () => void;
  readonly onDelete: () => void;
}): ReactElement {
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

/** Where a chat runs when that is not this machine. */
interface SessionElsewhere {
  readonly icon: IconName;
  readonly name: string;
}

/** A chat running elsewhere carries that place as a corner badge; a chat here carries nothing. */
function SessionGlyph({
  session,
  mark,
  elsewhere,
}: {
  readonly session: SessionInfo;
  readonly mark: SessionMark;
  readonly elsewhere: SessionElsewhere | undefined;
}): ReactElement {
  if (elsewhere === undefined) return <StatusGlyph session={session} mark={mark} />;

  return (
    <span title={elsewhere.name} {...props(styles.sessionBadgeHost)}>
      <StatusGlyph session={session} mark={mark} />
      <span {...props(styles.sessionBadge)}>
        <Icon name={elsewhere.icon} size={9} label={elsewhere.name} />
      </span>
    </span>
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

type SessionPreviewContext =
  | { readonly kind: "home" }
  /** Runs on the connected server; no local folder to name. */
  | { readonly kind: "cloud" }
  | {
      readonly kind: "workspace";
      readonly path: string;
      readonly repository: Pick<GitHubRepository, "owner" | "name"> | undefined;
    };

interface SessionRowProps {
  session: SessionInfo;
  elsewhere: SessionElsewhere | undefined;
  /** Its machine can't be reached: the row stays and fades. */
  unreachable: boolean;
  draggable: boolean;
  previewContext: SessionPreviewContext;
  selected: boolean;
  working: boolean;
  layoutEnabled: boolean;
  showUpdated: boolean;
  onOpen: (target: OpenTarget) => void;
  onOpenBeside: () => void;
  onRename: (name: string) => void;
  onPin: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

function SessionRow({
  session,
  elsewhere,
  unreachable,
  draggable,
  previewContext,
  selected,
  working,
  layoutEnabled,
  showUpdated,
  onOpen,
  onOpenBeside,
  onRename,
  onPin,
  onArchive,
  onDelete,
}: SessionRowProps): ReactElement {
  const mark = sessionActivityMark(session, working);
  const title = sessionTitle(session);
  const ask = mark === "waiting" || mark === "failed" ? sessionAsk(session) : undefined;
  const [draftName, setDraftName] = useState<string | undefined>();

  const { isDragging, listeners, setNodeRef } = useSessionDraggable(session.id, title, !draggable);

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
          <SessionGlyph session={session} mark={mark} elsewhere={elsewhere} />
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
              // Hidden panels must never become shared-layout destinations.
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
        onAuxClick={(event) => {
          if (event.button === 1 && windowTabs.enabled) onOpen("background");
        }}
        {...listeners}
      >
        <Row.Leading xstyle={[styles.rowIcon, ask !== undefined && styles.rowIconAsk]}>
          <SessionGlyph session={session} mark={mark} elsewhere={elsewhere} />
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
        {previewContext.kind === "workspace" && (
          <div {...props(styles.previewDetails)}>
            {previewContext.repository !== undefined && (
              <div {...props(text.sm, styles.previewDetail)}>
                <span {...props(styles.previewDetailIcon)}>
                  <Icon name="git-branch" size={14} />
                </span>
                <span {...props(styles.previewDetailText)}>
                  {previewContext.repository.owner}/{previewContext.repository.name}
                </span>
              </div>
            )}
            <div {...props(text.sm, styles.previewDetail)}>
              <span {...props(styles.previewDetailIcon)}>
                <Icon name="folder" size={14} />
              </span>
              <span {...props(styles.previewDetailText)}>{previewContext.path}</span>
            </div>
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
