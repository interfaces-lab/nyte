/**
 * The rail: new chat, search, and customize on top, then a persistent
 * workspace collection. Every folder expands independently over its cached
 * sessions, and the collection header owns folder opening.
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
import {
  paneControllerForWorkspace,
  usePaneActions,
  usePaneControllerSnapshot,
} from "../layout/pane-context.tsx";
import { useSessionRemoval } from "../layout/use-session-removal.ts";
import { activePane } from "../layout/pane-layout.ts";
import { useSessionDraggable } from "../layout/session-dnd.tsx";
import { macPlatform } from "../platform.ts";
import {
  warmThread,
  useForgetWorkspace,
  useHostState,
  useRenameSession,
  useSessionActions,
  useWorkspaceSessionDirectory,
  loadLocalResources,
  useWorkspaces,
} from "../queries.ts";
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

function sessionTitle(session: SessionInfo): string {
  return session.name ?? session.preview ?? "New chat";
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
  const sessionActions = useSessionActions();
  const removeSession = useSessionRemoval();
  const renameSession = useRenameSession();
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
  const { stage, homeVisible } = useShellState();
  const router = useRouter();
  const openSettings = (section: SettingsSection): void => {
    const replace = router.state.matches.some((match) => match.routeId === "/settings/$section");
    void router.navigate({ to: "/settings/$section", params: { section }, replace });
  };
  const [workspacesOpen, setWorkspacesOpen] = useState(true);
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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [view, setSessionView] = useState<SessionViewSettings>(DEFAULT_SESSION_VIEW);
  const selection = activePane(layout).selection;
  const activeSessionId = selection.kind === "session" ? selection.sessionId : undefined;
  const mac = macPlatform(host.data?.platform);
  const completeDirectoryRequired = needsCompleteSessionDirectory(view);
  // One fixed, name-ordered column: a click expands a row in place instead of
  // moving the opened workspace to the top.
  const entries: readonly ({ kind: "home" } | ({ kind: "project" } & WorkspaceInfo))[] = [
    ...(homeVisible ? [{ kind: "home" } as const] : []),
    ...(workspaces.data ?? [])
      .toSorted((left, right) => left.name.localeCompare(right.name))
      .map((workspace) => ({ kind: "project", ...workspace }) as const),
  ];
  const activateWorkspace = async (path: string | null): Promise<boolean> => {
    if (path === (workspacePath ?? null)) return true;
    if (path === null) await nyte.host.closeWorkspace();
    else {
      const outcome = await nyte.host.openWorkspace({ path });
      handleOpenOutcome(outcome);
      if (outcome.kind !== "opened") return false;
    }
    await loadLocalResources();
    return true;
  };

  const showSession = async (
    path: string | null,
    sessionId: SessionId,
    beside = false,
  ): Promise<void> => {
    if (!(await activateWorkspace(path))) return;
    const controller = paneControllerForWorkspace(path ?? undefined);
    if (beside) controller.drop(sessionId, activePane(controller.getSnapshot().layout).id, "right");
    else controller.selectSession(sessionId);
    shellActions.showWorkspace();
    await router.navigate({ to: "/session/$sessionId", params: { sessionId } });
  };

  const newWorkspaceChat = async (path: string | null): Promise<void> => {
    if (!(await activateWorkspace(path))) return;
    setExpanded(path, true);
    paneControllerForWorkspace(path ?? undefined).selectBlank();
    shellActions.showWorkspace();
    await router.navigate({ to: "/" });
  };

  const closeConfirmation = (): void => {
    setConfirmation({ kind: "closed" });
  };

  const sessionPanel = (path: string | null): ReactElement | null => {
    const sessions = sessionDirectory.data?.find((entry) => entry.workspacePath === path)?.sessions;
    if (sessions === undefined) return null;
    const sessionGroups = sessionsForView(sessions, view);
    const displayedSessionCount = sessionGroups.reduce(
      (count, group) => count + group.sessions.length,
      0,
    );
    const previewContext: SessionPreviewContext =
      path === null
        ? { kind: "home" }
        : {
            kind: "workspace",
            path,
            repository:
              path === workspacePath &&
              (account.kind === "signed_in" || account.kind === "signed_out")
                ? account.repository
                : undefined,
          };
    return (
      <>
        {displayedSessionCount === 0 &&
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
                draggable={path === (workspacePath ?? null)}
                previewContext={previewContext}
                selected={session.sessionId === activeSessionId}
                showUpdated={view.show.includes("updated")}
                onOpen={() => void showSession(path, session.sessionId)}
                onOpenBeside={() => void showSession(path, session.sessionId, true)}
                onHover={() => warmThread(session.sessionId)}
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
                  sessionActions.archive([session.sessionId], !session.archived, (id) =>
                    removeSession(path, id),
                  );
                }}
              />
            ))}
          </div>
        ))}
      </>
    );
  };

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
                      const sessions = sessionDirectory.data?.find(
                        (directory) => directory.workspacePath === path,
                      )?.sessions;
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
                                    sessionIds: sessions
                                      .filter((session) => !session.archived)
                                      .map((session) => session.sessionId),
                                  })
                          }
                          onRemove={
                            entry.kind === "home"
                              ? () => shellActions.setHomeVisible(false)
                              : () => forgetWorkspace.mutate(entry.path)
                          }
                        >
                          {sessionPanel(path)}
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
 * Every folder expands independently over its cached directory. Expansion
 * does not select a workspace or make an IPC request.
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
  readonly onRemove: () => void;
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
  draggable: boolean;
  previewContext: SessionPreviewContext;
  selected: boolean;
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
  const working = session.heads.some(
    (head) =>
      head.run !== undefined && !["done", "aborted", "failed"].includes(head.run.phase.kind),
  );
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
          aria-label={session.pinned ? "Unpin" : "Pin"}
          title={session.pinned ? "Unpin" : "Pin"}
          {...stylex.props(styles.action, focus.ringInset)}
          onClick={onPin}
        >
          <Icon name={session.pinned ? "unpin" : "pin"} size={12} />
        </button>
        <button
          type="button"
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
