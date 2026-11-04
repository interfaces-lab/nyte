import { useSettingsOpen } from "../tabs/use-settings-open.ts";
import { titlebarStyles } from "./titlebar.stylex.ts";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { props } from "@stylexjs/stylex";
import { createLink } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactElement } from "react";
import type { SessionId } from "@nyte-ai/sdk";
import { ConfirmDialog } from "@nyte-ai/ui/alert-dialog";
import { PanelToggleIcon } from "@nyte-ai/ui/icon";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@nyte-ai/ui/menu";
import { Button, ButtonLink } from "@nyte-ai/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import { Toggle } from "@nyte-ai/ui/toggle";
import {
  hideFromPanes,
  useCanSplitPane,
  usePaneActions,
  usePaneControllerSnapshot,
} from "../panes/pane-context.tsx";
import { activePane } from "../panes/pane-layout.ts";
import { nyte } from "../contract/nyte.ts";
import { chatDirectory, chatTitle, useChat } from "../chats/index.ts";
import { useHostState } from "../data/host.ts";
import { sessionActions } from "../data/session-rows.ts";
import { useWorkbenchView, workbench } from "../workbench/store.ts";
import { attachSidebarWidth, shellActions, useStagePage } from "../tabs/shell-state.ts";
import { attachActiveWorkbenchWidth } from "../workbench/width.ts";
import { sessionIsRunning } from "../sidebar/sidebar-view.ts";
import { chatWindow } from "../window/index.ts";
import { useSidebar } from "../sidebar/use-sidebar.ts";
import {
  clientActionAriaShortcut,
  clientActionShortcut,
  clientActions,
  clientCapabilities,
} from "../contract/client-actions.ts";

import { WorkbenchTabStrip } from "../workbench/tab-strip.tsx";
import type { WindowState } from "../tabs/model.ts";
import { useWindowTabItems, useWindowTabsState } from "../tabs/use-window-tabs.tsx";
import { WindowTabStrip } from "../tabs/window-tab-strip.tsx";
import { windowTabs } from "../tabs/window-tabs.ts";

const SessionLink = createLink(ButtonLink);

function ParentLink({ parent }: { readonly parent: SessionId }): ReactElement {
  return (
    <SessionLink
      iconOnly
      icon="arrow-left"
      aria-label="Back to parent chat"
      to="/session/$sessionId"
      params={{ sessionId: parent }}
      preload={false}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        windowTabs.openChat(parent, "preview");
      }}
    />
  );
}

function SessionTitle({ sessionId }: { sessionId: SessionId }): ReactElement {
  const chat = useChat(sessionId);
  const parentSessionId = chat.kind === "ready" ? (chat.chat.parent ?? undefined) : undefined;
  const title = chatTitle(chat.kind === "ready" ? chat.chat : undefined);

  return (
    <span {...props(titlebarStyles.sessionTitleGroup)}>
      {parentSessionId !== undefined && (
        <span {...props(titlebarStyles.sessionBack)}>
          <ParentLink parent={parentSessionId} />
        </span>
      )}
      <span title={title} {...props(text.sm, titlebarStyles.sessionTitle)}>
        {title}
      </span>
    </span>
  );
}

type TabChatConfirmation =
  | { readonly kind: "closed" }
  | { readonly kind: "delete"; readonly sessionId: SessionId }
  | { readonly kind: "archive-working"; readonly sessionId: SessionId };

function TitlebarTabStrip({ state, mac }: { state: WindowState; mac: boolean }): ReactElement {
  const [confirmation, setConfirmation] = useState<TabChatConfirmation>({ kind: "closed" });
  const closeConfirmation = (): void => setConfirmation({ kind: "closed" });

  return (
    <>
      <WindowTabStrip
        tabs={useWindowTabItems(state)}
        activeTabId={state.activeTabId}
        mac={mac}
        onActivate={(tabId) => windowTabs.dispatch({ kind: "activate-tab", tabId })}
        onClose={(tabId) => windowTabs.dispatch({ kind: "close-tab", tabId })}
        onKeep={(tabId) => windowTabs.dispatch({ kind: "keep-tab", tabId })}
        onOpenParent={(parent) => windowTabs.openChat(parent, "permanent")}
        onNewTab={() => windowTabs.dispatch({ kind: "new-tab" })}
        onReorder={(tabIds, tabId) => windowTabs.dispatch({ kind: "reorder", tabIds, tabId })}
        onCloseOthers={(tabId) => windowTabs.dispatch({ kind: "close-others", tabId })}
        onCloseToRight={(tabId) => windowTabs.dispatch({ kind: "close-right", tabId })}
        chat={{
          rename: (sessionId, name) => void sessionActions.rename({ sessionId, name }),
          pin: (session) => sessionActions.pin({ sessionId: session.id, pinned: !session.pinned }),
          markRead: (sessionId) => chatWindow.markRead([sessionId]),
          openBeside: (sessionId) => {
            shellActions.showWorkspace();
            const controller = windowTabs.controller();
            controller.drop(sessionId, activePane(controller.getSnapshot().layout).id, "right");
          },
          archive: (session) => {
            if (!session.archived && sessionIsRunning(session, chatDirectory())) {
              setConfirmation({ kind: "archive-working", sessionId: session.id });

              return;
            }

            sessionActions.archive([session.id], !session.archived, hideFromPanes);
          },
          remove: (sessionId) => setConfirmation({ kind: "delete", sessionId }),
        }}
      />
      {confirmation.kind === "delete" && (
        <ConfirmDialog
          open
          title="Delete Chat"
          confirmLabel="Delete Chat"
          description="The chat disappears now. Undo from the notification before it closes."
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
          title="Archive Working Chat"
          description="It keeps working in the archive. Restore it from the Archived filter."
          confirmLabel="Archive Chat"
          onOpenChange={(nextOpen) => {
            if (!nextOpen) closeConfirmation();
          }}
          onConfirm={() => {
            closeConfirmation();
            sessionActions.archive([confirmation.sessionId], true, hideFromPanes);
          }}
        />
      )}
    </>
  );
}

export function Titlebar(): ReactElement {
  const host = useHostState();
  const { layout } = usePaneControllerSnapshot();
  const panes = usePaneActions();
  const canSplit = useCanSplitPane();
  const sidebarControl = useSidebar();
  const sidebarVisible = sidebarControl.open;
  const page = useStagePage();
  const mac = nyte.platform === "darwin";
  const capabilities = clientCapabilities(nyte.host);
  const selection = activePane(layout).selection;
  const workspacePath = host.data.workspace?.path;
  const workbenchView = useWorkbenchView(workspacePath);
  const viewKey = workbenchView.key;
  const view = workbenchView.view;
  const scope = workbenchView.scope;

  const settingsOpen = useSettingsOpen();

  const workspaceVisible = !settingsOpen && page === undefined;
  const workbenchOpen = workspaceVisible && view.expanded;
  const maximized = view.layout.kind === "maximized";
  const strip = windowTabs.strip;
  const tabs = useWindowTabsState();

  const sidebarSlot = (
    <span
      ref={attachSidebarWidth}
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
                onPressedChange={sidebarControl.toggleSidebar}
                title={undefined}
              >
                <PanelToggleIcon side="left" visible={sidebarVisible} />
              </Toggle>
            }
          />
          <TooltipContent>{`${sidebarVisible ? "Hide Sidebar" : "Show Sidebar"} ${clientActionShortcut(clientActions.sidebar, mac)}`}</TooltipContent>
        </Tooltip>
      </span>
    </span>
  );

  if (settingsOpen) {
    return (
      <header {...props(titlebarStyles.bar)}>
        {sidebarSlot}
        <div {...props(titlebarStyles.contentArea, strip && titlebarStyles.contentAreaTabbed)} />
      </header>
    );
  }

  return (
    <header {...props(titlebarStyles.bar)}>
      {sidebarSlot}
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
            ref={attachActiveWorkbenchWidth}
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
                          onClick={() => workbench.dispatch(viewKey, { kind: "toggle-maximized" })}
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
                      onPressedChange={() => workbench.dispatch(viewKey, { kind: "toggle" })}
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
