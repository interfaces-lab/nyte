import { useSettingsOpen } from "../tabs/use-settings-open.ts";
import { titlebarStyles } from "./titlebar.stylex.ts";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { props } from "@stylexjs/stylex";
import { createLink } from "@tanstack/react-router";
import { useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import type { SessionId } from "@nyte-ai/sdk";
import { ConfirmDialog } from "@nyte-ai/ui/alert-dialog";
import { PanelToggleIcon, SplitPreviewIcon } from "@nyte-ai/ui/icon";
import type { IconName, SplitSide } from "@nyte-ai/ui/icon";
import { Button, ButtonLink } from "@nyte-ai/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import { Toggle } from "@nyte-ai/ui/toggle";
import { ToggleGroup } from "@nyte-ai/ui/toggle-group";
import { switchApp } from "../commands/apps.ts";
import type { DesktopApp } from "../contract/desktop-app.ts";
import { DESKTOP_APP_LABELS } from "../contract/desktop-window.ts";
import { useCanSplitPane, usePaneActions, usePaneLayout } from "../panes/pane-context.tsx";
import { hideFromPanes } from "../tabs/window-panes.tsx";
import { activeSelection, chatPanes, sameSelection } from "../panes/pane-layout.ts";
import { nyte, offeredApps, windowApp } from "../contract/nyte.ts";
import { chatDirectory, chatTitle, useChat } from "../chats/index.ts";
import { useHostState } from "../data/host.ts";
import { sessionActions } from "../data/session-rows.ts";
import { useWorkbenchView, workbench } from "../workbench/store.ts";
import { EDITOR_SLOT, tabSlot, workbenchNarrow, workbenchShowsChat } from "../workbench/model.ts";
import { shownWorkbenchTab } from "../workbench/selectors.ts";
import { toggleExplorer } from "../commands/launch.ts";
import { ChatHistory } from "./chat-history.tsx";
import { attachSidebarWidth, shellActions, useStagePage } from "../tabs/shell-state.ts";
import { attachActiveWorkbenchWidth } from "../workbench/width.ts";
import { sessionIsRunning } from "../sidebar/sidebar-view.ts";
import { chatWindow } from "../window/index.ts";
import { useSidebar } from "../sidebar/use-sidebar.ts";
import {
  clientActionAriaShortcut,
  clientActionKeys,
  clientActions,
  clientCapabilities,
} from "../contract/client-actions.ts";
import { NeedsYou } from "./needs-you.tsx";

import { WorkbenchTabStrip } from "./workbench-tab-strip.tsx";
import type { WindowState } from "../tabs/model.ts";
import { useWindowTabItems, useWindowTabsState } from "../tabs/use-window-tabs.tsx";
import { WindowTabStrip } from "./window-tab-strip.tsx";
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
            windowTabs.dispatch({ kind: "open-beside", sessionId });
          },
          archive: (session) => {
            if (!session.archived && sessionIsRunning(session, chatDirectory())) {
              setConfirmation({ kind: "archive-working", sessionId: session.id });

              return;
            }

            sessionActions.archive([session.id], !session.archived);
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
            sessionActions.archive([confirmation.sessionId], true);
          }}
        />
      )}
    </>
  );
}

export function Titlebar(): ReactElement {
  const host = useHostState();
  const panes = usePaneActions();
  const canSplit = useCanSplitPane();
  const sidebarControl = useSidebar();
  const sidebarVisible = sidebarControl.open;
  const page = useStagePage();
  const mac = nyte.platform === "darwin";
  const capabilities = clientCapabilities(nyte.host);
  const selection = usePaneLayout(activeSelection, sameSelection);
  const onePane = usePaneLayout((layout) => chatPanes(layout).length === 1);
  const workspacePath = host.data.workspace?.path;
  const workbenchView = useWorkbenchView(workspacePath);
  const viewKey = workbenchView.key;
  const view = workbenchView.view;
  const scope = workbenchView.scope;

  const settingsOpen = useSettingsOpen();

  const workspaceVisible = !settingsOpen && page === undefined;
  const workbenchOpen = workspaceVisible && view.expanded;
  const maximized = view.layout.kind === "maximized";
  const workbenchCovers = workbenchOpen && maximized;
  const strip = windowTabs.strip;
  const tabs = useWindowTabsState();
  const focused = useSyncExternalStore(watchWindowFocus, () => document.hasFocus());
  const code = windowApp() === "code";
  const shownTab = shownWorkbenchTab(view, scope, capabilities);

  const explorerOpen =
    shownTab !== null && tabSlot(shownTab) === EDITOR_SLOT && view.sidebars.includes(EDITOR_SLOT);

  const leftOpen = code ? explorerOpen : sidebarVisible;
  const leftLabel = code ? "Explorer" : "Sidebar";

  const sidebarSlot = (
    <span
      ref={attachSidebarWidth}
      {...props(
        titlebarStyles.sidebarSlot,
        (code || !sidebarVisible) && titlebarStyles.sidebarSlotHidden,
      )}
    >
      <span {...props(titlebarStyles.actionTrack)}>
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                iconOnly
                indicator="glyph"
                aria-label={`${leftOpen ? "Hide" : "Show"} ${leftLabel.toLowerCase()}`}
                pressed={leftOpen}
                aria-keyshortcuts={clientActionAriaShortcut(clientActions.sidebar, mac)}
                onPressedChange={
                  code ? () => toggleExplorer(viewKey) : sidebarControl.toggleSidebar
                }
                title={undefined}
              >
                <PanelToggleIcon side="left" visible={leftOpen} />
              </Toggle>
            }
          />
          <TooltipContent shortcut={clientActionKeys(clientActions.sidebar, mac)}>
            {`${leftOpen ? "Hide" : "Show"} ${leftLabel}`}
          </TooltipContent>
        </Tooltip>
      </span>
      {nyte.host.switchApp !== undefined && (
        <span
          {...props(
            titlebarStyles.appSlot,
            sidebarVisible && !code && titlebarStyles.appSlotDocked,
          )}
        >
          <AppSwitcher mac={mac} />
        </span>
      )}
    </span>
  );

  const trailing = (
    <>
      {(workspaceVisible || (strip && !settingsOpen)) && onePane && !workbenchCovers && (
        <span role="group" aria-label="Split Chat" {...props(titlebarStyles.splitGroup)}>
          {(["right", "down"] as const).map((side) => (
            <SplitChatButton
              key={side}
              side={side}
              mac={mac}
              disabled={!canSplit || !workspaceVisible}
              onSplit={() => panes.split(side)}
            />
          ))}
        </span>
      )}
      {workbenchOpen && !workbenchNarrow(view.layout) && (
        <span {...props(titlebarStyles.control)}>
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  iconOnly
                  indicator="glyph"
                  icon={maximized ? "minimize" : "expand"}
                  aria-label={maximized ? "Restore split view" : "Expand workbench"}
                  pressed={!maximized}
                  onPressedChange={() => workbench.dispatch(viewKey, { kind: "toggle-maximized" })}
                  title={undefined}
                />
              }
            />
            <TooltipContent>{maximized ? "Restore Split View" : "Expand Workbench"}</TooltipContent>
          </Tooltip>
        </span>
      )}
      {workspaceVisible && (
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
            <TooltipContent shortcut={clientActionKeys(clientActions.workbench, mac)}>
              {workbenchOpen ? "Close Workbench Panel" : "Open Workbench Panel"}
            </TooltipContent>
          </Tooltip>
        </span>
      )}
      <span {...props(titlebarStyles.control)}>
        <NeedsYou />
      </span>
    </>
  );

  if (code) {
    const chatOpen = view.layout.kind === "split" || workbenchShowsChat(view.layout);

    return (
      <header {...props(titlebarStyles.bar, !focused && titlebarStyles.windowInactive)}>
        {sidebarSlot}
        <div {...props(titlebarStyles.contentArea)}>
          <span {...props(titlebarStyles.center)}>
            {workspaceVisible && (
              <WorkbenchTabStrip
                key={viewKey}
                viewKey={viewKey}
                view={view}
                scope={scope}
                capabilities={capabilities}
                sessionId={selection.kind === "session" ? selection.sessionId : undefined}
              />
            )}
          </span>
          <span {...props(titlebarStyles.trailing)}>
            {workspaceVisible && (
              <>
                <span {...props(titlebarStyles.control)}>
                  <ChatHistory mac={mac} />
                </span>
                <span {...props(titlebarStyles.control)}>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Toggle
                          iconOnly
                          indicator="glyph"
                          id="workbench-toggle"
                          aria-label={chatOpen ? "Hide chat" : "Show chat"}
                          pressed={chatOpen}
                          aria-keyshortcuts={clientActionAriaShortcut(clientActions.workbench, mac)}
                          onPressedChange={() =>
                            workbench.dispatch(viewKey, { kind: "toggle-maximized" })
                          }
                          title={undefined}
                        >
                          <PanelToggleIcon side="right" visible={chatOpen} />
                        </Toggle>
                      }
                    />
                    <TooltipContent shortcut={clientActionKeys(clientActions.workbench, mac)}>
                      {chatOpen ? "Hide Chat" : "Show Chat"}
                    </TooltipContent>
                  </Tooltip>
                </span>
              </>
            )}
            <span {...props(titlebarStyles.control)}>
              <NeedsYou />
            </span>
          </span>
        </div>
      </header>
    );
  }

  return (
    <header {...props(titlebarStyles.bar, !focused && titlebarStyles.windowInactive)}>
      {sidebarSlot}
      <div {...props(titlebarStyles.contentArea, strip && titlebarStyles.contentAreaTabbed)}>
        <span {...props(titlebarStyles.center)}>
          {settingsOpen ? null : strip ? (
            <TitlebarTabStrip state={tabs} mac={mac} />
          ) : (
            <span {...props(titlebarStyles.titleSlot)}>
              {workspaceVisible && selection.kind === "session" && (
                <SessionTitle sessionId={selection.sessionId} />
              )}
            </span>
          )}
        </span>
        {!workspaceVisible && <span {...props(titlebarStyles.trailing)}>{trailing}</span>}
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
              <WorkbenchTabStrip
                key={viewKey}
                viewKey={viewKey}
                view={view}
                scope={scope}
                capabilities={capabilities}
                sessionId={selection.kind === "session" ? selection.sessionId : undefined}
              />
            )}
            {trailing}
          </div>
        )}
      </div>
    </header>
  );
}

const APP_ICONS = {
  nyte: "moon",
  code: "code-brackets",
  studio: "bezier-pointer",
} as const satisfies Record<DesktopApp, IconName>;

const APP_ACTIONS = {
  nyte: clientActions.openNyte,
  code: clientActions.openCode,
  studio: clientActions.openStudio,
} as const satisfies Record<DesktopApp, (typeof clientActions)[keyof typeof clientActions]>;

function watchWindowFocus(notice: () => void): () => void {
  window.addEventListener("focus", notice);
  window.addEventListener("blur", notice);

  return () => {
    window.removeEventListener("focus", notice);
    window.removeEventListener("blur", notice);
  };
}

function AppSwitcher(input: { readonly mac: boolean }): ReactElement {
  return (
    <span {...props(titlebarStyles.control)}>
      <ToggleGroup
        aria-label="Apps"
        value={[windowApp()]}
        onValueChange={(value) => {
          const next = offeredApps().find((app) => app === value[0]);

          if (next !== undefined) switchApp(next);
        }}
      >
        {offeredApps().map((app) => (
          <Tooltip key={app}>
            <TooltipTrigger
              render={
                <Toggle
                  value={app}
                  iconOnly
                  size="sm"
                  icon={APP_ICONS[app]}
                  aria-label={DESKTOP_APP_LABELS[app]}
                  aria-keyshortcuts={clientActionAriaShortcut(APP_ACTIONS[app], input.mac)}
                  title={undefined}
                />
              }
            />
            <TooltipContent shortcut={clientActionKeys(APP_ACTIONS[app], input.mac)}>
              {DESKTOP_APP_LABELS[app]}
            </TooltipContent>
          </Tooltip>
        ))}
      </ToggleGroup>
    </span>
  );
}

const SPLIT_ACTIONS = {
  right: clientActions.splitRight,
  down: clientActions.splitDown,
} as const;

function SplitChatButton({
  side,
  mac,
  disabled,
  onSplit,
}: {
  readonly side: SplitSide;
  readonly mac: boolean;
  readonly disabled: boolean;
  readonly onSplit: () => void;
}): ReactElement {
  const action = SPLIT_ACTIONS[side];

  return (
    <span {...props(titlebarStyles.actionTrack)}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              iconOnly
              aria-label={action.label}
              aria-keyshortcuts={clientActionAriaShortcut(action, mac)}
              disabled={disabled}
              onClick={onSplit}
              title={undefined}
            >
              <SplitPreviewIcon side={side} />
            </Button>
          }
        />
        <TooltipContent shortcut={clientActionKeys(action, mac)}>{action.label}</TooltipContent>
      </Tooltip>
    </span>
  );
}
