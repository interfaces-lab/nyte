/**
 * Permanent window chrome. The sidebar toggle stays on the rail side; chat
 * actions and the stage-level workbench entry stay at the trailing edge.
 */
import { titlebarStyles } from "./titlebar.stylex.ts";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { props } from "@stylexjs/stylex";
import { createLink, useMatch } from "@tanstack/react-router";
import type { ReactElement } from "react";
import type { SessionId } from "@nyte-ai/sdk";
import { PanelToggleIcon } from "@nyte-ai/ui/icon";
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
import { useHostState, useSession, useWorkspaces } from "../queries.ts";
import {
  workbenchController,
  workbenchScope,
  workbenchViewKey,
  useWorkbenchSnapshot,
} from "../workbench/controller.ts";
import { shellActions, useStagePage } from "./shell-state.ts";
import { preferences, useSetting } from "../preferences/index.ts";
import {
  clientActionAriaShortcut,
  clientActionShortcut,
  clientActions,
  clientCapabilities,
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
  const session = useSession(sessionId);
  const workspaces = useWorkspaces();
  const workspace = workspaces.data?.find((candidate) => candidate.id === session.data?.workspace);

  if (workspace === undefined) return null;

  return (
    <>
      <span title={workspace.path} {...props(text.sm, titlebarStyles.sessionCrumb)}>
        {workspace.name}
      </span>
      <span {...props(text.sm, titlebarStyles.sessionCrumbDivider)}>/</span>
    </>
  );
}

const SessionLink = createLink(ButtonLink);

function SessionTitle({ sessionId }: { sessionId: SessionId }): ReactElement {
  const session = useSession(sessionId);
  const panes = usePaneActions();
  const parentSessionId = session.data?.parent ?? undefined;
  const title = session.data?.name ?? "New chat";

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
            preload={false}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              panes.openSession(parentSessionId);
            }}
          />
        </span>
      )}
      <SessionLocation sessionId={sessionId} />
      <span title={title} {...props(text.sm, titlebarStyles.sessionTitle)}>
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
      onDuplicate={(tabId) => windowTabs.dispatch({ kind: "duplicate-tab", tabId })}
      onCloseOthers={(tabId) => windowTabs.dispatch({ kind: "close-others", tabId })}
      onCloseToRight={(tabId) => windowTabs.dispatch({ kind: "close-right", tabId })}
    />
  );
}

export function Titlebar(): ReactElement {
  const host = useHostState();
  const { layout } = usePaneControllerSnapshot();
  const panes = usePaneActions();
  const canSplit = useCanSplitPane();
  const workbench = useWorkbenchSnapshot();
  const sidebarVisible = useSetting(preferences.sidebarVisible);
  const page = useStagePage();
  const mac = macPlatform(nyte.platform);
  const capabilities = clientCapabilities(nyte.host);
  const selection = activePane(layout).selection;
  const workspacePath = host.data?.workspace?.path;
  const viewKey = workbenchViewKey(workspacePath);
  const view = workbench.views.get(viewKey) ?? workbenchController.getView(viewKey);

  const terminalWorkspacePath = workspacePath ?? null;
  const scope = workbenchScope(workspacePath);
  const settingsMatch = useMatch({ from: "/settings/$section", shouldThrow: false });
  const settingsOpen = settingsMatch !== undefined;
  const workspaceVisible = !settingsOpen && page === undefined;
  const workbenchOpen = workspaceVisible && view.expanded;
  const maximized = view.layout.kind === "maximized";
  const strip = windowTabs.strip;
  const tabs = useWindowTabsState();

  if (settingsOpen) {
    return (
      <header {...props(titlebarStyles.bar)}>
        <span {...props(titlebarStyles.sidebarSlot)} />
        <div {...props(titlebarStyles.contentArea, strip && titlebarStyles.contentAreaTabbed)} />
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
                  disabled={!canTravel(tabs, -1)}
                  aria-keyshortcuts={clientActionAriaShortcut(clientActions.back, mac)}
                  onClick={() => windowTabs.dispatch({ kind: "travel", step: -1 })}
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
                  disabled={!canTravel(tabs, 1)}
                  onClick={() => windowTabs.dispatch({ kind: "travel", step: 1 })}
                  title={undefined}
                />
              }
            />
            <TooltipContent>{`Go Forward ${clientActionShortcut(clientActions.forward, mac)}`}</TooltipContent>
          </Tooltip>
        </span>
      </span>
      <div {...props(titlebarStyles.contentArea, strip && titlebarStyles.contentAreaTabbed)}>
        <span {...props(titlebarStyles.center, !workspaceVisible && titlebarStyles.centerTrailing)}>
          {strip ? (
            <TitlebarTabStrip state={tabs} mac={mac} />
          ) : (
            <span {...props(titlebarStyles.titleSlot)}>
              {workspaceVisible && selection.kind === "session" && (
                <SessionTitle sessionId={selection.sessionId} />
              )}
            </span>
          )}
          {(workspaceVisible || strip) &&
            layout.kind === "single" &&
            !(workbenchOpen && maximized) && (
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
              workbenchOpen && strip && titlebarStyles.workbenchSlotOpenTabbed,
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
                  sessionId={selection.kind === "session" ? selection.sessionId : undefined}
                />
                <span {...props(titlebarStyles.control)}>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          iconOnly
                          icon={maximized ? "minimize" : "expand"}
                          aria-label={maximized ? "Restore split view" : "Expand workbench"}
                          onClick={() =>
                            workbenchController.actions.toggleMaximized({ view: viewKey })
                          }
                          title={undefined}
                        />
                      }
                    />
                    <TooltipContent>
                      {maximized ? "Restore Split View" : "Expand Workbench"}
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
