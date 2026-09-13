import { sessionMark } from "@nyte-ai/core/client";
/**
 * The rail: new chat, search, customize, and cloud on top, then a persistent
 * workspace collection. Every folder expands independently over its cached
 * sessions, and the collection header owns folder opening. The Cloud folder
 * appears once a cloud chat exists.
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
import * as stylex from "@stylexjs/stylex";
import { Button as BaseButton } from "@nyte-ai/ui/button";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { Toggle } from "@nyte-ai/ui/toggle";
import { toast } from "@nyte-ai/ui/sonner";
import { useMatch, useRouter } from "@tanstack/react-router";
import { LayoutGroup, motion, MotionConfig } from "motion/react";
import type { Transition } from "motion/react";
import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import type { SessionId, SessionInfo, WorkspaceInfo } from "@nyte-ai/core";
import type { ChatDraft } from "../layout/session-view-state.ts";
import { ConfirmDialog } from "../components/confirm-dialog.tsx";
import { Icon } from "../components/icons.tsx";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
  Menu,
  MenuItem,
  MenuSeparator,
} from "../components/menu.tsx";
import { focus, formatTimeAgo, Hint, Kbd, StatusDot } from "../components/ui.tsx";
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
import { sidebarStyles as styles } from "./sidebar.stylex.ts";
import { useGitHubAccount } from "./github-account.ts";
import { handleOpenOutcome } from "./open-workspace.tsx";
import { SearchPalette } from "./search-palette.tsx";
import { SessionPreviewCard, type SessionPreviewContext } from "./sidebar-session-preview.tsx";
import { WorkspaceControls } from "./sidebar-filter.tsx";
import {
  clearSessionFilters,
  DEFAULT_SESSION_VIEW,
  needsCompleteSessionDirectory,
  sessionsForNavigation,
  sessionsForView,
  type SessionViewSettings,
} from "./sidebar-view.ts";
import { SettingsNavigation, type SettingsSection } from "./settings-navigation.tsx";
import { shellActions, useShellState } from "./shell-state.ts";
import { activateWorkspace } from "./use-show-session.ts";
import {
  clientActionAriaShortcut,
  clientActionKeys,
  clientActionShortcut,
  clientActions,
} from "../../../shared/client-actions.ts";
import { cloudSessions, localSessions } from "../../../shared/ipc.ts";

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

function SidebarContent({ children }: { readonly children: ReactNode }): ReactElement {
  const settings = useMatch({ from: "/settings/$section", shouldThrow: false });
  const contentRef = useRef<HTMLElement>(null);
  const layoutId = useId();
  const [transitions, setTransitions] = useState({ list: INSTANT, archive: INSTANT });

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

  return (
    <nav
      ref={contentRef}
      aria-label={settings === undefined ? "Sessions and workspaces" : "Settings"}
      {...stylex.props(styles.content)}
    >
      <div hidden={settings !== undefined} {...stylex.props(styles.contentLayer)}>
        <MotionConfig reducedMotion="never" transition={{ layout: transition }}>
          <LayoutGroup id={layoutId} inherit={false}>
            {children}
          </LayoutGroup>
        </MotionConfig>
      </div>
      {settings !== undefined && <SettingsNavigation section={settings.params.section} />}
    </nav>
  );
}

function SettingsFooterToggle({ mac }: { readonly mac: boolean }): ReactElement {
  const settings = useMatch({ from: "/settings/$section", shouldThrow: false });
  const router = useRouter();
  const open = settings !== undefined;

  return (
    <Hint
      content={open ? "Close Settings" : "Settings"}
      side="top"
      align="end"
      trigger={
        <Toggle
          type="button"
          pressed={open}
          aria-label={open ? "Close settings" : "Open settings"}
          aria-keyshortcuts={
            open ? undefined : clientActionAriaShortcut(clientActions.settings, mac)
          }
          onPressedChange={(pressed) => {
            if (pressed) {
              void router.navigate({ to: "/settings/$section", params: { section: "general" } });
            } else if (router.history.canGoBack()) {
              router.history.back();
            } else {
              void router.navigate({ to: "/" });
            }
          }}
          {...stylex.props(
            styles.footerSettings,
            focus.ringInset,
            open && styles.footerSettingsActive,
          )}
        >
          <Icon name="settings" size={14} />
        </Toggle>
      }
    />
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
  const server = useServerState();
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
  // The footer is the one always-visible account surface, so it reads the
  // GitHub state itself. A fixed placeholder keeps its geometry stable while
  // that loads or when the project has no GitHub remote.
  const account = useGitHubAccount();
  const workspaceCollectionID = useId();
  const [collectionExpanded, setCollectionExpanded] = useState(true);
  const settings = useMatch({ from: "/settings/$section", shouldThrow: false });
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
  // The rail's Cloud action creates cloud chats; the folder only lists them,
  // so it appears once the first chat exists or when a failure needs showing.
  const cloudFolderVisible =
    cloudFailure !== undefined || (cloudDirectory?.sessions.length ?? 0) > 0;
  const [expandedSessionLists, setExpandedSessionLists] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [view, setSessionView] = useState<SessionViewSettings>(DEFAULT_SESSION_VIEW);
  const readSessions = useReadSessions();
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
  }, [activeSessionId, activeWorkspaceSessions, readSessions, router, view]);
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
      await queryClient.invalidateQueries({ queryKey: keys.sessionDirectory });
      await showSession({ kind: "cloud" }, session.sessionId);
    } catch {
      toast.error("Couldn't create a Cloud chat. Check the server connection in Settings.");
      void queryClient.invalidateQueries({ queryKey: keys.server });
    }
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
        : sessionsForView(sessions, view, place.kind, undefined, readSessions);
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
    const previewContext: SessionPreviewContext =
      place.kind === "cloud"
        ? { kind: "cloud" }
        : place.path === null
          ? { kind: "home" }
          : {
              kind: "workspace",
              path: place.path,
              repository:
                place.path === workspacePath &&
                (account.query.data?.kind === "ready" || account.query.data?.kind === "signed_out")
                  ? account.query.data.repository
                  : undefined,
            };
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
                layoutEnabled={
                  sidebarVisible && settings === undefined && collectionExpanded && !collapsed
                }
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
              <button
                type="button"
                {...stylex.props(styles.showMore, focus.ringInset)}
                onClick={() => setSessionView(clearSessionFilters(view))}
              >
                Clear filters
              </button>
            </>
          ) : (
            <div {...stylex.props(styles.quiet, styles.sessionQuiet)}>No sessions yet</div>
          ))}
        {visibleGroups.map((group) => (
          <div key={group.key} {...stylex.props(styles.section)}>
            {group.label !== undefined && (
              <div {...stylex.props(styles.sessionGroupLabel)}>{group.label}</div>
            )}
            {group.sessions.map((session) => (
              <SessionRow
                key={session.sessionId}
                session={session}
                draggable={path === (workspacePath ?? null)}
                previewContext={previewContext}
                selected={session.sessionId === activeSessionId}
                unread={sessionHasUnreadCompletion(session, readSessions)}
                layoutEnabled={
                  sidebarVisible && settings === undefined && collectionExpanded && !collapsed
                }
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
            ))}
          </div>
        ))}
        {hasOverflow && (
          <button
            type="button"
            aria-expanded={listExpanded}
            {...stylex.props(styles.showMore, focus.ringInset)}
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
          </button>
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
            <button
              type="button"
              aria-current={newChatActive ? "page" : undefined}
              {...stylex.props(
                styles.navRow,
                focus.ringInset,
                newChatActive && styles.navRowActive,
              )}
              onClick={() => panes.newChat()}
            >
              <span {...stylex.props(styles.navIcon)}>
                <Icon name="new-chat" size={14} />
              </span>
              <span {...stylex.props(styles.navLabel)}>New Chat</span>
              <span {...stylex.props(styles.shortcutSlot, styles.shortcutPersistent)}>
                <Kbd keys={clientActionKeys(clientActions.newChat, mac)} />
              </span>
            </button>

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
              onOpenFolder={() => void nyte.host.pickWorkspace().then(handleOpenOutcome)}
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
                <button type="button" {...stylex.props(styles.navRow, focus.ringInset)}>
                  <span {...stylex.props(styles.navIcon)}>
                    <Icon name="search" size={14} />
                  </span>
                  <span {...stylex.props(styles.navLabel)}>Search</span>
                  <span {...stylex.props(styles.shortcutSlot)}>
                    <Kbd keys={clientActionKeys(clientActions.search, mac)} />
                  </span>
                </button>
              }
            />

            <button
              type="button"
              aria-haspopup="dialog"
              aria-current={stage.kind === "customize" ? "page" : undefined}
              {...stylex.props(
                styles.navRow,
                focus.ringInset,
                stage.kind === "customize" && styles.navRowActive,
              )}
              onClick={() => shellActions.openCustomize(activeSessionId)}
            >
              <span {...stylex.props(styles.navIcon)}>
                <Icon name="customize" size={14} />
              </span>
              <span {...stylex.props(styles.navLabel)}>Customize</span>
            </button>

            {server.data !== undefined && server.data.kind !== "none" && (
              <button
                type="button"
                title={cloudAvailable ? undefined : (cloudFailure ?? "Server unavailable")}
                {...stylex.props(styles.navRow, focus.ringInset)}
                disabled={!cloudAvailable}
                onClick={() => void newCloudChat()}
              >
                <span {...stylex.props(styles.navIcon)}>
                  <Icon name="cloud" size={14} />
                </span>
                <span {...stylex.props(styles.navLabel)}>Cloud</span>
              </button>
            )}
          </div>

          <motion.div layoutScroll data-nyte-scrollport {...stylex.props(styles.scroll)}>
            <section aria-label="Workspaces" {...stylex.props(styles.section)}>
              <Collapsible.Root
                open={collectionExpanded}
                onOpenChange={setCollectionExpanded}
                {...stylex.props(styles.section)}
              >
                <div {...stylex.props(styles.sectionHeader)}>
                  <Collapsible.Trigger
                    aria-controls={workspaceCollectionID}
                    {...stylex.props(styles.sectionToggle, focus.ringInset)}
                    render={(props, state) => (
                      <button {...props}>
                        <span {...stylex.props(styles.sectionLabel)}>Workspaces</span>
                        <span
                          {...stylex.props(
                            styles.sectionChevron,
                            state.open && styles.sectionChevronOpen,
                          )}
                        >
                          <Icon name="chevron-right" size={11} />
                        </span>
                      </button>
                    )}
                  />
                  <WorkspaceControls
                    value={view}
                    homeVisible={homeVisible}
                    onHomeVisibleChange={shellActions.setHomeVisible}
                    filterDisabled={sessionDirectory.data === undefined}
                    onChange={setSessionView}
                    onOpenFolder={() => void nyte.host.pickWorkspace().then(handleOpenOutcome)}
                    onCollapseAll={() =>
                      setCollapsedWorkspaces(
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
                          <div role="status" {...stylex.props(styles.quiet, styles.sessionQuiet)}>
                            {cloudFailure}
                          </div>
                        )}
                        {sessionPanel({ kind: "cloud" })}
                      </WorkspaceRow>
                    )}
                </Collapsible.Panel>
              </Collapsible.Root>
            </section>
          </motion.div>
        </>
      </SidebarContent>

      <div {...stylex.props(styles.footer)}>
        <div {...stylex.props(styles.footerRow)}>
          <AccountFooterMenu
            account={account}
            settingsShortcut={clientActionShortcut(
              clientActions.settings,
              mac,
              settings === undefined ? stage.kind : "settings",
            )}
            onOpenSettings={() => openSettings("general")}
          />
          <SettingsFooterToggle mac={mac} />
        </div>
      </div>
      {confirmation.kind === "delete-session" && (
        <ConfirmDialog
          open
          pending={false}
          error={undefined}
          description="The chat disappears now. You can undo from the notification before it closes; after that, deletion is permanent."
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
  account,
  settingsShortcut,
  onOpenSettings,
}: {
  account: ReturnType<typeof useGitHubAccount>;
  settingsShortcut: string;
  onOpenSettings: (trigger: HTMLElement) => void;
}): ReactElement {
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
        sideOffset={4}
        trigger={
          <button
            ref={triggerRef}
            type="button"
            aria-label={`${label} menu`}
            disabled={account.busy}
            {...stylex.props(styles.navRow, styles.accountButton, focus.ringInset)}
          >
            <span {...stylex.props(styles.navIcon, styles.avatarSlot)}>
              {avatarUrl === undefined ? (
                <Icon name="user" size={14} />
              ) : (
                <img alt="" src={avatarUrl} {...stylex.props(styles.avatar)} />
              )}
            </span>
            <span {...stylex.props(styles.navLabel)}>{label}</span>
          </button>
        }
      >
        <MenuItem
          icon="settings"
          meta={settingsShortcut}
          onSelect={() => {
            const trigger = triggerRef.current;
            if (trigger !== null) onOpenSettings(trigger);
          }}
        >
          Settings
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          icon="bubble-question"
          onSelect={() => void nyte.host.openExternal({ url: REPORT_ISSUE_URL })}
        >
          Report issue
        </MenuItem>
        {state?.kind === "ready" && (
          <>
            <MenuSeparator />
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
          description={`This removes the CLI login for @${state.account.login} on github.com. Terminal commands and other apps using this login will also be signed out.`}
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
  const trigger = (
    <Collapsible.Trigger
      title={available ? path : `${path} (${unavailableDetail})`}
      aria-current={active ? "location" : undefined}
      {...stylex.props(styles.row, styles.workspaceRowTrigger, focus.ringInset)}
    >
      <span {...stylex.props(styles.rowIcon)}>
        <span {...stylex.props(styles.workspaceGlyph)}>
          <span {...stylex.props(styles.workspaceFolder)}>
            <Icon name={expanded ? "folder-open" : "folder"} size={14} />
          </span>
          <span {...stylex.props(styles.workspaceChevron, expanded && styles.workspaceChevronOpen)}>
            <Icon name="chevron-down" size={13} />
          </span>
        </span>
      </span>
      <span {...stylex.props(styles.rowTitle, !available && styles.workspaceUnavailable)}>
        {name}
      </span>
    </Collapsible.Trigger>
  );
  return (
    <Collapsible.Root
      open={expanded}
      onOpenChange={onExpandedChange}
      {...stylex.props(styles.section)}
    >
      <div {...stylex.props(styles.workspaceRowShell)}>
        <ContextMenu label={`Actions for ${name}`} trigger={trigger}>
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
        <button
          type="button"
          aria-label={`New chat in ${name}`}
          title={`New chat in ${name}`}
          {...stylex.props(styles.workspaceCreateAction, focus.ringInset)}
          onClick={onNewChat}
          disabled={onNewChat === undefined}
        >
          <Icon name="new-chat-folder" size={13} />
        </button>
      </div>
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
  const [title, setTitle] = useState(() => draftPreviewText(draft.composer.draft));
  useEffect(() => {
    const timeout = setTimeout(() => setTitle(draftPreviewText(draft.composer.draft)), 100);
    return () => clearTimeout(timeout);
  }, [draft.composer.draft]);
  const row = (
    <motion.div
      layout={layoutEnabled ? "position" : false}
      initial={false}
      {...stylex.props(
        styles.sessionRowShell,
        styles.sessionRowShellTimed,
        selected && styles.rowSelected,
      )}
    >
      {selected && (
        <motion.div
          key={layoutEnabled ? "moving" : "static"}
          aria-hidden="true"
          initial={false}
          layout={layoutEnabled ? "position" : false}
          layoutId={layoutEnabled ? "selected-session" : undefined}
          layoutCrossfade={false}
          {...stylex.props(styles.sessionSelection)}
        />
      )}
      <BaseButton
        render={
          <button
            type="button"
            title={`Draft: ${title}`}
            aria-current={selected ? "page" : undefined}
            onClick={onOpen}
          />
        }
        {...stylex.props(
          styles.row,
          styles.sessionRow,
          styles.draftRow,
          focus.ringInset,
          selected && styles.rowSelected,
        )}
      >
        <span {...stylex.props(styles.rowIcon)}>
          <span role="img" aria-label="Draft" {...stylex.props(styles.draftDot)} />
        </span>
        <span {...stylex.props(styles.rowTitle, styles.sessionTitle)}>{title}</span>
      </BaseButton>
      <span data-nyte-session-row-actions="" {...stylex.props(styles.sessionTrailing)}>
        <span {...stylex.props(styles.rowActions)}>
          <button
            type="button"
            aria-label={`Delete draft: ${title}`}
            title="Delete draft"
            {...stylex.props(styles.action, styles.sessionAction, focus.ringInset)}
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
          >
            <Icon name="trash" size={12} />
          </button>
        </span>
        <span {...stylex.props(styles.rowMeta)}>{formatTimeAgo(draft.updatedAt)}</span>
      </span>
    </motion.div>
  );

  return (
    <ContextMenu label={`Actions for draft: ${title}`} trigger={row}>
      <ContextMenuItem icon="trash" danger onSelect={onDelete}>
        Delete draft
      </ContextMenuItem>
    </ContextMenu>
  );
}

interface SessionRowProps {
  session: SessionInfo;
  draggable: boolean;
  previewContext: SessionPreviewContext;
  selected: boolean;
  unread: boolean;
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
  draggable,
  previewContext,
  selected,
  unread,
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
  const mark = sessionMark(session);
  const title = sessionTitle(session);
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

  useEffect(
    () => () => {
      if (warmTimer.current !== undefined) window.clearTimeout(warmTimer.current);
    },
    [],
  );

  if (draftName !== undefined) {
    return (
      <motion.div
        layout={layoutEnabled ? "position" : false}
        initial={false}
        {...stylex.props(styles.sessionRenameRow)}
      >
        <span {...stylex.props(styles.rowIcon)}>
          <StatusDot mark={mark} unread={unread} />
        </span>
        <input
          aria-label={`Rename ${title}`}
          autoFocus
          {...stylex.props(styles.sessionRenameInput)}
          value={draftName}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setDraftName(event.target.value)}
          onBlur={commitRename}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitRename();
            if (event.key === "Escape") setDraftName(undefined);
          }}
        />
      </motion.div>
    );
  }

  const row = (
    <motion.div
      ref={setNodeRef}
      layout={layoutEnabled ? "position" : false}
      initial={false}
      {...stylex.props(
        styles.sessionRowShell,
        showUpdated && styles.sessionRowShellTimed,
        selected && styles.rowSelected,
        isDragging && styles.rowDragging,
      )}
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
        <motion.div
          key={layoutEnabled ? "moving" : "static"}
          aria-hidden="true"
          initial={false}
          layout={layoutEnabled ? "position" : false}
          // Hidden panels must never become shared-layout destinations.
          layoutId={layoutEnabled ? "selected-session" : undefined}
          layoutCrossfade={false}
          {...stylex.props(styles.sessionSelection)}
        />
      )}
      <BaseButton
        render={
          <button type="button" aria-current={selected ? "page" : undefined} onClick={onOpen} />
        }
        {...listeners}
        {...stylex.props(
          styles.row,
          styles.sessionRow,
          focus.ringInset,
          selected && styles.rowSelected,
        )}
      >
        <span {...stylex.props(styles.rowIcon)}>
          <StatusDot mark={mark} unread={unread} />
        </span>
        <span {...stylex.props(styles.rowTitle, styles.sessionTitle)}>{title}</span>
      </BaseButton>
      <span data-nyte-session-row-actions="" {...stylex.props(styles.sessionTrailing)}>
        <span {...stylex.props(styles.rowActions)}>
          <button
            type="button"
            aria-label={session.pinned ? "Unpin" : "Pin"}
            title={session.pinned ? "Unpin" : "Pin"}
            {...stylex.props(styles.action, styles.sessionAction, focus.ringInset)}
            onClick={onPin}
          >
            <Icon name={session.pinned ? "unpin" : "pin"} size={12} />
          </button>
          <button
            type="button"
            aria-label={session.archived ? "Restore" : "Archive"}
            title={session.archived ? "Restore" : "Archive"}
            {...stylex.props(styles.action, styles.sessionAction, focus.ringInset)}
            onClick={onArchive}
          >
            <span {...stylex.props(styles.actionGlyphArchive)}>
              <Icon name="archive" size={12} />
            </span>
          </button>
        </span>
        {showUpdated ? (
          <span {...stylex.props(styles.rowMeta)}>{formatTimeAgo(session.lastActivityAt)}</span>
        ) : null}
      </span>
    </motion.div>
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
          <ContextMenuItem icon="archive" onSelect={onArchive}>
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
