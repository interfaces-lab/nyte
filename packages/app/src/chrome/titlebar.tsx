import { titlebarStyles } from "./titlebar.stylex.ts";
/**
 * Permanent window chrome. The sidebar toggle stays on the rail side; chat
 * actions and the stage-level workbench entry stay at the trailing edge.
 */
import { props } from "@stylexjs/stylex";
import { createLink, useCanGoBack, useMatch, useRouter } from "@tanstack/react-router";
import { closeSettings } from "./settings-return.ts";
// oxlint-disable-next-line no-restricted-imports -- menu commands and shortcuts act on the current workspace state
import { useCallback, useEffect } from "react";
import type { ReactElement } from "react";
import type { SessionId } from "@nyte-ai/protocol";
import { Icon, PanelToggleIcon } from "@nyte-ai/ui/icon";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@nyte-ai/ui/menu";
import { Button, ButtonLink } from "@nyte-ai/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import { Toggle } from "@nyte-ai/ui/toggle";
import {
  useCanSplitPane,
  usePaneActions,
  usePaneControllerSnapshot,
} from "../layout/pane-context.tsx";
import { activePane } from "../layout/pane-layout.ts";
import { nyte } from "../nyte.ts";
import { macPlatform } from "../platform.ts";
import { useHostState, useSession, useSessionLocation, useWorkspaces } from "../queries.ts";
import {
  activeWorkbenchTab,
  defaultWorkbenchTab,
  workbenchController,
  workbenchScope,
  workbenchViewKey,
  useWorkbenchSnapshot,
} from "../workbench/controller.ts";
import { terminalActions } from "../workbench/terminal-store.ts";
import { folderPicker } from "./open-workspace.tsx";
import { shellActions, useShellState } from "./shell-state.ts";
import {
  clientActionAriaShortcut,
  clientActionShortcut,
  clientActions,
  clientCapabilities,
  resolveClientAction,
} from "../client-actions.ts";

import { WorkbenchTabStrip } from "../workbench/tab-strip.tsx";
import { canTravel } from "../tabs/model.ts";
import type { WindowState } from "../tabs/model.ts";
import { useWindowTabItems, useWindowTabsState } from "../tabs/use-window-tabs.tsx";
import { WindowTabStrip } from "../tabs/window-tab-strip.tsx";
import { windowTabs } from "../tabs/window-tabs.ts";

/**
 * Where the open chat runs, ahead of its title: the machine when it is not
 * this one, then the folder. A Home chat on this machine names nothing.
 */
function SessionLocation({ sessionId }: { sessionId: SessionId }): ReactElement | null {
  const location = useSessionLocation(sessionId);
  const workspaces = useWorkspaces();

  if (location === undefined) return null;

  if (location.environment === "cloud")
    return (
      <>
        <span {...props(titlebarStyles.sessionCrumb)}>
          <Icon name="cloud" size={12} />
          {location.available ? "Cloud" : "Cloud · unavailable"}
        </span>
        <span {...props(titlebarStyles.sessionCrumbDivider)}>/</span>
      </>
    );

  const path = location.workspacePath;

  if (path === null) return null;

  return (
    <>
      <span title={path} {...props(titlebarStyles.sessionCrumb)}>
        {workspaces.data?.find((workspace) => workspace.path === path)?.name ??
          path.split("/").at(-1)}
      </span>
      <span {...props(titlebarStyles.sessionCrumbDivider)}>/</span>
    </>
  );
}

const SessionLink = createLink(ButtonLink);

function SessionTitle({ sessionId }: { sessionId: SessionId }): ReactElement {
  const session = useSession(sessionId);
  const panes = usePaneActions();
  const parentSessionId = session.data?.parent?.sessionId;
  const title = session.data?.name ?? session.data?.preview ?? "New chat";

  return (
    <span {...props(titlebarStyles.sessionTitleGroup)}>
      {parentSessionId !== undefined && (
        <span {...props(titlebarStyles.sessionBack)}>
          <SessionLink
            iconOnly
            icon="arrow-left"
            aria-label="Back to parent chat"
            to="/session/$sessionId"
            params={{ sessionId: parentSessionId }}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              panes.openSession(parentSessionId);
            }}
          />
        </span>
      )}
      <SessionLocation sessionId={sessionId} />
      <span title={title} {...props(titlebarStyles.sessionTitle)}>
        {title}
      </span>
    </span>
  );
}

/** Its own component, so the session directory re-renders the strip and not the titlebar. */
function TitlebarTabStrip({ state, mac }: { state: WindowState; mac: boolean }): ReactElement {
  return (
    <WindowTabStrip
      tabs={useWindowTabItems(state)}
      activeTabId={state.activeTabId}
      mac={mac}
      onActivate={(tabId) => windowTabs.dispatch({ kind: "activate-tab", tabId })}
      onClose={(tabId) => windowTabs.dispatch({ kind: "close-tab", tabId })}
      onNewTab={() => windowTabs.dispatch({ kind: "new-tab" })}
      onReorder={(tabIds) => windowTabs.dispatch({ kind: "reorder", tabIds })}
      onTogglePin={(tabId) => windowTabs.dispatch({ kind: "toggle-pin", tabId })}
      onDuplicate={(tabId) => windowTabs.dispatch({ kind: "duplicate-tab", tabId })}
      onCloseOthers={(tabId) => windowTabs.dispatch({ kind: "close-others", tabId })}
      onCloseToRight={(tabId) => windowTabs.dispatch({ kind: "close-right", tabId })}
    />
  );
}

export function Titlebar(): ReactElement {
  const shellRouter = useRouter();
  const host = useHostState();
  const { layout } = usePaneControllerSnapshot();
  const panes = usePaneActions();
  const canSplit = useCanSplitPane();
  const workbench = useWorkbenchSnapshot();
  const { sidebarVisible, stage } = useShellState();
  const mac = macPlatform(host.data?.platform);
  const capabilities = clientCapabilities(nyte.host);
  const selection = activePane(layout).selection;
  const workspacePath = host.data?.workspace?.path;
  const viewKey = workbenchViewKey(workspacePath);
  const view = workbench.views.get(viewKey) ?? workbenchController.getView(viewKey);

  const userTerminals = view.tabs.filter(
    (tab) => tab.kind === "terminal" && tab.owner.kind === "user",
  );

  const terminalWorkspacePath = workspacePath ?? null;
  const scope = workbenchScope(workspacePath);
  const activeTab = activeWorkbenchTab(view, scope, capabilities);
  const settingsMatch = useMatch({ from: "/settings/$section", shouldThrow: false });
  const settingsOpen = settingsMatch !== undefined;
  const workspaceVisible = !settingsOpen && stage.kind === "workspace";
  const workbenchOpen = workspaceVisible && view.expanded;
  const historyCanGoBack = useCanGoBack();
  const tabbed = windowTabs.enabled;
  const tabs = useWindowTabsState();

  const canGoBack = tabbed
    ? canTravel(tabs, -1)
    : stage.kind !== "workspace" || settingsOpen || historyCanGoBack;

  const openTerminal = useCallback((): void => {
    if (nyte.host.terminal === undefined) return;

    const id = workbenchController.actions.openTab({
      view: viewKey,
      tab: { kind: "terminal", owner: { kind: "user" } },
      activate: true,
    });

    void terminalActions.create({ id, workspacePath: terminalWorkspacePath });
  }, [terminalWorkspacePath, viewKey]);

  useEffect(() => {
    const showWorkspace = (): void => {
      if (settingsOpen) closeSettings(shellRouter);
      shellActions.showWorkspace();
    };

    return nyte.host.onMenuCommand((command) => {
      if (command.kind === "about") {
        shellActions.showAbout(command.info);

        return;
      }

      shellActions.showAbout(undefined);

      switch (command.action) {
        case clientActions.newChat.id:
        case clientActions.newTab.id:
          if (settingsOpen) closeSettings(shellRouter);
          panes.newChat();

          return;
        case clientActions.reopenTab.id:
          if (settingsOpen) closeSettings(shellRouter);
          windowTabs.dispatch({ kind: "reopen-tab" });

          return;
        case clientActions.closeTab.id:
          if (settingsOpen) closeSettings(shellRouter);
          else
            windowTabs.dispatch({ kind: "close-tab", tabId: windowTabs.getSnapshot().activeTabId });

          return;
        case clientActions.openFolder.id:
          folderPicker()?.();

          return;
        case clientActions.newTerminal.id:
          if (nyte.host.terminal === undefined) return;
          showWorkspace();
          openTerminal();

          return;
        case clientActions.newBrowser.id:
          if (nyte.host.browser === undefined) return;
          showWorkspace();
          workbenchController.actions.openTab({
            view: viewKey,
            tab: defaultWorkbenchTab("browser"),
            activate: true,
          });

          return;
        case clientActions.settings.id:
          if (settingsOpen) return;
          void shellRouter.navigate({
            to: "/settings/$section",
            params: { section: "general" },
          });

          return;
        default: {
          const _exhaustive: never = command.action;

          return _exhaustive;
        }
      }
    });
  }, [openTerminal, panes, settingsOpen, shellRouter, viewKey]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!workspaceVisible) return;
      const action = resolveClientAction(event, mac, "workspace", clientCapabilities(nyte.host));

      if (action?.id === "terminal" || action?.id === "new-terminal") {
        event.preventDefault();

        if (action.id === "terminal" && workbenchOpen && activeTab?.kind === "terminal") {
          workbenchController.actions.toggle({ view: viewKey });
        } else if (action.id === "terminal" && userTerminals[0] !== undefined) {
          workbenchController.actions.activateTab({ view: viewKey, id: userTerminals[0].id });
        } else {
          openTerminal();
        }

        return;
      }

      if (action?.id !== "workbench") return;
      event.preventDefault();
      workbenchController.actions.toggleWorkbench({ view: viewKey });
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTab, mac, openTerminal, userTerminals, viewKey, workbenchOpen, workspaceVisible]);

  if (settingsOpen) {
    return (
      <header {...props(titlebarStyles.bar)}>
        <span {...props(titlebarStyles.sidebarSlot)} />
        <div {...props(titlebarStyles.contentArea, tabbed && titlebarStyles.contentAreaTabbed)} />
      </header>
    );
  }

  return (
    <header {...props(titlebarStyles.bar)}>
      <span
        {...props(titlebarStyles.sidebarSlot, !sidebarVisible && titlebarStyles.sidebarSlotHidden)}
      >
        <span {...props(titlebarStyles.actionTrack)}>
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  iconOnly
                  indicator="glyph"
                  aria-label={sidebarVisible ? "Hide sidebar" : "Show sidebar"}
                  pressed={sidebarVisible}
                  aria-keyshortcuts={clientActionAriaShortcut(clientActions.sidebar, mac)}
                  onPressedChange={() => shellActions.toggleSidebar()}
                  title={undefined}
                >
                  <PanelToggleIcon side="left" visible={sidebarVisible} />
                </Toggle>
              }
            />
            <TooltipContent>{`${sidebarVisible ? "Hide Sidebar" : "Show Sidebar"} ${clientActionShortcut(clientActions.sidebar, mac)}`}</TooltipContent>
          </Tooltip>
        </span>
        <span {...props(titlebarStyles.historyControl, titlebarStyles.historyControlBack)}>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  iconOnly
                  icon="arrow-left"
                  aria-label="Go back"
                  disabled={!canGoBack}
                  aria-keyshortcuts={clientActionAriaShortcut(clientActions.back, mac)}
                  onClick={() => {
                    if (tabbed) {
                      windowTabs.dispatch({ kind: "travel", step: -1 });

                      return;
                    }

                    if (stage.kind !== "workspace" && !shellRouter.history.canGoBack()) {
                      shellActions.showWorkspace();

                      return;
                    }

                    shellRouter.history.back();
                  }}
                  title={undefined}
                />
              }
            />
            <TooltipContent>{`Go Back ${clientActionShortcut(clientActions.back, mac)}`}</TooltipContent>
          </Tooltip>
        </span>
        <span {...props(titlebarStyles.historyControl)}>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  iconOnly
                  icon="arrow-right"
                  aria-label="Go forward"
                  aria-keyshortcuts={clientActionAriaShortcut(clientActions.forward, mac)}
                  disabled={tabbed && !canTravel(tabs, 1)}
                  onClick={() =>
                    tabbed
                      ? windowTabs.dispatch({ kind: "travel", step: 1 })
                      : shellRouter.history.forward()
                  }
                  title={undefined}
                />
              }
            />
            <TooltipContent>{`Go Forward ${clientActionShortcut(clientActions.forward, mac)}`}</TooltipContent>
          </Tooltip>
        </span>
      </span>
      <div {...props(titlebarStyles.contentArea, tabbed && titlebarStyles.contentAreaTabbed)}>
        <span {...props(titlebarStyles.center)}>
          {tabbed ? (
            <TitlebarTabStrip state={tabs} mac={mac} />
          ) : (
            <span {...props(titlebarStyles.titleSlot)}>
              {workspaceVisible && selection.kind === "session" && (
                <SessionTitle sessionId={selection.sessionId} />
              )}
            </span>
          )}
          {(workspaceVisible || tabbed) &&
            layout.kind === "single" &&
            !(workbenchOpen && view.maximized) && (
              <span {...props(titlebarStyles.actionTrack)}>
                <Menu>
                  <MenuTrigger render={<Button iconOnly icon="more" aria-label="Chat actions" />} />
                  <MenuContent align="end">
                    <MenuItem
                      icon="split-down"
                      meta={clientActionShortcut(clientActions.splitDown, mac)}
                      disabled={!canSplit || !workspaceVisible}
                      onClick={() => panes.split("down")}
                    >
                      {clientActions.splitDown.label}
                    </MenuItem>
                    <MenuItem
                      icon="split-right"
                      meta={clientActionShortcut(clientActions.splitRight, mac)}
                      disabled={!canSplit || !workspaceVisible}
                      onClick={() => panes.split("right")}
                    >
                      {clientActions.splitRight.label}
                    </MenuItem>
                  </MenuContent>
                </Menu>
              </span>
            )}
        </span>
        {workspaceVisible && (
          <div
            {...props(
              titlebarStyles.workbenchSlot,
              workbenchOpen && titlebarStyles.workbenchSlotOpen,
              workbenchOpen && tabbed && titlebarStyles.workbenchSlotOpenTabbed,
            )}
          >
            {workbenchOpen && (
              <>
                <WorkbenchTabStrip
                  key={viewKey}
                  viewKey={viewKey}
                  view={view}
                  scope={scope}
                  capabilities={capabilities}
                  workspacePath={terminalWorkspacePath}
                />
                <span {...props(titlebarStyles.control)}>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          iconOnly
                          icon={view.maximized ? "minimize" : "expand"}
                          aria-label={
                            view.maximized ? "Restore workbench width" : "Expand workbench"
                          }
                          onClick={() =>
                            workbenchController.actions.toggleMaximized({ view: viewKey })
                          }
                          title={undefined}
                        />
                      }
                    />
                    <TooltipContent>
                      {view.maximized ? "Restore Workbench Width" : "Expand Workbench"}
                    </TooltipContent>
                  </Tooltip>
                </span>
              </>
            )}
            <span {...props(titlebarStyles.control)}>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Toggle
                      iconOnly
                      indicator="glyph"
                      id="workbench-toggle"
                      aria-label={workbenchOpen ? "Close workbench panel" : "Open workbench panel"}
                      pressed={workbenchOpen}
                      aria-keyshortcuts={clientActionAriaShortcut(clientActions.workbench, mac)}
                      onPressedChange={() =>
                        workbenchController.actions.toggleWorkbench({ view: viewKey })
                      }
                      title={undefined}
                    >
                      <PanelToggleIcon side="right" visible={workbenchOpen} />
                    </Toggle>
                  }
                />
                <TooltipContent>{`${workbenchOpen ? "Close Workbench Panel" : "Open Workbench Panel"} ${clientActionShortcut(clientActions.workbench, mac)}`}</TooltipContent>
              </Tooltip>
            </span>
          </div>
        )}
      </div>
    </header>
  );
}
