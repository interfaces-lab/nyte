/**
 * The rail: new chat, search, customize, environments, and settings on top,
 * then a persistent workspace collection. Every folder expands independently
 * over its cached sessions, and the collection header owns folder opening.
 * The Cloud folder appears while the connected server can't be reached.
 * Settings opens a second layer of the same rail, with a Back row where the
 * primary actions were. Everything you switch between lives in this one
 * column.
 *
 * Every row shares one geometry: a leading icon slot, the label, and one
 * trailing column for shortcuts, timestamps, and hover actions. Labels
 * therefore start and end on the same edges from the top of the rail to the
 * footer.
 *
 * Based on https://github.com/interfaces-lab/honk/blob/main/packages/app/src/desktop-extensions/vertical-sidebar/view.tsx
 */
import type { SessionId, SessionInfo, WorkspaceId } from "@nyte-ai/sdk";
import { ConfirmDialog } from "@nyte-ai/ui/alert-dialog";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { Icon } from "@nyte-ai/ui/icon";
import { Kbd } from "@nyte-ai/ui/kbd";
import { Row } from "@nyte-ai/ui/row";
import { focus } from "@nyte-ai/ui/styles/a11y.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { Toggle } from "@nyte-ai/ui/toggle";
import { props } from "@stylexjs/stylex";
import { Link, useMatch, useRouter } from "@tanstack/react-router";
import { motion } from "motion/react";
import { useId, useRef, useState } from "react";
import type { ReactElement } from "react";
import { clientActionAriaShortcut, clientActionKeys, clientActions } from "../client-actions.ts";
import {
  hideFromPanes,
  usePaneActions,
  usePaneControllerSnapshot,
} from "../layout/pane-context.tsx";
import { activePane } from "../layout/pane-layout.ts";
import { nyte } from "../nyte.ts";
import { preferences, useSetting } from "../preferences/index.ts";
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
import { localSessions } from "../session-directory.ts";
import { closeSettings, type SettingsSection } from "../settings/index.ts";
import type { OpenTarget } from "../tabs/model.ts";
import { windowTabs } from "../tabs/window-tabs.ts";
import { AccountFooterMenu } from "./account-footer.tsx";
import { useGitHub, useGitHubAccountState, useGitHubState } from "./github-account.ts";
import { folderPicker } from "./open-workspace.tsx";
import { SearchPalette } from "./search-palette.tsx";
import { shellActions, useOverlays, useStagePage } from "./shell-state.ts";
import { recordArchive, SidebarContent } from "./sidebar-content.tsx";
import { WorkspaceControls } from "./sidebar-filter.tsx";
import {
  ChatsList,
  FolderList,
  useDrafts,
  useListReveal,
  WorkspaceRow,
  type ListContext,
  type ListedSession,
} from "./sidebar-lists.tsx";
import { NeighbourPreload, type RailRows, type SessionPlace } from "./sidebar-rows.tsx";
import { sidebarStyles as styles } from "./sidebar.stylex.ts";
import {
  clearSessionFilters,
  DEFAULT_SESSION_VIEW,
  sessionOrder,
  sessionsForNavigation,
  sessionsForView,
  deriveShelf,
  type SessionViewSettings,
  type ShelfHold,
} from "./sidebar-view.ts";
import { activateWorkspace } from "./use-show-session.ts";

/** One confirmation surface at a time: a chat deletion or a workspace-wide archive. */
type SidebarConfirmation =
  | { readonly kind: "closed" }
  | { readonly kind: "delete-session"; readonly sessionId: SessionId }
  | {
      readonly kind: "archive-all";
      readonly workspaceName: string;
      readonly sessionIds: readonly SessionId[];
    };

/**
 * Show a chat: make its folder current, then open it here, in a tab, or beside
 * the focused pane. A background tab leaves the current folder alone until it
 * is shown.
 */
async function showSession(sessionId: SessionId, target: OpenTarget | "beside"): Promise<void> {
  if (target !== "background" && !(await activateWorkspace(sessionFolderPath(sessionId) ?? null)))
    return;

  if (target !== "beside") {
    windowTabs.dispatch({ kind: "open", place: { kind: "session", sessionId }, target });

    return;
  }

  const controller = windowTabs.controller();
  controller.drop(sessionId, activePane(controller.getSnapshot().layout).id, "right");
}

/** The chats listed just above and below `sessionId`, in the rail's order. */
function listedNeighbours(
  ordered: readonly SessionInfo[],
  sessionId: SessionId,
): readonly SessionId[] {
  const index = ordered.findIndex((session) => session.id === sessionId);

  if (index === -1) return [];

  return [ordered[index - 1], ordered[index + 1]].flatMap((session) =>
    session === undefined ? [] : [session.id],
  );
}

function showDraft(draftId: string): void {
  shellActions.showWorkspace();
  windowTabs.controller().selectDraft(draftId);
}

/** New Chat is current on a blank pane whose draft is not listed below, while nothing covers it. */
function NewChatRow({
  showDrafts,
  paletteOpen,
  mac,
}: {
  readonly showDrafts: boolean;
  readonly paletteOpen: boolean;
  readonly mac: boolean;
}): ReactElement {
  const panes = usePaneActions();
  const { drafts, activeDraftId } = useDrafts();
  const listed = showDrafts && drafts.some((draft) => draft.id === activeDraftId);
  const current = activeDraftId !== undefined && !listed && !paletteOpen;

  return (
    <Row
      variant="nav"
      selected={current}
      aria-current={current ? "page" : undefined}
      xstyle={[styles.navRow, current && styles.navRowActive]}
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
  );
}

/**
 * Folders form one fixed, name-ordered column: a click expands a row in place
 * instead of moving the opened workspace to the top. Confirmations open from a
 * context menu, which has no persistent trigger to return focus to, so the
 * dialog falls back to the previously focused element.
 */
export function Sidebar(): ReactElement {
  const sessionListId = useId();
  const workspaceCollectionID = useId();
  const panes = usePaneActions();
  const host = useHostState();
  const open = host.data.workspace;
  const workspaces = useWorkspaces();
  const sessionDirectory = useWorkspaceSessionDirectory();
  const server = useServerState(false);
  const sessionActions = useSessionActions();
  const renameSession = useRenameSession();
  const forgetWorkspace = useForgetWorkspace();
  const { layout } = usePaneControllerSnapshot();
  const workingSessions = useWorkingSessionIds();
  const page = useStagePage();
  const paletteOpen = useOverlays().search;
  const homeVisible = useSetting(preferences.homeVisible);
  const sidebarVisible = useSetting(preferences.sidebarVisible);
  const router = useRouter();
  const settingsOpen = useMatch({ from: "/settings/$section", shouldThrow: false }) !== undefined;
  const githubState = useGitHubState(useGitHub());
  const githubAccount = useGitHubAccountState().data;
  const openFolder = folderPicker();
  const reveal = useListReveal();
  const footerRowRef = useRef<HTMLDivElement>(null);
  const confirmationReturnRef = useRef<HTMLButtonElement>(null);
  const [confirmation, setConfirmation] = useState<SidebarConfirmation>({ kind: "closed" });
  const [collectionExpanded, setCollectionExpanded] = useState(true);
  const [cloudCollapsed, setCloudCollapsed] = useState(false);
  const [view, setSessionView] = useState<SessionViewSettings>(DEFAULT_SESSION_VIEW);
  const [hold, setHold] = useState<ShelfHold | undefined>();
  const [listedWhenBlank, setListedWhenBlank] = useState<ReadonlySet<SessionId>>();

  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<ReadonlySet<WorkspaceId | null>>(
    () => new Set(),
  );

  const cloudFailure =
    server.data?.kind === "unavailable" ? server.data.problem.message : undefined;

  const flat = view.grouping === "none" || view.grouping === "inbox";
  const selection = activePane(layout).selection;
  const paneSessionId = selection.kind === "session" ? selection.sessionId : undefined;
  const activeSessionId = page === undefined ? paneSessionId : undefined;
  const mac = nyte.platform === "darwin";

  const paneSession =
    paneSessionId === undefined
      ? undefined
      : sessionDirectory.data
          ?.flatMap((directory) => directory.sessions)
          .find((session) => session.id === paneSessionId);

  if (selection.kind === "blank" && listedWhenBlank === undefined && sessionDirectory.data)
    setListedWhenBlank(
      new Set(
        sessionDirectory.data.flatMap((directory) =>
          directory.sessions.map((session) => session.id),
        ),
      ),
    );

  if (hold?.sessionId !== paneSession?.id) {
    setHold(
      paneSession === undefined
        ? undefined
        : {
            sessionId: paneSession.id,
            shelf:
              listedWhenBlank?.has(paneSession.id) === false
                ? "inbox"
                : deriveShelf(paneSession, workingSessions, undefined),
          },
    );

    if (paneSession !== undefined) setListedWhenBlank(undefined);
  }

  const setExpanded = (workspace: WorkspaceId | null, expanded: boolean): void => {
    setCollapsedWorkspaces((current) => {
      const next = new Set(current);

      if (expanded) next.delete(workspace);
      else next.add(workspace);

      return next;
    });
  };

  const openSettings = (section: SettingsSection): void => {
    const replace = router.state.matches.some((match) => match.routeId === "/settings/$section");
    void router.navigate({ to: "/settings/$section", params: { section }, replace });
  };

  const newWorkspaceChat = async (place: SessionPlace): Promise<void> => {
    if (!(await activateWorkspace(place.path))) return;
    setExpanded(place.workspace, true);
    panes.newChat();
  };

  const rail: RailRows = {
    openWorkspace: open?.id ?? null,
    activeSessionId,
    unavailable: new Set(
      (workspaces.data ?? []).flatMap((workspace) =>
        workspace.available === false ? [workspace.id] : [],
      ),
    ),
    repository: githubState.data?.repository,
    working: workingSessions,
    showUpdated: view.show.includes("updated"),
    open: (sessionId, target) => void showSession(sessionId, target),
    rename: (sessionId, name) => renameSession.mutate({ sessionId, name }),
    pin: (session) => sessionActions.pin({ sessionId: session.id, pinned: !session.pinned }),
    archive: (session) => {
      recordArchive(1);
      sessionActions.archive([session.id], !session.archived, hideFromPanes);
    },
    remove: (sessionId) => setConfirmation({ kind: "delete-session", sessionId }),
    openDraft: showDraft,
    removeDraft: (draftId) => windowTabs.controller().removeDraft(draftId),
  };

  const showDrafts =
    (view.statuses.length === 0 || view.statuses.includes("draft")) &&
    (view.pullRequests.length === 0 || view.pullRequests.includes("none")) &&
    (view.environments.length === 0 || view.environments.includes("local"));

  const context: ListContext = {
    view,
    showDrafts,
    rail,
    reveal,
    onClearFilters: () => setSessionView(clearSessionFilters(view)),
  };

  const order = sessionOrder(view.sortByStatus, workingSessions);

  const listed: readonly ListedSession[] | undefined = sessionDirectory.data
    ?.flatMap((directory) => {
      if (directory.workspacePath === null && !homeVisible) return [];

      const place: SessionPlace = {
        workspace: directory.workspacePath === null ? null : directory.workspace,
        path: directory.workspacePath,
      };

      return sessionsForView(directory.sessions, view, "local", undefined, workingSessions)
        .flatMap((group) => group.sessions)
        .map((session) => ({ place, session }));
    })
    .toSorted((left, right) => order(left.session, right.session));

  const activeDirectory =
    paneSession === undefined
      ? undefined
      : sessionDirectory.data?.find((directory) =>
          directory.sessions.some((session) => session.id === paneSession.id),
        );

  const neighbours =
    activeSessionId === undefined
      ? []
      : listedNeighbours(
          flat
            ? (listed ?? []).map(({ session }) => session)
            : sessionsForView(
                (activeDirectory &&
                  localSessions(
                    sessionDirectory.data ?? [],
                    activeDirectory.workspacePath === null ? null : activeDirectory.workspace,
                  )) ??
                  [],
                view,
                "local",
                undefined,
                workingSessions,
              ).flatMap((group) => group.sessions),
          activeSessionId,
        );

  const entries: readonly ({ kind: "home" } | ({ kind: "project" } & RailWorkspace))[] = [
    ...(homeVisible ? [{ kind: "home" } as const] : []),
    ...(workspaces.data ?? [])
      .filter((workspace) => workspace.worktree === null)
      .toSorted((left, right) => left.name.localeCompare(right.name))
      .map((workspace) => ({ kind: "project", ...workspace }) as const),
  ];

  const folders = entries.map((entry) => {
    const place: SessionPlace =
      entry.kind === "home"
        ? { workspace: null, path: null }
        : { workspace: entry.id, path: entry.path };

    const sessions =
      sessionDirectory.data === undefined
        ? undefined
        : localSessions(sessionDirectory.data, place.workspace);

    const name = entry.kind === "home" ? "Home" : entry.name;
    const expanded = !collapsedWorkspaces.has(place.workspace);

    return (
      <WorkspaceRow
        key={entry.kind === "home" ? "home" : entry.id}
        name={name}
        path={entry.kind === "home" ? "Home" : entry.path}
        available={entry.kind === "home" || entry.available !== false}
        active={entry.kind === "home" ? open === undefined : open?.id === entry.id}
        expanded={expanded}
        onExpandedChange={(next) => setExpanded(place.workspace, next)}
        onNewChat={
          entry.kind === "home" || entry.available ? () => void newWorkspaceChat(place) : undefined
        }
        onArchiveAll={
          sessions === undefined
            ? undefined
            : () =>
                setConfirmation({
                  kind: "archive-all",
                  workspaceName: name,
                  sessionIds: sessionsForNavigation(sessions).map((session) => session.id),
                })
        }
        onRemove={
          entry.kind === "home"
            ? () => preferences.homeVisible.set(false)
            : () => forgetWorkspace.mutate(entry.id)
        }
      >
        <FolderList
          listId={`${sessionListId}-${encodeURIComponent(`local:${place.workspace ?? "home"}`)}`}
          place={place}
          sessions={sessions}
          open={place.workspace === (open?.id ?? null)}
          layoutEnabled={sidebarVisible && collectionExpanded && expanded}
          context={context}
        />
      </WorkspaceRow>
    );
  });

  const closeConfirmation = (): void => setConfirmation({ kind: "closed" });

  return (
    <aside {...props(styles.rail)}>
      <SidebarContent>
        {activeSessionId !== undefined && (
          <NeighbourPreload
            key={[activeSessionId, ...neighbours].join(" ")}
            active={activeSessionId}
            neighbours={neighbours}
          />
        )}
        <div {...props(styles.primaryActions)}>
          <NewChatRow showDrafts={showDrafts} paletteOpen={paletteOpen} mac={mac} />

          <SearchPalette
            open={paletteOpen}
            recentSessions={listed?.map(({ session }) => session)}
            onOpenChange={shellActions.setSearchOpen}
            onOpenSession={(sessionId) =>
              windowTabs.dispatch({
                kind: "open",
                place: { kind: "session", sessionId },
                target: "here",
              })
            }
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
            selected={page?.kind === "customize"}
            aria-haspopup="dialog"
            aria-current={page?.kind === "customize" ? "page" : undefined}
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
              selected={page?.kind === "environments"}
              aria-haspopup="dialog"
              aria-current={page?.kind === "environments" ? "page" : undefined}
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
                  onHomeVisibleChange={preferences.homeVisible.set}
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

              <Collapsible.Panel id={workspaceCollectionID} {...props(styles.workspaceCollection)}>
                {flat ? (
                  <ChatsList
                    listId={`${sessionListId}-chats`}
                    listed={listed}
                    hold={hold}
                    layoutEnabled={sidebarVisible && collectionExpanded}
                    context={context}
                  />
                ) : (
                  <>
                    {folders}
                    {server.data !== undefined &&
                      server.data.kind !== "none" &&
                      cloudFailure !== undefined && (
                        <WorkspaceRow
                          name="Cloud"
                          path={server.data.baseUrl}
                          available={false}
                          unavailableDetail="server unavailable"
                          active={false}
                          expanded={!cloudCollapsed}
                          onExpandedChange={(next) => setCloudCollapsed(!next)}
                          onNewChat={undefined}
                          onArchiveAll={undefined}
                          onRemove={() => void nyte.host.server.disconnect()}
                        >
                          <div
                            role="status"
                            {...props(text.base, styles.quiet, styles.sessionQuiet)}
                          >
                            {cloudFailure}
                          </div>
                        </WorkspaceRow>
                      )}
                  </>
                )}
              </Collapsible.Panel>
            </Collapsible.Root>
          </section>
        </motion.div>
      </SidebarContent>

      {githubAccount !== undefined && githubAccount !== null && (
        <div {...props(styles.footer)}>
          <div ref={footerRowRef} {...props(styles.footerRow)}>
            <AccountFooterMenu
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
            closeConfirmation();
            sessionActions.delete(confirmation.sessionId, hideFromPanes);
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
            sessionActions.archive(confirmation.sessionIds, true, hideFromPanes);
          }}
        />
      )}
    </aside>
  );
}
