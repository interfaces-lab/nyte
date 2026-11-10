import type { SessionId, SessionInfo, WorkspaceId } from "@nyte-ai/sdk";
import { coordinatedProject, findProject, useProjects } from "../data/projects.ts";
import { ConfirmDialog } from "@nyte-ai/ui/alert-dialog";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { Icon } from "@nyte-ai/ui/icon";
import { Kbd } from "@nyte-ai/ui/kbd";
import { Row } from "@nyte-ai/ui/row";
import { focus } from "@nyte-ai/ui/styles/a11y.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { props } from "@stylexjs/stylex";
import { Link, useRouter } from "@tanstack/react-router";
import { useId, useRef, useState } from "react";
import type { ReactElement } from "react";
import {
  clientActionAriaShortcut,
  clientActionKeys,
  clientActions,
} from "../contract/client-actions.ts";
import { usePaneActions, usePaneLayout } from "../panes/pane-context.tsx";
import { activeSelection, sameSelection } from "../panes/pane-layout.ts";
import { nyte } from "../contract/nyte.ts";
import { preferences, useSetting } from "../preferences/index.ts";
import {
  useForgetWorkspace,
  useHomeWorkspace,
  useWorkspaces,
  type RailWorkspace,
} from "../data/workspaces.ts";
import { useHostHealth, useHostState, useServerState } from "../data/host.ts";
import { sessionActions, useRootRows } from "../data/session-rows.ts";
import { groupByWorkspace, localSessions } from "../data/session-list.ts";
import { useChats } from "../chats/index.ts";
import { chatWindow, unreadOnHost, useChatWindow } from "../window/index.ts";
import type { SettingsSection } from "../settings/index.ts";
import { windowTabs } from "../tabs/window-tabs.ts";
import { SidebarFooter } from "../account/account-footer.tsx";
import { folderPicker } from "../panes/open-workspace.tsx";
import { SearchPalette } from "./search-palette.tsx";
import { actionIcons, settingsActionPages } from "./action-icons.ts";
import { shellActions, useOverlays, useStagePage } from "../tabs/shell-state.ts";
import { SidebarContent } from "./sidebar-content.tsx";
import { WorkspaceControls } from "./sidebar-filter.tsx";
import {
  ChatsList,
  FolderList,
  ProjectsSection,
  ListedRows,
  PinnedSection,
  useDrafts,
  useListReveal,
  WorkspaceRow,
  type ListContext,
  type ListedSession,
} from "./sidebar-lists.tsx";
import { moveSidebarFocus } from "./sidebar-navigation.ts";
import { NeighbourWarm, type SessionPlace } from "./sidebar-rows.tsx";
import { sidebarStyles as styles } from "./sidebar.stylex.ts";
import {
  clearSessionFilters,
  folderView,
  sessionOrder,
  sessionsForNavigation,
  sessionsForView,
  deriveShelf,
  type ShelfHold,
} from "./sidebar-view.ts";
import { activateWorkspace } from "./use-show-session.ts";
import { useNowMinute } from "../lib/use-now-minute.ts";

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
  listsDrafts,
  paletteOpen,
  mac,
}: {
  readonly listsDrafts: boolean;
  readonly paletteOpen: boolean;
  readonly mac: boolean;
}): ReactElement {
  const panes = usePaneActions();
  const { drafts, activeDraftId } = useDrafts();
  const listed = listsDrafts && drafts.some((draft) => draft.id === activeDraftId);
  const current = activeDraftId !== undefined && !listed && !paletteOpen;

  return (
    <Row
      variant="nav"
      selected={current}
      aria-current={current ? "page" : undefined}
      xstyle={styles.navRow}
      onClick={() => panes.newChat()}
    >
      <Row.Leading xstyle={styles.navLeading}>
        <Icon name={actionIcons[clientActions.newChat.id]} size="sm" />
      </Row.Leading>
      <Row.Label>New Chat</Row.Label>
      <span {...props(styles.shortcutSlot)}>
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
  const home = useHomeWorkspace();
  const workspaces = useWorkspaces();
  const roots = useRootRows();

  const railWorkspaces =
    home === undefined
      ? undefined
      : (workspaces.data ?? []).filter((workspace) => workspace.id !== home);

  const openPlace = open === undefined || open.id === home ? null : open.id;

  const workspaceGroups =
    roots === undefined || railWorkspaces === undefined
      ? undefined
      : groupByWorkspace(roots, railWorkspaces);

  const server = useServerState();
  const health = useHostHealth();

  const unreachable =
    workspaceGroups !== undefined
      ? undefined
      : health?.kind === "retrying"
        ? "Can't load chats. Retrying…"
        : health?.kind === "blocked"
          ? health.error.message
          : undefined;

  const forgetWorkspace = useForgetWorkspace();
  const chats = useChats((directory) => directory);
  const unread = useChatWindow((snapshot) => snapshot.unread);
  const now = useNowMinute();
  const page = useStagePage();
  const paletteOpen = useOverlays().search;
  const homeVisible = useSetting(preferences.homeVisible);
  const router = useRouter();
  const openFolder = folderPicker();
  const reveal = useListReveal();
  const confirmationReturnRef = useRef<HTMLButtonElement>(null);

  const [archivingAll, setArchivingAll] = useState<{
    readonly workspaceName: string;
    readonly sessionIds: readonly SessionId[];
  }>();

  const [removing, setRemoving] = useState<{
    readonly workspace: WorkspaceId;
    readonly name: string;
  }>();

  const [collectionExpanded, setCollectionExpanded] = useState(true);
  const [cloudCollapsed, setCloudCollapsed] = useState(false);
  const view = useSetting(preferences.sidebarView);
  const projectsOn = useSetting(preferences.projects);
  const projects = useProjects();
  const folded = useSetting(preferences.sidebarFolded);
  const [hold, setHold] = useState<ShelfHold | undefined>();
  const [listedWhenBlank, setListedWhenBlank] = useState<ReadonlySet<SessionId>>();

  const cloudFailure =
    server.data?.kind === "unavailable" ? server.data.problem.message : undefined;

  const flat = view.grouping === "none" || view.grouping === "inbox";
  const selection = usePaneLayout(activeSelection, sameSelection);
  const paneSessionId = selection.kind === "session" ? selection.sessionId : undefined;
  const activeSessionId = page === undefined ? paneSessionId : undefined;
  const mac = nyte.platform === "darwin";

  const paneSession =
    paneSessionId === undefined
      ? undefined
      : workspaceGroups
          ?.flatMap((workspaceGroup) => workspaceGroup.sessions)
          .find((session) => session.id === paneSessionId);

  if (selection.kind === "blank" && listedWhenBlank === undefined && workspaceGroups)
    setListedWhenBlank(
      new Set(
        workspaceGroups.flatMap((workspaceGroup) =>
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
                : deriveShelf(paneSession, chats, unreadOnHost(chats), undefined),
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

  const showDrafts =
    !view.archived &&
    (view.statuses.length === 0 || view.statuses.includes("draft")) &&
    (view.environments.length === 0 || view.environments.includes("local"));

  const context: ListContext = {
    view,
    showDrafts,
    activeSessionId,
    openWorkspace: openPlace,
    unavailable: new Set(
      (workspaces.data ?? []).flatMap((workspace) =>
        workspace.available === false ? [workspace.id] : [],
      ),
    ),
    chats,
    unread,
    reveal,
    onClearFilters: () => preferences.sidebarView.set(clearSessionFilters(view)),
  };

  const order = sessionOrder(view.sort, chats);

  const outsideProjects = (
    sessions: readonly SessionInfo[] | undefined,
  ): readonly SessionInfo[] | undefined =>
    projectsOn
      ? sessions?.filter((session) => {
          const project = coordinatedProject(session);

          return project === undefined || findProject(project)?.archived === true;
        })
      : sessions;

  const listed: readonly ListedSession[] | undefined = workspaceGroups
    ?.flatMap((workspaceGroup) => {
      const place: SessionPlace = {
        workspace: workspaceGroup.workspacePath === null ? null : workspaceGroup.workspace,
        path: workspaceGroup.workspacePath,
      };

      return sessionsForView(
        outsideProjects(workspaceGroup.sessions) ?? [],
        view,
        "local",
        now,
        chats,
        unread,
      )
        .flatMap((group) => group.sessions)
        .map((session) => ({ place, session }));
    })
    .toSorted((left, right) => order(left.session, right.session));

  const pinned = flat ? [] : (listed ?? []).filter(({ session }) => session.pinned);

  const activeWorkspace =
    paneSession === undefined
      ? undefined
      : workspaceGroups?.find((workspaceGroup) =>
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
                    workspaceGroups ?? [],
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

  const homeSessions =
    workspaceGroups === undefined
      ? undefined
      : outsideProjects(localSessions(workspaceGroups, null));

  const homeListed =
    homeVisible &&
    homeSessions !== undefined &&
    folderView(homeSessions, view, now, chats, unread).some((group) => group.sessions.length > 0);

  const entries: readonly ({ kind: "home" } | ({ kind: "project" } & RailWorkspace))[] = [
    ...(homeListed ? [{ kind: "home" } as const] : []),
    ...(railWorkspaces ?? [])
      .filter((workspace) => workspace.worktree === null)
      .toSorted((left, right) => left.name.localeCompare(right.name))
      .map((workspace) => ({ kind: "project", ...workspace }) as const),
  ];

  const rowPlaces = entries.map((entry) => (entry.kind === "home" ? null : entry.id));

  const folders = entries.map((entry) => {
    const place: SessionPlace =
      entry.kind === "home"
        ? { workspace: null, path: null }
        : { workspace: entry.id, path: entry.path };

    const sessions =
      workspaceGroups === undefined
        ? undefined
        : outsideProjects(localSessions(workspaceGroups, place.workspace));

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
        active={place.workspace === openPlace}
        expanded={expanded}
        onExpandedChange={(next) => setExpanded(place.workspace, next)}
        onNewChat={
          entry.kind === "home" || entry.available ? () => void newWorkspaceChat(place) : undefined
        }
        onMarkAllRead={unreadHere.length === 0 ? undefined : () => chatWindow.markRead(unreadHere)}
        onArchiveAll={
          sessions === undefined
            ? undefined
            : () =>
                setArchivingAll({
                  workspaceName: name,
                  sessionIds: sessionsForNavigation(sessions).map((session) => session.id),
                })
        }
        onRemove={
          entry.kind === "home"
            ? () => preferences.homeVisible.set(false)
            : () => {
                forgetWorkspace.reset();
                setRemoving({ workspace: entry.id, name });
              }
        }
        retained={kept && <ListedRows rows={[{ place, session: kept }]} context={context} />}
      >
        <FolderList
          listId={`${sessionListId}-${encodeURIComponent(`local:${place.workspace ?? "home"}`)}`}
          place={place}
          sessions={kept === undefined ? sessions : sessions?.filter((session) => session !== kept)}
          open={place.workspace === openPlace}
          context={context}
        />
      </WorkspaceRow>
    );
  });

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
          <NewChatRow
            listsDrafts={showDrafts && (flat || rowPlaces.includes(openPlace))}
            paletteOpen={paletteOpen}
            mac={mac}
          />

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
                  <Icon name={actionIcons[clientActions.search.id]} size="sm" />
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
              <Icon name={actionIcons[clientActions.customize.id]} size="sm" />
            </Row.Leading>
            <Row.Label>Customize</Row.Label>
          </Row>

          <Row
            variant="nav"
            data-sidebar-return
            aria-keyshortcuts={clientActionAriaShortcut(clientActions.settings, mac)}
            render={
              <Link
                to="/settings/$section"
                params={{ section: settingsActionPages.settings }}
                preload="render"
              />
            }
            xstyle={styles.navRow}
          >
            <Row.Leading xstyle={styles.navLeading}>
              <Icon name={actionIcons[clientActions.settings.id]} size="sm" />
            </Row.Leading>
            <Row.Label>Settings</Row.Label>
            <Icon name="chevron-right" size="sm" />
          </Row>
        </div>

        <div data-nyte-scrollport onKeyDown={moveSidebarFocus} {...props(styles.scroll)}>
          {projectsOn && (
            <ProjectsSection
              projects={projects}
              selected={
                page?.kind === "project"
                  ? page.projectId
                  : activeSessionId === undefined || paneSession === undefined
                    ? undefined
                    : coordinatedProject(paneSession)
              }
            />
          )}
          {pinned.length > 0 && <PinnedSection rows={pinned} context={context} />}
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
                  filterDisabled={workspaceGroups === undefined}
                  onChange={preferences.sidebarView.set}
                  onOpenFolder={openFolder}
                  onCollapseAll={() =>
                    flat ? setCollectionExpanded(false) : preferences.sidebarFolded.set(rowPlaces)
                  }
                />
              </div>

              <Collapsible.Panel id={workspaceCollectionID} {...props(styles.workspaceCollection)}>
                {unreachable !== undefined && (
                  <div role="status" {...props(text.base, styles.quiet, styles.sessionQuiet)}>
                    {unreachable}
                  </div>
                )}
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
        </div>
      </SidebarContent>

      <SidebarFooter onOpenSettings={openSettings} />
      {archivingAll !== undefined && (
        <ConfirmDialog
          open
          pending={false}
          error={undefined}
          finalFocus={confirmationReturnRef}
          title={`Archive All Chats in ${archivingAll.workspaceName}`}
          description="Open chats move to the archive. You can restore any of them later."
          confirmLabel={`Archive All Chats in ${archivingAll.workspaceName}`}
          pendingLabel="Archiving chats…"
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setArchivingAll(undefined);
          }}
          onConfirm={() => {
            setArchivingAll(undefined);
            sessionActions.archive(archivingAll.sessionIds, true);
          }}
        />
      )}
      {removing !== undefined && (
        <ConfirmDialog
          open
          pending={forgetWorkspace.isPending}
          error={
            forgetWorkspace.data?.kind === "busy"
              ? "A chat in this folder is still working. Stop it, then try again."
              : forgetWorkspace.isError
                ? "Couldn't remove this folder. Try again."
                : undefined
          }
          finalFocus={confirmationReturnRef}
          title={`Remove ${removing.name}`}
          description="Every chat in this folder is deleted, archived ones too. This can't be undone. The files on disk stay."
          confirmLabel="Remove Folder and Chats"
          pendingLabel="Removing chats…"
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setRemoving(undefined);
          }}
          onConfirm={() =>
            forgetWorkspace.mutate(removing.workspace, {
              onSuccess: (outcome) => {
                if (outcome.kind !== "busy") setRemoving(undefined);
              },
            })
          }
        />
      )}
    </aside>
  );
}
