/**
 * The rail: new chat, search, and customize on top, then a persistent
 * workspace collection. The open workspace carries its sessions, recents
 * below it open on click, and the collection header owns folder opening.
 * Everything you switch between lives in this one column.
 *
 * Every row shares one geometry: a leading icon slot, the label, and one
 * trailing column for shortcuts, timestamps, and hover actions. Labels
 * therefore start and end on the same edges from the top of the rail to the
 * footer.
 *
 * Row edit state lives at the rail root so a directory refetch cannot drop an
 * in-progress rename. A short hover intent warms local thread data and route
 * code independently; navigation itself never waits for either cache.
 *
 * Based on https://github.com/interfaces-lab/honk/blob/main/packages/app/src/desktop-extensions/vertical-sidebar/view.tsx
 */
import * as stylex from "@stylexjs/stylex";
import { Button as BaseButton, Collapsible, Toggle } from "@nyte-ai/ui/primitives";
import { useMatch, useRouter } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import type { SessionId, SessionInfo, WorkspaceInfo } from "@nyte-ai/core";
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
import { usePaneActions, usePaneControllerSnapshot } from "../layout/pane-context.tsx";
import { activePane } from "../layout/pane-layout.ts";
import { useSessionDraggable } from "../layout/session-dnd.tsx";
import { macPlatform } from "../platform.ts";
import { sessionWorking } from "../run-state.ts";
import {
  warmThread,
  useArchiveAllSessions,
  useDeleteSession,
  useForgetWorkspace,
  useHostState,
  useRenameSession,
  useSetSessionArchived,
  useSetSessionPinned,
  useSessionPreview,
  useWorkspaces,
} from "../queries.ts";
import {
  loadRemainingSessions,
  sessionPreviewHasOverflow,
  visibleSessions,
} from "../session-directory.ts";
import { nyte } from "../nyte.ts";
import { sidebarStyles as styles } from "./sidebar.stylex.ts";
import { useGitHubAccount, type GitHubAccountViewModel } from "./github-account.ts";
import { handleOpenOutcome } from "./open-workspace.tsx";
import { SearchPalette } from "./search-palette.tsx";
import { SessionPreviewCard, type SessionPreviewContext } from "./sidebar-session-preview.tsx";
import { WorkspaceControls } from "./sidebar-filter.tsx";
import {
  clearSessionFilters,
  DEFAULT_SESSION_VIEW,
  needsCompleteSessionDirectory,
  sessionsForView,
  type SessionViewSettings,
} from "./sidebar-view.ts";
import { SettingsNavigation, type SettingsSection } from "./settings-navigation.tsx";
import { shellActions, useShellState } from "./shell-state.ts";

const REPORT_ISSUE_URL = "https://github.com/interfaces-lab/nyte/issues/new";

function SidebarContent({ children }: { readonly children: ReactNode }): ReactElement {
  const settings = useMatch({ from: "/settings/$section", shouldThrow: false });

  return (
    <nav
      aria-label={settings === undefined ? "Sessions and workspaces" : "Settings"}
      {...stylex.props(styles.content)}
    >
      <div hidden={settings !== undefined} {...stylex.props(styles.contentLayer)}>
        {children}
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
          aria-keyshortcuts={mac ? "Meta+," : "Control+,"}
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

interface WorkspaceDirectoryState {
  readonly workspacePath: string | undefined;
  readonly view: SessionViewSettings;
  readonly expandedSessions: readonly SessionInfo[] | undefined;
  readonly showAllSessions: boolean;
  readonly loadingMoreSessions: boolean;
}

function emptyWorkspaceDirectory(workspacePath: string | undefined): WorkspaceDirectoryState {
  return {
    workspacePath,
    view: DEFAULT_SESSION_VIEW,
    expandedSessions: undefined,
    showAllSessions: false,
    loadingMoreSessions: false,
  };
}

function sessionTitle(session: SessionInfo): string {
  return session.name ?? session.preview ?? "New chat";
}

/** One confirmation surface at a time: a chat deletion or a workspace-wide archive. */
type SidebarConfirmation =
  | { readonly kind: "closed" }
  | { readonly kind: "delete-session"; readonly sessionId: SessionId; readonly title: string }
  | { readonly kind: "archive-all"; readonly workspaceName: string };

export function Sidebar(): ReactElement {
  const panes = usePaneActions();
  const host = useHostState();
  const open = host.data?.workspace;
  const workspacePath = open?.path;
  const workspaces = useWorkspaces();
  const sessionPreview = useSessionPreview(host.data !== undefined);
  const setSessionPinned = useSetSessionPinned();
  const setSessionArchived = useSetSessionArchived();
  const renameSession = useRenameSession();
  const deleteSession = useDeleteSession();
  const archiveAll = useArchiveAllSessions();
  const forgetWorkspace = useForgetWorkspace();
  const { layout } = usePaneControllerSnapshot();
  const [confirmation, setConfirmation] = useState<SidebarConfirmation>({ kind: "closed" });
  // Confirmations open from a context menu, which has no persistent trigger to
  // return focus to; the dialog falls back to the previously focused element.
  const confirmationReturnRef = useRef<HTMLButtonElement>(null);
  // The footer is the one always-visible account surface, so it reads the
  // GitHub state itself. A fixed placeholder keeps its geometry stable while
  // that loads or when the project has no GitHub remote.
  const account = useGitHubAccount(open !== undefined);
  const workspaceCollectionID = useId();
  const { stage } = useShellState();
  const router = useRouter();
  const openSettings = (section: SettingsSection): void => {
    const replace = router.state.matches.some((match) => match.routeId === "/settings/$section");
    void router.navigate({ to: "/settings/$section", params: { section }, replace });
  };
  const [workspacesOpen, setWorkspacesOpen] = useState(true);
  const [sessionsOpen, setSessionsOpen] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [storedDirectory, setStoredDirectory] = useState<WorkspaceDirectoryState>(() =>
    emptyWorkspaceDirectory(workspacePath),
  );
  const directory =
    storedDirectory.workspacePath === workspacePath
      ? storedDirectory
      : emptyWorkspaceDirectory(workspacePath);
  const { view, expandedSessions, showAllSessions, loadingMoreSessions } = directory;

  const updateDirectory = (
    update: (current: WorkspaceDirectoryState) => WorkspaceDirectoryState,
  ): void => {
    setStoredDirectory((current) =>
      update(
        current.workspacePath === workspacePath ? current : emptyWorkspaceDirectory(workspacePath),
      ),
    );
  };
  const setSessionView = (value: SessionViewSettings): void => {
    updateDirectory((current) => ({ ...current, view: value }));
  };
  const setShowAllSessions = (value: boolean): void => {
    updateDirectory((current) => ({ ...current, showAllSessions: value }));
  };
  const setLoadingMoreSessions = (value: boolean): void => {
    updateDirectory((current) => ({ ...current, loadingMoreSessions: value }));
  };

  const selection = activePane(layout).selection;
  const activeSessionId = selection.kind === "session" ? selection.sessionId : undefined;
  const mac = macPlatform(host.data?.platform);
  const displayedSessions =
    sessionPreview.data === undefined
      ? []
      : visibleSessions(sessionPreview.data, expandedSessions, showAllSessions);
  const sessionGroups = sessionsForView(displayedSessions, view);
  const displayedSessionCount = sessionGroups.reduce(
    (count, group) => count + group.sessions.length,
    0,
  );
  const completeDirectoryRequired = needsCompleteSessionDirectory(view);
  // One fixed, name-ordered column: a click expands a row in place instead of
  // moving the opened workspace to the top.
  const entries: readonly ({ kind: "home" } | ({ kind: "project" } & WorkspaceInfo))[] = [
    { kind: "home" },
    ...(workspaces.data ?? [])
      .toSorted((left, right) => left.name.localeCompare(right.name))
      .map((workspace) => ({ kind: "project", ...workspace }) as const),
  ];
  const previewContext: SessionPreviewContext =
    open === undefined
      ? { kind: "home" }
      : {
          kind: "workspace",
          path: open.path,
          repository:
            account.kind === "signed_in" || account.kind === "signed_out"
              ? account.repository
              : undefined,
        };

  const showCompleteSessionDirectory = (): void => {
    if (loadingMoreSessions) return;
    const preview = sessionPreview.data;
    if (preview === undefined) return;
    if (expandedSessions !== undefined || preview.next === undefined) {
      setShowAllSessions(true);
      return;
    }
    setLoadingMoreSessions(true);
    const requestedWorkspacePath = workspacePath;
    void loadRemainingSessions(preview, (input) => nyte.sessions.list(input))
      .then((sessions) => {
        setStoredDirectory((current) =>
          current.workspacePath === requestedWorkspacePath
            ? {
                ...current,
                expandedSessions: sessions,
                showAllSessions: true,
              }
            : current,
        );
      })
      .catch(() => undefined)
      .finally(() => {
        setStoredDirectory((current) =>
          current.workspacePath === requestedWorkspacePath
            ? { ...current, loadingMoreSessions: false }
            : current,
        );
      });
  };

  const toggleRemainingSessions = (): void => {
    if (showAllSessions) {
      setShowAllSessions(false);
      return;
    }
    showCompleteSessionDirectory();
  };

  const openWorkspace = async (path: string, createChat: boolean): Promise<void> => {
    const outcome = await nyte.host.openWorkspace({ path });
    handleOpenOutcome(outcome);
    if (outcome.kind === "opened" && createChat) panes.newChat();
  };

  const openHome = async (createChat: boolean): Promise<void> => {
    await nyte.host.closeWorkspace();
    if (createChat) panes.newChat();
  };

  const closeConfirmation = (): void => {
    deleteSession.reset();
    archiveAll.reset();
    setConfirmation({ kind: "closed" });
  };

  const sessionPanel = (
    <>
      {sessionPreview.isPending && (
        <div aria-busy="true" {...stylex.props(styles.quiet, styles.sessionQuiet)}>
          Loading chats…
        </div>
      )}
      {sessionPreview.data !== undefined &&
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
      {sessionGroups.map((group) => (
        <div key={group.key} {...stylex.props(styles.section)}>
          {group.label !== undefined && (
            <div {...stylex.props(styles.sessionGroupLabel)}>{group.label}</div>
          )}
          {group.sessions.map((session) => (
            <SessionRow
              key={session.sessionId}
              session={session}
              previewContext={previewContext}
              selected={session.sessionId === activeSessionId}
              showUpdated={view.show.includes("updated")}
              actionsDisabled={setSessionPinned.isPending || setSessionArchived.isPending}
              onOpen={() => panes.openSession(session.sessionId)}
              onOpenBeside={() => panes.drop(session.sessionId, activePane(layout).id, "right")}
              onHover={() => warmThread(session.sessionId)}
              onRename={(name) => renameSession.mutate({ sessionId: session.sessionId, name })}
              onDelete={() =>
                setConfirmation({
                  kind: "delete-session",
                  sessionId: session.sessionId,
                  title: sessionTitle(session),
                })
              }
              onPin={() => {
                setSessionPinned.mutate({
                  sessionId: session.sessionId,
                  pinned: !session.pinned,
                });
              }}
              onArchive={() => {
                setSessionArchived.mutate(
                  {
                    sessionId: session.sessionId,
                    archived: !session.archived,
                  },
                  {
                    onSuccess: () => {
                      if (!session.archived && session.sessionId === activeSessionId) {
                        panes.removeSession(session.sessionId);
                      }
                    },
                  },
                );
              }}
            />
          ))}
        </div>
      ))}
      {completeDirectoryRequired && loadingMoreSessions && (
        <div aria-busy="true" {...stylex.props(styles.quiet)}>
          Loading remaining chats…
        </div>
      )}
      {!completeDirectoryRequired &&
        sessionPreview.data !== undefined &&
        sessionPreviewHasOverflow(sessionPreview.data) && (
          <button
            type="button"
            aria-expanded={showAllSessions}
            aria-busy={loadingMoreSessions}
            disabled={loadingMoreSessions}
            {...stylex.props(styles.showMore, focus.ringInset)}
            onClick={toggleRemainingSessions}
          >
            {showAllSessions ? "Show less" : "Show more"}
          </button>
        )}
    </>
  );

  const newChatActive = stage.kind === "workspace" && selection.kind === "blank" && !paletteOpen;

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
              onClick={() => {
                shellActions.showWorkspace();
                panes.newChat();
              }}
            >
              <span {...stylex.props(styles.navIcon)}>
                <Icon name="new-chat" size={14} />
              </span>
              <span {...stylex.props(styles.navLabel)}>New Chat</span>
              <span {...stylex.props(styles.shortcutSlot, styles.shortcutPersistent)}>
                <Kbd keys={mac ? ["⌘", "N"] : ["Ctrl", "N"]} />
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
              onNewChat={() => {
                shellActions.showWorkspace();
                panes.newChat();
              }}
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
                    <Kbd keys={mac ? ["⌘", "K"] : ["Ctrl", "K"]} />
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
          </div>

          <div data-nyte-scrollport {...stylex.props(styles.scroll)}>
            <section aria-label="Workspaces" {...stylex.props(styles.section)}>
              <Collapsible.Root
                open={workspacesOpen}
                onOpenChange={setWorkspacesOpen}
                {...stylex.props(styles.section)}
              >
                <div {...stylex.props(styles.sectionHeader)}>
                  <Collapsible.Trigger
                    aria-controls={workspaceCollectionID}
                    {...stylex.props(styles.sectionToggle, focus.ringInset)}
                  >
                    <span {...stylex.props(styles.sectionLabel)}>Workspaces</span>
                    <span
                      {...stylex.props(
                        styles.sectionChevron,
                        workspacesOpen && styles.sectionChevronOpen,
                      )}
                    >
                      <Icon name="chevron-right" size={11} />
                    </span>
                  </Collapsible.Trigger>
                  <WorkspaceControls
                    value={view}
                    filterDisabled={host.data === undefined || sessionPreview.data === undefined}
                    onChange={(nextView) => {
                      setSessionView(nextView);
                      if (needsCompleteSessionDirectory(nextView)) showCompleteSessionDirectory();
                    }}
                    onOpenFolder={() => void nyte.host.pickWorkspace().then(handleOpenOutcome)}
                    onCollapseAll={() => setSessionsOpen(false)}
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
                      const select = (createChat: boolean): void => {
                        setSessionsOpen(true);
                        void (entry.kind === "home"
                          ? openHome(createChat)
                          : openWorkspace(entry.path, createChat));
                      };
                      return (
                        <WorkspaceRow
                          key={entry.kind === "home" ? "home" : entry.path}
                          name={entry.kind === "home" ? "Home" : entry.name}
                          path={entry.kind === "home" ? "Home" : entry.path}
                          available={entry.kind === "home" || entry.available !== false}
                          active={active}
                          expanded={active && sessionsOpen}
                          onExpandedChange={(next) => {
                            if (active) setSessionsOpen(next);
                            else select(false);
                          }}
                          onNewChat={() => {
                            shellActions.showWorkspace();
                            if (active) panes.newChat();
                            else select(true);
                          }}
                          onArchiveAll={
                            // Sessions load only for the open workspace, so the
                            // directory this walks is the one on screen.
                            active && sessionPreview.data !== undefined
                              ? () =>
                                  setConfirmation({
                                    kind: "archive-all",
                                    workspaceName: entry.kind === "home" ? "Home" : entry.name,
                                  })
                              : undefined
                          }
                          onRemove={
                            entry.kind === "home"
                              ? undefined
                              : () => forgetWorkspace.mutate(entry.path)
                          }
                        >
                          {active && sessionPanel}
                        </WorkspaceRow>
                      );
                    })}
                </Collapsible.Panel>
              </Collapsible.Root>
            </section>
          </div>
        </>
      </SidebarContent>

      <div {...stylex.props(styles.footer)}>
        <div {...stylex.props(styles.footerRow)}>
          <AccountFooterMenu
            account={account}
            mac={mac}
            onOpenSettings={() => openSettings("general")}
          />
          <SettingsFooterToggle mac={mac} />
        </div>
      </div>
      {confirmation.kind === "delete-session" && (
        <ConfirmDialog
          open
          pending={deleteSession.isPending}
          error={deleteSession.isError ? "Couldn't delete this chat. Try again." : undefined}
          returnFocusRef={confirmationReturnRef}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) closeConfirmation();
          }}
          onConfirm={() => {
            const { sessionId } = confirmation;
            deleteSession.mutate(sessionId, {
              onSuccess: () => {
                closeConfirmation();
                panes.removeSession(sessionId);
              },
            });
          }}
        />
      )}
      {confirmation.kind === "archive-all" && (
        <ConfirmDialog
          open
          pending={archiveAll.isPending}
          error={archiveAll.isError ? "Couldn't archive every chat. Try again." : undefined}
          returnFocusRef={confirmationReturnRef}
          title={`Archive all chats in ${confirmation.workspaceName}?`}
          description="Open chats move to the archive. You can restore any of them later."
          confirmLabel="Archive all"
          pendingLabel="Archiving…"
          onOpenChange={(nextOpen) => {
            if (!nextOpen) closeConfirmation();
          }}
          onConfirm={() => {
            archiveAll.mutate(undefined, {
              onSuccess: () => {
                closeConfirmation();
                if (activeSessionId !== undefined) panes.removeSession(activeSessionId);
              },
            });
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
  mac,
  onOpenSettings,
}: {
  account: GitHubAccountViewModel;
  mac: boolean;
  onOpenSettings: (trigger: HTMLElement) => void;
}): ReactElement {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const avatarUrl = account.kind === "signed_in" ? account.account.avatarUrl : undefined;
  const label =
    account.kind === "signed_in"
      ? account.account.login
      : account.kind === "signed_out" || account.kind === "connecting"
        ? "GitHub"
        : "Accounts";
  const shortcut = mac ? "⌘," : "Ctrl+,";

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
            disabled={account.kind === "connecting"}
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
          meta={shortcut}
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
        {account.kind === "signed_in" && (
          <>
            <MenuSeparator />
            <MenuItem icon="arrow-wall-left" danger onSelect={() => setConfirmingSignOut(true)}>
              Sign out
            </MenuItem>
          </>
        )}
      </Menu>
      {account.kind === "signed_in" && (
        <ConfirmDialog
          open={confirmingSignOut}
          pending={account.signingOut}
          error={undefined}
          returnFocusRef={triggerRef}
          title="Sign out of GitHub?"
          description="You’ll need to sign in again to use GitHub account features."
          confirmLabel="Sign out"
          pendingLabel="Signing out…"
          onOpenChange={setConfirmingSignOut}
          onConfirm={account.signOut}
        />
      )}
    </>
  );
}

/**
 * Every workspace is the same collapsible row, so a click never swaps the
 * tree. Only the active row's panel has content: expanding an inactive row
 * asks the host to open it, and its sessions grow in place once it does.
 */
function WorkspaceRow({
  name,
  path,
  available,
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
  readonly active: boolean;
  readonly expanded: boolean;
  readonly onExpandedChange: (expanded: boolean) => void;
  readonly onNewChat: () => void;
  /** Absent when this workspace's chats are not loaded, so the item does not render. */
  readonly onArchiveAll: (() => void) | undefined;
  /** Absent for Home, which is not a registry entry. */
  readonly onRemove: (() => void) | undefined;
  readonly children: ReactNode;
}): ReactElement {
  const trigger = (
    <Collapsible.Trigger
      title={available ? path : `${path} (folder unavailable, saved chats are still available)`}
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
          <ContextMenuItem icon="new-chat-folder" onSelect={onNewChat}>
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
          {onRemove !== undefined && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem icon="trash" danger onSelect={onRemove}>
                Remove from sidebar
              </ContextMenuItem>
            </>
          )}
        </ContextMenu>
        <button
          type="button"
          aria-label={`New chat in ${name}`}
          title={`New chat in ${name}`}
          {...stylex.props(styles.workspaceCreateAction, focus.ringInset)}
          onClick={onNewChat}
        >
          <Icon name="new-chat-folder" size={13} />
        </button>
      </div>
      <Collapsible.Panel {...stylex.props(styles.sessionList)}>{children}</Collapsible.Panel>
    </Collapsible.Root>
  );
}

interface SessionRowProps {
  session: SessionInfo;
  previewContext: SessionPreviewContext;
  selected: boolean;
  showUpdated: boolean;
  actionsDisabled: boolean;
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
  previewContext,
  selected,
  showUpdated,
  actionsDisabled,
  onOpen,
  onOpenBeside,
  onHover,
  onRename,
  onPin,
  onArchive,
  onDelete,
}: SessionRowProps): ReactElement {
  const warmTimer = useRef<number | undefined>(undefined);
  const working = sessionWorking(session);
  const title = sessionTitle(session);
  const [draftName, setDraftName] = useState<string | undefined>();
  const { isDragging, listeners, setNodeRef } = useSessionDraggable(session.sessionId, title);

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
      <div {...stylex.props(styles.sessionRenameRow)}>
        <span {...stylex.props(styles.rowIcon)}>{working && <StatusDot working />}</span>
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
      </div>
    );
  }

  const row = (
    <div
      ref={setNodeRef}
      {...stylex.props(
        styles.sessionRowShell,
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
        <span {...stylex.props(styles.rowIcon)}>{working && <StatusDot working />}</span>
        <span {...stylex.props(styles.rowTitle)}>{title}</span>
        <span {...stylex.props(styles.trailing, styles.sessionTrailing)}>
          <span {...stylex.props(styles.rowMeta)}>
            {showUpdated ? formatTimeAgo(session.lastActivityAt) : undefined}
          </span>
        </span>
      </BaseButton>
      <span
        data-nyte-session-row-actions=""
        {...stylex.props(styles.rowActions, styles.sessionRowActions)}
      >
        <button
          type="button"
          disabled={actionsDisabled}
          aria-label={session.pinned ? "Unpin" : "Pin"}
          title={session.pinned ? "Unpin" : "Pin"}
          {...stylex.props(styles.action, focus.ringInset)}
          onClick={onPin}
        >
          <Icon name={session.pinned ? "unpin" : "pin"} size={12} />
        </button>
        <button
          type="button"
          disabled={actionsDisabled}
          aria-label={session.archived ? "Restore" : "Archive"}
          title={session.archived ? "Restore" : "Archive"}
          {...stylex.props(styles.action, focus.ringInset)}
          onClick={onArchive}
        >
          <Icon name="archive" size={12} />
        </button>
      </span>
    </div>
  );

  return (
    <SessionPreviewCard
      title={title}
      context={previewContext}
      trigger={row}
      contextMenu={
        <>
          <ContextMenuItem
            icon={session.pinned ? "unpin" : "pin"}
            disabled={actionsDisabled}
            onSelect={onPin}
          >
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
          <ContextMenuItem icon="archive" disabled={actionsDisabled} onSelect={onArchive}>
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
