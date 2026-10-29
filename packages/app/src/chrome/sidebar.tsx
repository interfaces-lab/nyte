import { useSettingsOpen } from "./use-settings-open.ts";
import type { SessionId, SessionInfo, WorkspaceId } from "@nyte-ai/sdk";
import { ConfirmDialog } from "@nyte-ai/ui/alert-dialog";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { Icon } from "@nyte-ai/ui/icon";
import { Kbd } from "@nyte-ai/ui/kbd";
import { Row } from "@nyte-ai/ui/row";
import { focus } from "@nyte-ai/ui/styles/a11y.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { toast } from "@nyte-ai/ui/toast";
import { Toggle } from "@nyte-ai/ui/toggle";
import { props } from "@stylexjs/stylex";
import { Link, useRouter } from "@tanstack/react-router";
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
  useForgetWorkspace,
  useHostState,
  useRenameSession,
  useServerState,
  useSessionActions,
  useWorkspaceSessions,
  useWorkspaces,
  type RailWorkspace,
} from "../queries.ts";
import { localSessions } from "../session-list.ts";
import { chatFolderPath, useChats } from "../chats/index.ts";
import { chatWindow, useChatWindow } from "../window/index.ts";
import { closeSettings, type SettingsSection } from "../settings/index.ts";
import type { OpenIntent } from "../tabs/model.ts";
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
  PinnedSection,
  useDrafts,
  useListReveal,
  WorkspaceRow,
  type ListContext,
  type ListedSession,
} from "./sidebar-lists.tsx";
import { moveSidebarFocus } from "./sidebar-navigation.ts";
import { NeighbourWarm, SessionRow, type RailRows, type SessionPlace } from "./sidebar-rows.tsx";
import { sidebarStyles as styles } from "./sidebar.stylex.ts";
import {
  clearSessionFilters,
  folderView,
  sessionIsRunning,
  sessionOrder,
  sessionsForNavigation,
  sessionsForView,
  deriveShelf,
  type ShelfHold,
} from "./sidebar-view.ts";
import { activateWorkspace } from "./use-show-session.ts";
import { useNowMinute } from "../use-now-minute.ts";

type SidebarConfirmation =
  | { readonly kind: "closed" }
  | { readonly kind: "delete-session"; readonly sessionId: SessionId }
  | { readonly kind: "archive-working"; readonly sessionId: SessionId }
  | {
      readonly kind: "archive-all";
      readonly workspaceName: string;
      readonly sessionIds: readonly SessionId[];
    };

async function showSession(sessionId: SessionId, target: OpenIntent | "beside"): Promise<void> {
  if (target !== "background" && !(await activateWorkspace(chatFolderPath(sessionId) ?? null)))
    return;

  if (target !== "beside") {
    windowTabs.openChat(sessionId, target);

    return;
  }

  shellActions.showWorkspace();
  const controller = windowTabs.controller();
  controller.drop(sessionId, activePane(controller.getSnapshot().layout).id, "right");
}

function markRead(sessions: readonly SessionId[]): void {
  void chatWindow.markRead(sessions).catch(() =>
    toast.add({
      type: "error",
      title: "Couldn't mark this chat as read. Try again.",
      id: "session-mark-read-error",
    }),
  );
}

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

export function Sidebar(): ReactElement {
  const sessionListId = useId();
  const workspaceCollectionID = useId();
  const panes = usePaneActions();
  const host = useHostState();
  const open = host.data.workspace;
  const workspaces = useWorkspaces();
  const workspaceSessions = useWorkspaceSessions();
  const server = useServerState();
  const sessionActions = useSessionActions();
  const renameSession = useRenameSession();
  const forgetWorkspace = useForgetWorkspace();
  const { layout } = usePaneControllerSnapshot();
  const chats = useChats((directory) => directory);
  const unread = useChatWindow((snapshot) => snapshot.unread);
  const now = useNowMinute();
  const page = useStagePage();
  const paletteOpen = useOverlays().search;
  const homeVisible = useSetting(preferences.homeVisible);
  const router = useRouter();

  const settingsOpen = useSettingsOpen();

  const githubState = useGitHubState(useGitHub());
  const githubAccount = useGitHubAccountState().data;
  const openFolder = folderPicker();
  const reveal = useListReveal();
  const footerRowRef = useRef<HTMLDivElement>(null);
  const confirmationReturnRef = useRef<HTMLButtonElement>(null);
  const [confirmation, setConfirmation] = useState<SidebarConfirmation>({ kind: "closed" });
  const [collectionExpanded, setCollectionExpanded] = useState(true);
  const [cloudCollapsed, setCloudCollapsed] = useState(false);
  const view = useSetting(preferences.sidebarView);
  const folded = useSetting(preferences.sidebarFolded);
  const [hold, setHold] = useState<ShelfHold | undefined>();
  const [listedWhenBlank, setListedWhenBlank] = useState<ReadonlySet<SessionId>>();

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
      : workspaceSessions.data
          ?.flatMap((workspaceGroup) => workspaceGroup.sessions)
          .find((session) => session.id === paneSessionId);

  if (selection.kind === "blank" && listedWhenBlank === undefined && workspaceSessions.data)
    setListedWhenBlank(
      new Set(
        workspaceSessions.data.flatMap((workspaceGroup) =>
          workspaceGroup.sessions.map((session) => session.id),
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
                : deriveShelf(paneSession, chats, unread, undefined),
          },
    );

    if (paneSession !== undefined) setListedWhenBlank(undefined);
  }

  const setExpanded = (workspace: WorkspaceId | null, expanded: boolean): void =>
    preferences.sidebarFolded.set([
      ...folded.filter((candidate) => candidate !== workspace),
      ...(expanded ? [] : [workspace]),
    ]);

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
    chats,
    unread,
    showUpdated: view.show.includes("updated"),
    open: (sessionId, target) => void showSession(sessionId, target),
    rename: (sessionId, name) => renameSession.mutate({ sessionId, name }),
    pin: (session) => sessionActions.pin({ sessionId: session.id, pinned: !session.pinned }),
    markRead,
    archive: (session) => {
      if (!session.archived && sessionIsRunning(session, chats)) {
        setConfirmation({ kind: "archive-working", sessionId: session.id });

        return;
      }

      archive(session.id, !session.archived);
    },
    remove: (sessionId) => setConfirmation({ kind: "delete-session", sessionId }),
    openDraft: (draftId) => windowTabs.showDraft(draftId),
    removeDraft: (draftId) => windowTabs.controller().removeDraft(draftId),
  };

  const showDrafts =
    !view.archived &&
    (view.statuses.length === 0 || view.statuses.includes("draft")) &&
    (view.environments.length === 0 || view.environments.includes("local"));

  const context: ListContext = {
    view,
    showDrafts,
    rail,
    reveal,
    onClearFilters: () => preferences.sidebarView.set(clearSessionFilters(view)),
  };

  const order = sessionOrder(view.sort, chats);

  const listed: readonly ListedSession[] | undefined = workspaceSessions.data
    ?.flatMap((workspaceGroup) => {
      if (workspaceGroup.workspacePath === null && !homeVisible) return [];

      const place: SessionPlace = {
        workspace: workspaceGroup.workspacePath === null ? null : workspaceGroup.workspace,
        path: workspaceGroup.workspacePath,
      };

      return sessionsForView(workspaceGroup.sessions, view, "local", now, chats, unread)
        .flatMap((group) => group.sessions)
        .map((session) => ({ place, session }));
    })
    .toSorted((left, right) => order(left.session, right.session));

  const pinned = flat ? [] : (listed ?? []).filter(({ session }) => session.pinned);

  const activeWorkspace =
    paneSession === undefined
      ? undefined
      : workspaceSessions.data?.find((workspaceGroup) =>
          workspaceGroup.sessions.some((session) => session.id === paneSession.id),
        );

  const neighbours =
    activeSessionId === undefined
      ? []
      : listedNeighbours(
          flat
            ? (listed ?? []).map(({ session }) => session)
            : sessionsForView(
                (activeWorkspace &&
                  localSessions(
                    workspaceSessions.data ?? [],
                    activeWorkspace.workspacePath === null ? null : activeWorkspace.workspace,
                  )) ??
                  [],
                view,
                "local",
                now,
                chats,
                unread,
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
      workspaceSessions.data === undefined
        ? undefined
        : localSessions(workspaceSessions.data, place.workspace);

    const name = entry.kind === "home" ? "Home" : entry.name;
    const expanded = !folded.includes(place.workspace);

    const kept =
      expanded || sessions === undefined
        ? undefined
        : folderView(sessions, view, now, chats, unread)
            .flatMap((group) => group.sessions)
            .find((session) => session.id === activeSessionId);

    const unreadHere = sessionsForNavigation(sessions ?? []).flatMap((session) =>
      unread.has(session.id) ? [session.id] : [],
    );

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
        onMarkAllRead={unreadHere.length === 0 ? undefined : () => markRead(unreadHere)}
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
        retained={kept && <SessionRow session={kept} place={place} rail={rail} />}
      >
        <FolderList
          listId={`${sessionListId}-${encodeURIComponent(`local:${place.workspace ?? "home"}`)}`}
          place={place}
          sessions={kept === undefined ? sessions : sessions?.filter((session) => session !== kept)}
          open={place.workspace === (open?.id ?? null)}
          context={context}
        />
      </WorkspaceRow>
    );
  });

  const closeConfirmation = (): void => setConfirmation({ kind: "closed" });

  const archive = (sessionId: SessionId, archived: boolean): void => {
    recordArchive(1);
    sessionActions.archive([sessionId], archived, hideFromPanes);
  };

  return (
    <aside {...props(styles.rail)}>
      <SidebarContent>
        {activeSessionId !== undefined && (
          <NeighbourWarm
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
            onOpenSession={(sessionId) => windowTabs.openChat(sessionId, "permanent")}
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

        <motion.div
          layoutScroll
          data-nyte-scrollport
          onKeyDown={moveSidebarFocus}
          {...props(styles.scroll)}
        >
          {pinned.length > 0 && <PinnedSection rows={pinned} rail={rail} />}
          <section aria-label={flat ? "Chats" : "Workspaces"} {...props(styles.section)}>
            <Collapsible.Root
              open={collectionExpanded}
              onOpenChange={setCollectionExpanded}
              data-sidebar-group=""
              {...props(styles.section)}
            >
              <div {...props(styles.sectionHeader)}>
                <Collapsible.Trigger
                  data-sidebar-header=""
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
                  filterDisabled={workspaceSessions.data === undefined}
                  onChange={preferences.sidebarView.set}
                  onOpenFolder={openFolder}
                  onCollapseAll={() =>
                    flat
                      ? setCollectionExpanded(false)
                      : preferences.sidebarFolded.set(
                          entries.map((entry) => (entry.kind === "home" ? null : entry.id)),
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
              account={githubAccount}
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
      {confirmation.kind === "archive-working" && (
        <ConfirmDialog
          open
          finalFocus={confirmationReturnRef}
          title="Archive Working Chat"
          description="It keeps working in the archive. Restore it from the Archived filter."
          confirmLabel="Archive Chat"
          onOpenChange={(nextOpen) => {
            if (!nextOpen) closeConfirmation();
          }}
          onConfirm={() => {
            closeConfirmation();
            archive(confirmation.sessionId, true);
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
