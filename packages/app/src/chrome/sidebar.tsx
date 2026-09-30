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
 * in-progress rename. A short hover intent warms local thread data.
 *
 * Based on https://github.com/interfaces-lab/honk/blob/main/packages/app/src/desktop-extensions/vertical-sidebar/view.tsx
 */
import { draftPreviewText } from "../conversation/message-references.ts";
import { userDisplayText } from "../conversation/transcript-presentation.ts";
import { failureNotice } from "../conversation/tool-copy.ts";
import * as stylex from "@stylexjs/stylex";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { Row } from "@nyte-ai/ui/row";
import { toast } from "@nyte-ai/ui/toast";
import { Link, useMatch, useRouter } from "@tanstack/react-router";
import { LayoutGroup, motion, MotionConfig } from "motion/react";
import type { Transition } from "motion/react";
// oxlint-disable-next-line no-restricted-imports -- neighbouring sessions preload as the active session changes
import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode, RefObject } from "react";
import type { SessionMark } from "@nyte-ai/client";
import type { SessionId, SessionInfo, WorkspaceInfo } from "@nyte-ai/protocol";
import type { ChatDraft } from "../layout/session-view-state.ts";
import { ConfirmDialog } from "@nyte-ai/ui/alert-dialog";
import { Icon, type IconName } from "@nyte-ai/ui/icon";
import { Input } from "@nyte-ai/ui/input";
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from "@nyte-ai/ui/context-menu";
import { Menu, MenuItem, MenuSeparator } from "@nyte-ai/ui/menu";
import { formatTimeAgo, StatusDot } from "../components/ui.tsx";
import { focus } from "@nyte-ai/ui/a11y.stylex";
import { Button } from "@nyte-ai/ui/button";
import { Kbd } from "@nyte-ai/ui/kbd";
import {
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
  keys,
  queryClient,
  useForgetWorkspace,
  useHostState,
  useRenameSession,
  useServerState,
  useSessionActions,
  useWorkspaceSessionDirectory,
  useWorkspaces,
} from "../queries.ts";
import { nyte } from "../nyte.ts";
import {
  sessionHasUnreadCompletion,
  sessionReadState,
  useReadSessions,
} from "../session-read-state.ts";
import { useDebouncedValue } from "../use-debounced-value.ts";
import { sessionActivityMark } from "../session-activity.ts";
import { useOptimisticSessionIds } from "../use-outbox.ts";
import { useMountEffect } from "../use-mount-effect.ts";
import { sidebarStyles as styles } from "./sidebar.stylex.ts";
import { signOutDescription, useGitHubAccount, useGitHubState } from "./github-account.ts";
import { folderPicker } from "./open-workspace.tsx";
import { SearchPalette } from "./search-palette.tsx";
import { SessionPreviewCard, type SessionPreviewContext } from "./sidebar-session-preview.tsx";
import { WorkspaceControls } from "./sidebar-filter.tsx";
import {
  clearSessionFilters,
  DEFAULT_SESSION_VIEW,
  needsCompleteSessionDirectory,
  sessionIsDraft,
  sessionOrder,
  sessionsForNavigation,
  sessionsForView,
  type SessionViewSettings,
} from "./sidebar-view.ts";
import { SettingsNavigation, type SettingsSection } from "./settings-navigation.tsx";
import { shellActions, useShellState } from "./shell-state.ts";
import { activateWorkspace } from "./use-show-session.ts";
import { clientActionAriaShortcut, clientActionKeys, clientActions } from "../client-actions.ts";
import { cloudSessions, localSessions } from "../bridge.ts";
import type { GitHubBridge } from "../bridge.ts";

/** Which list a sidebar panel shows: one local store, or the connected server's sessions. */
type SessionPlace =
  | { readonly kind: "local"; readonly path: string | null }
  | { readonly kind: "cloud" };

const COLLAPSED_SESSION_LIMIT = 5;

const REPORT_ISSUE_URL = "https://github.com/interfaces-lab/nyte/issues/new";

function draftsMatchView(view: SessionViewSettings): boolean {
  return (
    view.statuses.includes("draft") &&
    view.pullRequests.includes("none") &&
    view.environments.includes("local") &&
    view.sources.includes("desktop")
  );
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
      {...stylex.props(styles.content)}
    >
      <motion.div
        data-sidebar-layer="workspace"
        inert={settingsOpen}
        initial={false}
        animate={{ opacity: settingsOpen ? 0 : 1, x: settingsOpen ? -shift : 0 }}
        transition={transitions.list}
        {...stylex.props(styles.contentLayer)}
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
        {...stylex.props(styles.contentLayer)}
      >
        <SettingsNavigation section={section} />
      </motion.div>
    </nav>
  );
}

function sessionTitle(session: SessionInfo): string {
  return (
    session.name ?? (session.preview === undefined ? "New chat" : userDisplayText(session.preview))
  );
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
      readonly workspacePath: string | null;
      readonly sessionIds: readonly SessionId[];
    };

export function Sidebar(): ReactElement {
  const panes = usePaneActions();
  const host = useHostState();
  const open = host.data?.workspace;
  const workspacePath = open?.path;
  const workspaces = useWorkspaces();
  const sessionDirectory = useWorkspaceSessionDirectory();
  const server = useServerState(false);

  const cloudDirectory = sessionDirectory.data?.find(
    (directory) => directory.environment === "cloud",
  );

  const cloudFailure =
    cloudDirectory?.availability.kind === "unavailable"
      ? cloudDirectory.availability.message
      : server.data?.kind === "unavailable"
        ? server.data.problem.message
        : undefined;

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

  const openSettings = (section: SettingsSection): void => {
    const replace = router.state.matches.some((match) => match.routeId === "/settings/$section");
    void router.navigate({ to: "/settings/$section", params: { section }, replace });
  };

  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<ReadonlySet<string | null>>(
    () => new Set(),
  );

  const setExpanded = (path: string | null, expanded: boolean): void => {
    setCollapsedWorkspaces((current) => {
      const next = new Set(current);

      if (expanded) next.delete(path);
      else next.add(path);

      return next;
    });
  };

  const [cloudCollapsed, setCloudCollapsed] = useState(false);
  const cloudAvailable = server.data?.kind === "connected" && cloudFailure === undefined;

  // New chat's environment picker creates cloud chats; the folder only lists
  // them, so it appears once the first chat exists or when a failure needs showing.
  const cloudFolderVisible =
    cloudFailure !== undefined || (cloudDirectory?.sessions.length ?? 0) > 0;

  const [expandedSessionLists, setExpandedSessionLists] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [view, setSessionView] = useState<SessionViewSettings>(DEFAULT_SESSION_VIEW);
  // Without a grouping the rail is one list of chats; folders are a grouping you pick.
  const flat = view.grouping === "none";
  const readSessions = useReadSessions();
  const optimisticSessions = useOptimisticSessionIds();
  const selection = activePane(layout).selection;
  const activeSessionId = selection.kind === "session" ? selection.sessionId : undefined;

  const activeDraftId =
    selection.kind === "blank"
      ? paneControllerForWorkspace(workspacePath).viewState.readBlank(activePane(layout).id).id
      : undefined;

  const mac = macPlatform(host.data?.platform);
  const completeDirectoryRequired = needsCompleteSessionDirectory(view);

  // The next switch is most often to a neighbouring row; its snapshot is warm
  // before the pointer or the arrow key gets there.
  const activeWorkspaceSessions =
    sessionDirectory.data === undefined
      ? undefined
      : localSessions(sessionDirectory.data, workspacePath ?? null);

  useEffect(() => {
    if (activeSessionId === undefined || activeWorkspaceSessions === undefined) return;

    const ordered = sessionsForView(
      activeWorkspaceSessions,
      view,
      "local",
      Date.now(),
      readSessions,
      optimisticSessions,
    ).flatMap((group) => group.sessions);

    const index = ordered.findIndex((session) => session.sessionId === activeSessionId);

    if (index === -1) return;

    for (const neighbour of [ordered[index - 1], ordered[index + 1]]) {
      if (neighbour !== undefined)
        void router.preloadRoute({
          to: "/session/$sessionId",
          params: { sessionId: neighbour.sessionId },
        });
    }
  }, [activeSessionId, activeWorkspaceSessions, optimisticSessions, readSessions, router, view]);

  // One fixed, name-ordered column: a click expands a row in place instead of
  // moving the opened workspace to the top.
  const entries: readonly ({ kind: "home" } | ({ kind: "project" } & WorkspaceInfo))[] = [
    ...(homeVisible ? [{ kind: "home" } as const] : []),
    ...(workspaces.data ?? [])
      .toSorted((left, right) => left.name.localeCompare(right.name))
      .map((workspace) => ({ kind: "project", ...workspace }) as const),
  ];

  const showSession = async (
    place: SessionPlace,
    sessionId: SessionId,
    beside = false,
  ): Promise<void> => {
    // A local session selects its folder first. A server session opens in
    // whichever folder's panes are showing; nothing local is selected.
    if (place.kind === "local" && !(await activateWorkspace(place.path))) return;

    const controller = paneControllerForWorkspace(
      place.kind === "local" ? (place.path ?? undefined) : workspacePath,
    );

    if (beside) controller.drop(sessionId, activePane(controller.getSnapshot().layout).id, "right");
    else controller.selectSession(sessionId);
    shellActions.showWorkspace();
    await router.navigate({ to: "/session/$sessionId", params: { sessionId } });
  };

  const showDraft = async (draftId: string): Promise<void> => {
    paneControllerForWorkspace(workspacePath).selectDraft(draftId);
    shellActions.showWorkspace();
    await router.navigate({ to: "/" });
  };

  const newWorkspaceChat = async (path: string | null): Promise<void> => {
    if (!(await activateWorkspace(path))) return;
    setExpanded(path, true);
    paneControllerForWorkspace(path ?? undefined).newChat();
    shellActions.showWorkspace();
    await router.navigate({ to: "/" });
  };

  const closeConfirmation = (): void => {
    setConfirmation({ kind: "closed" });
  };

  const newCloudChat = async (): Promise<void> => {
    try {
      setCloudCollapsed(false);
      const session = await nyte.host.server.createSession();
      await showSession({ kind: "cloud" }, session.sessionId);
    } catch {
      toast.error("Couldn't create a Cloud chat. Check the server connection in Settings.");
      void queryClient.invalidateQueries({ queryKey: keys.server });
    }
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
              place.path === workspacePath &&
              (githubState.data?.kind === "ready" || githubState.data?.kind === "signed_out")
                ? githubState.data.repository
                : undefined,
          };

  const sessionRow = (
    place: SessionPlace,
    session: SessionInfo,
    layoutEnabled: boolean,
  ): ReactElement => {
    // Drag and pane bookkeeping belong to the row's own folder; a server row
    // borrows whichever folder's panes are showing.
    const path = place.kind === "local" ? place.path : (workspacePath ?? null);

    return (
      <SessionRow
        key={session.sessionId}
        session={session}
        elsewhere={place.kind === "cloud" ? { icon: "cloud", name: "Cloud" } : undefined}
        unreachable={place.kind === "cloud" && cloudFailure !== undefined}
        draggable={path === (workspacePath ?? null)}
        previewContext={previewContextFor(place)}
        selected={session.sessionId === activeSessionId}
        optimistic={optimisticSessions.has(session.sessionId)}
        layoutEnabled={layoutEnabled}
        showUpdated={view.show.includes("updated")}
        onOpen={() => {
          sessionReadState.markRead(session);
          void showSession(place, session.sessionId);
        }}
        onOpenBeside={() => {
          sessionReadState.markRead(session);
          void showSession(place, session.sessionId, true);
        }}
        onHover={() =>
          void router.preloadRoute({
            to: "/session/$sessionId",
            params: { sessionId: session.sessionId },
          })
        }
        onRename={(name) => renameSession.mutate({ sessionId: session.sessionId, name })}
        onDelete={() =>
          setConfirmation({
            kind: "delete-session",
            workspacePath: path,
            sessionId: session.sessionId,
            title: sessionTitle(session),
          })
        }
        onPin={() => {
          sessionActions.pin({
            sessionId: session.sessionId,
            pinned: !session.pinned,
          });
        }}
        onArchive={() => {
          recordArchive(1);
          sessionActions.archive([session.sessionId], !session.archived, (id) =>
            removeSession(path, id),
          );
        }}
      />
    );
  };

  /**
   * One list across every folder, ranked by what each chat needs. Anything
   * running or waiting on you always shows; finished chats fold after a few.
   */
  const chatsPanel = (): ReactElement | null => {
    const directories = sessionDirectory.data;
    const drafts = draftsMatchView(view) ? activeWorkspaceDrafts : [];

    if (directories === undefined && drafts.length === 0) return null;

    const places: readonly SessionPlace[] = [
      ...entries.map((entry): SessionPlace => ({
        kind: "local",
        path: entry.kind === "home" ? null : entry.path,
      })),
      ...(cloudFolderVisible ? [{ kind: "cloud" } as const] : []),
    ];

    const order = sessionOrder(view.ordering, optimisticSessions);

    const rows =
      directories === undefined
        ? []
        : places
            .flatMap((place) =>
              sessionsForView(
                (place.kind === "local"
                  ? localSessions(directories, place.path)
                  : cloudSessions(directories)) ?? [],
                view,
                place.kind,
                undefined,
                readSessions,
                optimisticSessions,
              )
                .flatMap((group) => group.sessions)
                .map((session) => ({ place, session })),
            )
            .toSorted((left, right) => order(left.session, right.session));

    const live = rows.filter(
      ({ session }) =>
        sessionActivityMark(session, optimisticSessions.has(session.sessionId)) !== "idle",
    ).length;

    const limit = live + COLLAPSED_SESSION_LIMIT;
    const listExpanded = expandedSessionLists.has("chats");
    const hasOverflow = rows.length > limit + 1;
    const visible = listExpanded || !hasOverflow ? rows : rows.slice(0, limit);
    const layoutEnabled = sidebarVisible && collectionExpanded;

    return (
      <>
        {rows.length === 0 &&
          drafts.length === 0 &&
          (completeDirectoryRequired ? (
            <>
              <div {...stylex.props(styles.quiet, styles.sessionQuiet)}>
                No chats match these filters
              </div>
              <Row
                variant="nav"
                xstyle={styles.showMore}
                onClick={() => setSessionView(clearSessionFilters(view))}
              >
                Clear filters
              </Row>
            </>
          ) : (
            <div {...stylex.props(styles.quiet, styles.sessionQuiet)}>No sessions yet</div>
          ))}
        {drafts.map((draft) => (
          <DraftRow
            key={draft.id}
            draft={draft}
            selected={draft.id === activeDraftId}
            layoutEnabled={layoutEnabled}
            onOpen={() => void showDraft(draft.id)}
            onDelete={() => paneControllerForWorkspace(workspacePath).removeDraft(draft.id)}
          />
        ))}
        {visible.map(({ place, session }) => sessionRow(place, session, layoutEnabled))}
        {hasOverflow && (
          <Row
            variant="nav"
            aria-expanded={listExpanded}
            xstyle={styles.showMore}
            onClick={() =>
              setExpandedSessionLists((current) => {
                const next = new Set(current);

                if (next.has("chats")) next.delete("chats");
                else next.add("chats");

                return next;
              })
            }
          >
            {listExpanded ? "Show less" : "Show more"}
          </Row>
        )}
      </>
    );
  };

  const sessionPanel = (place: SessionPlace): ReactElement | null => {
    // Drafts, drag, and pane bookkeeping belong to the folder whose panes are showing.
    const path = place.kind === "local" ? place.path : (workspacePath ?? null);
    const collapsed = place.kind === "local" ? collapsedWorkspaces.has(place.path) : cloudCollapsed;

    const workspaceDrafts =
      place.kind === "local" && path === (workspacePath ?? null) ? activeWorkspaceDrafts : [];

    const showDrafts = draftsMatchView(view);
    const drafts = showDrafts ? workspaceDrafts : [];

    const sessions =
      sessionDirectory.data === undefined
        ? undefined
        : place.kind === "local"
          ? localSessions(sessionDirectory.data, place.path)
          : cloudSessions(sessionDirectory.data);

    if (sessions === undefined && drafts.length === 0) return null;

    const sessionGroups =
      sessions === undefined
        ? []
        : sessionsForView(sessions, view, place.kind, undefined, readSessions, optimisticSessions);

    const displayedSessionCount = sessionGroups.reduce(
      (count, group) => count + group.sessions.length,
      drafts.length,
    );

    const listKey = place.kind === "cloud" ? "cloud" : `local:${place.path ?? ""}`;
    const listExpanded = expandedSessionLists.has(listKey);
    const hasOverflow = displayedSessionCount > COLLAPSED_SESSION_LIMIT + 1;

    const visibleLimit =
      listExpanded || !hasOverflow ? displayedSessionCount : COLLAPSED_SESSION_LIMIT;

    const visibleDrafts = drafts.slice(0, visibleLimit);
    let remaining = visibleLimit - visibleDrafts.length;

    const visibleGroups = sessionGroups.flatMap((group) => {
      const visibleSessions = group.sessions.slice(0, remaining);
      remaining -= visibleSessions.length;

      return visibleSessions.length === 0 ? [] : [{ ...group, sessions: visibleSessions }];
    });

    return (
      <>
        {visibleDrafts.length > 0 && (
          <div {...stylex.props(styles.section)}>
            {view.grouping === "status" && (
              <div {...stylex.props(styles.sessionGroupLabel)}>Draft</div>
            )}
            {visibleDrafts.map((draft) => (
              <DraftRow
                key={draft.id}
                draft={draft}
                selected={path === (workspacePath ?? null) && draft.id === activeDraftId}
                layoutEnabled={sidebarVisible && collectionExpanded && !collapsed}
                onOpen={() => void showDraft(draft.id)}
                onDelete={() => paneControllerForWorkspace(workspacePath).removeDraft(draft.id)}
              />
            ))}
          </div>
        )}
        {sessions !== undefined &&
          !(place.kind === "cloud" && cloudFailure !== undefined) &&
          displayedSessionCount === 0 &&
          (completeDirectoryRequired ? (
            <>
              <div {...stylex.props(styles.quiet, styles.sessionQuiet)}>
                No chats match these filters
              </div>
              <Row
                variant="nav"
                xstyle={styles.showMore}
                onClick={() => setSessionView(clearSessionFilters(view))}
              >
                Clear filters
              </Row>
            </>
          ) : (
            <div {...stylex.props(styles.quiet, styles.sessionQuiet)}>No sessions yet</div>
          ))}
        {visibleGroups.map((group) => (
          <div key={group.key} {...stylex.props(styles.section)}>
            {group.label !== undefined && (
              <div {...stylex.props(styles.sessionGroupLabel)}>{group.label}</div>
            )}
            {group.sessions.map((session) =>
              sessionRow(place, session, sidebarVisible && collectionExpanded && !collapsed),
            )}
          </div>
        ))}
        {hasOverflow && (
          <Row
            variant="nav"
            aria-expanded={listExpanded}
            xstyle={styles.showMore}
            onClick={() =>
              setExpandedSessionLists((current) => {
                const next = new Set(current);

                if (next.has(listKey)) next.delete(listKey);
                else next.add(listKey);

                return next;
              })
            }
          >
            {listExpanded ? "Show less" : "Show more"}
          </Row>
        )}
      </>
    );
  };

  const activeDraftIsListed =
    draftsMatchView(view) && activeWorkspaceDrafts.some((draft) => draft.id === activeDraftId);

  const newChatActive =
    stage.kind === "workspace" &&
    selection.kind === "blank" &&
    !activeDraftIsListed &&
    !paletteOpen;

  return (
    <aside {...stylex.props(styles.rail)}>
      <SidebarContent>
        <>
          <div {...stylex.props(styles.primaryActions)}>
            <Row
              variant="nav"
              selected={newChatActive}
              aria-current={newChatActive ? "page" : undefined}
              xstyle={[styles.navRow, newChatActive && styles.navRowActive]}
              onClick={() => panes.newChat()}
            >
              <Row.Leading>
                <Icon name="new-chat" size={14} />
              </Row.Leading>
              <Row.Label>New Chat</Row.Label>
              <span {...stylex.props(styles.shortcutSlot, styles.shortcutPersistent)}>
                <Kbd keys={clientActionKeys(clientActions.newChat, mac)} />
              </span>
            </Row>

            <SearchPalette
              open={paletteOpen}
              platform={host.data?.platform}
              sessionQueriesAvailable={host.data !== undefined}
              onOpenChange={setPaletteOpen}
              onOpenSession={(sessionId) => {
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
              onOpenCustomize={() => shellActions.openCustomize(activeSessionId)}
              trigger={
                <Row variant="nav" xstyle={styles.navRow}>
                  <Row.Leading>
                    <Icon name="search" size={14} />
                  </Row.Leading>
                  <Row.Label>Search</Row.Label>
                  <span {...stylex.props(styles.shortcutSlot)}>
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
              onClick={() => shellActions.openCustomize(activeSessionId)}
            >
              <Row.Leading>
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
                <Row.Leading>
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
              <Row.Leading>
                <Icon name="settings" size={14} />
              </Row.Leading>
              <Row.Label>Settings</Row.Label>
              <Icon name="chevron-right" size={14} />
            </Row>
          </div>

          <motion.div layoutScroll data-nyte-scrollport {...stylex.props(styles.scroll)}>
            <section aria-label={flat ? "Chats" : "Workspaces"} {...stylex.props(styles.section)}>
              <Collapsible.Root
                open={collectionExpanded}
                onOpenChange={setCollectionExpanded}
                {...stylex.props(styles.section)}
              >
                <div {...stylex.props(styles.sectionHeader)}>
                  <Collapsible.Trigger
                    aria-controls={workspaceCollectionID}
                    xstyle={[styles.sectionToggle, focus.ringInset]}
                  >
                    <span {...stylex.props(styles.sectionLabel)}>
                      {flat ? "Chats" : "Workspaces"}
                    </span>
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
                              entries.map((entry) => (entry.kind === "home" ? null : entry.path)),
                            ),
                          )
                    }
                  />
                </div>

                <Collapsible.Panel
                  id={workspaceCollectionID}
                  {...stylex.props(styles.workspaceCollection)}
                >
                  {host.isPending && (
                    <div aria-busy="true" {...stylex.props(styles.quiet)}>
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
                            entry.kind === "home" ? open === undefined : open?.path === entry.path;

                          const path = entry.kind === "home" ? null : entry.path;

                          const sessions =
                            sessionDirectory.data === undefined
                              ? undefined
                              : localSessions(sessionDirectory.data, path);

                          return (
                            <WorkspaceRow
                              key={entry.kind === "home" ? "home" : entry.path}
                              name={entry.kind === "home" ? "Home" : entry.name}
                              path={entry.kind === "home" ? "Home" : entry.path}
                              available={entry.kind === "home" || entry.available !== false}
                              active={active}
                              expanded={!collapsedWorkspaces.has(path)}
                              onExpandedChange={(next) => setExpanded(path, next)}
                              onNewChat={() => void newWorkspaceChat(path)}
                              onArchiveAll={
                                sessions === undefined
                                  ? undefined
                                  : () =>
                                      setConfirmation({
                                        kind: "archive-all",
                                        workspaceName: entry.kind === "home" ? "Home" : entry.name,
                                        workspacePath: path,
                                        sessionIds: sessionsForNavigation(sessions).map(
                                          (session) => session.sessionId,
                                        ),
                                      })
                              }
                              onRemove={
                                entry.kind === "home"
                                  ? () => shellActions.setHomeVisible(false)
                                  : () => forgetWorkspace.mutate(entry.path)
                              }
                            >
                              {sessionPanel({ kind: "local", path })}
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
                            onNewChat={cloudAvailable ? () => void newCloudChat() : undefined}
                            onArchiveAll={undefined}
                            onRemove={() => void nyte.host.server.disconnect()}
                          >
                            {cloudFailure !== undefined && (
                              <div
                                role="status"
                                {...stylex.props(styles.quiet, styles.sessionQuiet)}
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
        <div {...stylex.props(styles.footer)}>
          <div ref={footerRowRef} {...stylex.props(styles.footerRow)}>
            <AccountFooterMenu github={github} anchor={footerRowRef} />
          </div>
        </div>
      )}
      {confirmation.kind === "delete-session" && (
        <ConfirmDialog
          open
          title="Delete chat?"
          description="The chat disappears now. Undo from the notification before it closes."
          returnFocusRef={confirmationReturnRef}
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
          returnFocusRef={confirmationReturnRef}
          title={`Archive all chats in ${confirmation.workspaceName}?`}
          description="Open chats move to the archive. You can restore any of them later."
          confirmLabel="Archive all"
          pendingLabel="Archiving…"
          onOpenChange={(nextOpen) => {
            if (!nextOpen) closeConfirmation();
          }}
          onConfirm={() => {
            closeConfirmation();
            recordArchive(confirmation.sessionIds.length);
            sessionActions.archive(confirmation.sessionIds, true, (id) =>
              removeSession(confirmation.workspacePath, id),
            );
          }}
        />
      )}
    </aside>
  );
}

/**
 * The account row is the stable trigger for account-level actions. GitHub is
 * optional, so unresolved and projectless states keep the generic label
 * instead of making the footer disappear while a workspace changes.
 */
function AccountFooterMenu({
  github,
  anchor,
}: {
  github: GitHubBridge;
  anchor: RefObject<HTMLDivElement | null>;
}): ReactElement {
  const account = useGitHubAccount(github);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const state = account.query.data;
  const avatarUrl = state?.kind === "ready" ? state.account.avatarUrl : undefined;
  const label = state?.kind === "ready" ? state.account.login : "Accounts";

  return (
    <>
      <Menu
        label="Account menu"
        side="top"
        align="start"
        anchor={anchor}
        sideOffset={4}
        highlightItemOnHover={false}
        trigger={
          <Row
            ref={triggerRef}
            variant="nav"
            aria-label={`${label} menu`}
            disabled={account.busy}
            xstyle={[styles.navRow, styles.accountButton]}
          >
            <Row.Leading xstyle={styles.avatarSlot}>
              {avatarUrl === undefined ? (
                <Icon name="user" size={14} />
              ) : (
                <img alt="" src={avatarUrl} {...stylex.props(styles.avatar)} />
              )}
            </Row.Leading>
            <Row.Label>{label}</Row.Label>
          </Row>
        }
      >
        <MenuItem
          icon="bubble-question"
          xstyle={styles.accountMenuItem}
          onSelect={() => void nyte.host.openExternal({ url: REPORT_ISSUE_URL })}
        >
          Report issue
        </MenuItem>
        {state?.kind === "ready" && (
          <>
            <MenuSeparator inset />
            <MenuItem icon="arrow-wall-left" danger onSelect={() => setConfirmingSignOut(true)}>
              Sign out
            </MenuItem>
          </>
        )}
      </Menu>
      {state?.kind === "ready" && (
        <ConfirmDialog
          open={confirmingSignOut}
          pending={account.busy}
          error={
            account.auth.isError
              ? "Sign-out failed. Run gh auth status in a terminal, then try again."
              : undefined
          }
          returnFocusRef={triggerRef}
          title="Sign out of GitHub CLI?"
          description={signOutDescription(state.account.login)}
          confirmLabel="Sign out"
          pendingLabel="Signing out…"
          onOpenChange={setConfirmingSignOut}
          onConfirm={() =>
            account.auth.mutate("signOut", { onSuccess: () => setConfirmingSignOut(false) })
          }
        />
      )}
    </>
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
  const row = (
    <Row
      revealActions
      xstyle={[styles.rowSurface, styles.workspaceRow, !available && styles.workspaceUnavailable]}
    >
      <Row.Primary
        xstyle={[styles.rowPrimary, styles.workspacePrimary]}
        render={
          <Collapsible.Trigger
            variant="plain"
            title={available ? path : `${path} (${unavailableDetail})`}
            aria-current={active ? "location" : undefined}
          />
        }
      >
        <Row.Leading xstyle={styles.rowIcon}>
          <span {...stylex.props(styles.workspaceGlyph)}>
            <span {...stylex.props(styles.workspaceFolder)}>
              <Icon name={expanded ? "folder-open" : "folder"} size={14} />
            </span>
            <span
              {...stylex.props(styles.workspaceChevron, expanded && styles.workspaceChevronOpen)}
            >
              <Icon name="chevron-down" size={13} />
            </span>
          </span>
        </Row.Leading>
        <Row.Label>{name}</Row.Label>
      </Row.Primary>
      <Row.Actions placement="overlay" xstyle={styles.workspaceActions}>
        <Button
          size="sm"
          iconOnly
          icon="new-chat-folder"
          aria-label={`New chat in ${name}`}
          onClick={onNewChat}
          disabled={onNewChat === undefined}
        />
      </Row.Actions>
    </Row>
  );

  return (
    <Collapsible.Root
      open={expanded}
      onOpenChange={onExpandedChange}
      {...stylex.props(styles.section)}
    >
      <ContextMenu label={`Actions for ${name}`} trigger={row}>
        <ContextMenuItem
          icon="new-chat-folder"
          disabled={onNewChat === undefined}
          onSelect={() => onNewChat?.()}
        >
          New chat
        </ContextMenuItem>
        {onArchiveAll !== undefined && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem icon="archive" onSelect={onArchiveAll}>
              Archive all chats
            </ContextMenuItem>
          </>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem icon="trash" danger onSelect={onRemove}>
          Remove from sidebar
        </ContextMenuItem>
      </ContextMenu>
      <Collapsible.Panel {...stylex.props(styles.sessionList)}>{children}</Collapsible.Panel>
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
        xstyle={styles.rowPrimary}
        title={`Draft: ${title}`}
        aria-current={selected ? "page" : undefined}
        onClick={onOpen}
      >
        <Row.Leading xstyle={styles.rowIcon}>
          <span role="img" aria-label="Draft" {...stylex.props(styles.draftDot)} />
        </Row.Leading>
        <Row.Label xstyle={styles.sessionLabel}>{title}</Row.Label>
        <Row.Meta xstyle={styles.rowMeta}>{formatTimeAgo(draft.updatedAt)}</Row.Meta>
      </Row.Primary>
      <Row.Actions
        placement="overlay"
        data-nyte-session-row-actions=""
        xstyle={[styles.rowActions, styles.rowActionsBesideMeta]}
      >
        <Button
          size="2xs"
          iconOnly
          icon="trash"
          aria-label={`Delete draft: ${title}`}
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        />
      </Row.Actions>
    </Row>
  );

  return (
    <ContextMenu label={`Actions for draft: ${title}`} trigger={row}>
      <ContextMenuItem icon="trash" danger onSelect={onDelete}>
        Delete draft
      </ContextMenuItem>
    </ContextMenu>
  );
}

/** Where a chat runs when that is not this machine. */
interface SessionElsewhere {
  readonly icon: IconName;
  readonly name: string;
}

/**
 * One glyph per stage, by shape: the live marks while a run works, waits, or
 * failed; an eye once it finished and nobody has opened it; the draft glyph
 * for a chat nothing has been said in.
 */
function StatusGlyph({
  session,
  mark,
}: {
  readonly session: SessionInfo;
  readonly mark: SessionMark;
}): ReactElement | null {
  const read = useReadSessions();

  if (mark !== "idle") return <StatusDot mark={mark} />;

  if (sessionHasUnreadCompletion(session, read))
    return <Icon name="eye" size={14} label="Unread" />;

  return sessionIsDraft(session) ? <Icon name="draft" size={14} label="Draft" /> : null;
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
    <span title={elsewhere.name} {...stylex.props(styles.sessionBadgeHost)}>
      <StatusGlyph session={session} mark={mark} />
      <span {...stylex.props(styles.sessionBadge)}>
        <Icon name={elsewhere.icon} size={9} label={elsewhere.name} />
      </span>
    </span>
  );
}

/** What a row that needs you is waiting on: the question asked, or why the run failed. */
function sessionAsk(session: SessionInfo): string | undefined {
  for (const head of session.heads) {
    const run = head.run;

    if (run?.phase.kind === "waiting" && run.awaitingReply === true) return run.question;
  }

  for (const head of session.heads)
    if (head.run?.phase.kind === "failed") return failureNotice(head.run.phase.failure).text;

  return undefined;
}

interface SessionRowProps {
  session: SessionInfo;
  elsewhere: SessionElsewhere | undefined;
  /** Its machine can't be reached: the row stays and fades. */
  unreachable: boolean;
  draggable: boolean;
  previewContext: SessionPreviewContext;
  selected: boolean;
  optimistic: boolean;
  layoutEnabled: boolean;
  showUpdated: boolean;
  onOpen: () => void;
  onOpenBeside: () => void;
  onHover: () => void;
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
  optimistic,
  layoutEnabled,
  showUpdated,
  onOpen,
  onOpenBeside,
  onHover,
  onRename,
  onPin,
  onArchive,
  onDelete,
}: SessionRowProps): ReactElement {
  const warmTimer = useRef<number | undefined>(undefined);
  const mark = sessionActivityMark(session, optimistic);
  const title = sessionTitle(session);
  const ask = mark === "waiting" || mark === "failed" ? sessionAsk(session) : undefined;
  const [draftName, setDraftName] = useState<string | undefined>();

  const { isDragging, listeners, setNodeRef } = useSessionDraggable(
    session.sessionId,
    title,
    !draggable,
  );

  const commitRename = (): void => {
    if (draftName === undefined) return;
    const name = draftName.replaceAll(/\s+/g, " ").trim();
    setDraftName(undefined);

    if (name !== "" && name !== title) onRename(name);
  };

  const cancelWarm = (): void => {
    if (warmTimer.current === undefined) return;
    window.clearTimeout(warmTimer.current);
    warmTimer.current = undefined;
  };

  const warmSoon = (): void => {
    cancelWarm();
    warmTimer.current = window.setTimeout(() => {
      warmTimer.current = undefined;
      onHover();
    }, 50);
  };

  const warmNow = (): void => {
    cancelWarm();
    onHover();
  };

  useMountEffect(() => cancelWarm);

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
      onPointerEnter={() => {
        warmSoon();
      }}
      onPointerLeave={() => {
        cancelWarm();
      }}
      onPointerDownCapture={warmNow}
      onFocusCapture={warmNow}
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
        xstyle={[styles.rowPrimary, unreachable && styles.sessionUnreachable]}
        aria-current={selected ? "page" : undefined}
        onClick={onOpen}
        {...listeners}
      >
        <Row.Leading xstyle={[styles.rowIcon, ask !== undefined && styles.rowIconAsk]}>
          <SessionGlyph session={session} mark={mark} elsewhere={elsewhere} />
        </Row.Leading>
        {ask === undefined ? (
          titleLine
        ) : (
          <Row.Body>
            <span {...stylex.props(styles.sessionTitleLine)}>{titleLine}</span>
            <Row.Description
              xstyle={mark === "failed" ? styles.sessionAskFailed : styles.sessionAskWaiting}
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
          styles.rowActions,
          showUpdated && styles.rowActionsBesideMeta,
          ask !== undefined && styles.rowActionsAsk,
        ]}
      >
        <Button
          size="2xs"
          iconOnly
          icon={session.pinned ? "unpin" : "pin"}
          aria-label={session.pinned ? "Unpin" : "Pin"}
          onClick={onPin}
        />
        <Button
          size="2xs"
          iconOnly
          aria-label={session.archived ? "Restore" : "Archive"}
          onClick={onArchive}
        >
          <span {...stylex.props(styles.actionGlyphArchive)}>
            <Icon name={session.archived ? "unarchive" : "archive"} size={12} />
          </span>
        </Button>
      </Row.Actions>
    </Row>
  );

  return (
    <SessionPreviewCard
      title={title}
      context={previewContext}
      trigger={row}
      contextMenu={
        <>
          <ContextMenuItem icon={session.pinned ? "unpin" : "pin"} onSelect={onPin}>
            {session.pinned ? "Unpin" : "Pin"}
          </ContextMenuItem>
          <ContextMenuItem icon="pencil" onSelect={() => setDraftName(title)}>
            Rename
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem icon="split-right" onSelect={onOpenBeside}>
            Open to the side
          </ContextMenuItem>
          <ContextMenuItem icon="copy" onSelect={() => void navigator.clipboard.writeText(title)}>
            Copy title
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem icon={session.archived ? "unarchive" : "archive"} onSelect={onArchive}>
            {session.archived ? "Restore" : "Archive"}
          </ContextMenuItem>
          <ContextMenuItem icon="trash" danger onSelect={onDelete}>
            Delete
          </ContextMenuItem>
        </>
      }
    />
  );
}
