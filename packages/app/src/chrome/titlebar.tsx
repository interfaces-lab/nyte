import { titlebarStyles } from "./titlebar.stylex.ts";
/**
 * Permanent window chrome. The sidebar toggle stays on the rail side; chat
 * actions and the stage-level workbench entry stay at the trailing edge.
 */
import { props } from "@stylexjs/stylex";
import { useMatch, useRouter } from "@tanstack/react-router";
// oxlint-disable-next-line no-restricted-imports -- menu commands and shortcuts act on the current workspace state
import { useCallback, useEffect } from "react";
import type { ReactElement } from "react";
import type { SessionId } from "@nyte-ai/protocol";
import { Icon, PanelToggleIcon } from "@nyte-ai/ui/icon";
import { Menu, MenuItem } from "@nyte-ai/ui/menu";
import { Button } from "@nyte-ai/ui/button";
import { Hint } from "@nyte-ai/ui/tooltip";
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

function SessionTitle({ sessionId }: { sessionId: SessionId }): ReactElement {
  const session = useSession(sessionId);
  const panes = usePaneActions();
  const parentSessionId = session.data?.parent?.sessionId;
  const title = session.data?.name ?? session.data?.preview ?? "New chat";

  return (
    <span {...props(titlebarStyles.sessionTitleGroup)}>
      {parentSessionId !== undefined && (
        <span {...props(titlebarStyles.sessionBack)}>
          <Button
            iconOnly
            icon="arrow-left"
            aria-label="Back to parent chat"
            onClick={() => panes.openSession(parentSessionId)}
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
  const nativeMac = nyte.clientSurface === "desktop" && mac;
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
  const workbenchOpen = workspaceVisible && view.expanded && activeTab !== null;
  const canGoBack = stage.kind !== "workspace" || settingsOpen || shellRouter.history.canGoBack();
  const historyIndex = shellRouter.history.location.state.__TSR_index;
  const canGoForward = historyIndex < shellRouter.history.length - 1;

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
      if (settingsOpen) shellRouter.history.back();
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
          panes.newChat();

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
          workbenchController.actions.toggle({ view: viewKey, scope });
        } else if (action.id === "terminal" && userTerminals[0] !== undefined) {
          workbenchController.actions.activateTab({ view: viewKey, id: userTerminals[0].id });
        } else {
          openTerminal();
        }

        return;
      }

      if (action?.id !== "workbench") return;
      event.preventDefault();
      workbenchController.actions.toggleWorkbench({ view: viewKey, scope });
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activeTab,
    mac,
    openTerminal,
    scope,
    userTerminals,
    viewKey,
    workbenchOpen,
    workspaceVisible,
  ]);

  if (settingsOpen) {
    return (
      <header {...props(titlebarStyles.bar, nativeMac && titlebarStyles.barMac)}>
        <span aria-hidden="true" {...props(titlebarStyles.contentFill)} />
      </header>
    );
  }

  return (
    <header {...props(titlebarStyles.bar, nativeMac && titlebarStyles.barMac)}>
      <span
        aria-hidden="true"
        {...props(
          titlebarStyles.contentFill,
          !sidebarVisible && titlebarStyles.contentFillSidebarHidden,
        )}
      />
      <span {...props(titlebarStyles.actionTrack)}>
        <Hint
          content={`${sidebarVisible ? "Hide Sidebar" : "Show Sidebar"} ${clientActionShortcut(clientActions.sidebar, mac)}`}
          trigger={
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
      </span>
      {sidebarVisible && (
        <span {...props(titlebarStyles.navigationTrack)}>
          <Hint
            content={`Go Back ${clientActionShortcut(clientActions.back, mac)}`}
            trigger={
              <Button
                iconOnly
                icon="arrow-left"
                aria-label="Go back"
                disabled={!canGoBack}
                aria-keyshortcuts={clientActionAriaShortcut(clientActions.back, mac)}
                onClick={() => {
                  if (stage.kind !== "workspace") {
                    shellActions.showWorkspace();

                    return;
                  }

                  shellRouter.history.back();
                }}
                title={undefined}
              />
            }
          />
          <Hint
            content={`Go Forward ${clientActionShortcut(clientActions.forward, mac)}`}
            trigger={
              <Button
                iconOnly
                icon="arrow-right"
                aria-label="Go forward"
                disabled={!canGoForward}
                aria-keyshortcuts={clientActionAriaShortcut(clientActions.forward, mac)}
                onClick={() => {
                  shellActions.showWorkspace();
                  shellRouter.history.forward();
                }}
                title={undefined}
              />
            }
          />
        </span>
      )}
      {workspaceVisible && selection.kind === "session" && (
        <span
          {...props(
            titlebarStyles.titleSlot,
            workbenchOpen && titlebarStyles.titleSlotWorkbenchOpen,
            !sidebarVisible &&
              (nativeMac
                ? titlebarStyles.titleSlotSidebarHiddenMac
                : titlebarStyles.titleSlotSidebarHidden),
          )}
        >
          <SessionTitle sessionId={selection.sessionId} />
        </span>
      )}
      <span {...props(titlebarStyles.spacer)} />
      {workspaceVisible && layout.kind === "single" && !(workbenchOpen && view.maximized) && (
        <span {...props(titlebarStyles.actionTrack)}>
          <Menu
            label="Chat actions"
            align="end"
            trigger={<Button iconOnly icon="more" aria-label="Chat actions" />}
          >
            <MenuItem
              icon="split-down"
              meta={clientActionShortcut(clientActions.splitDown, mac)}
              disabled={!canSplit}
              onSelect={() => panes.split("down")}
            >
              {clientActions.splitDown.label}
            </MenuItem>
            <MenuItem
              icon="split-right"
              meta={clientActionShortcut(clientActions.splitRight, mac)}
              disabled={!canSplit}
              onSelect={() => panes.split("right")}
            >
              {clientActions.splitRight.label}
            </MenuItem>
          </Menu>
        </span>
      )}
      {workbenchOpen && <span aria-hidden="true" {...props(titlebarStyles.workbenchReservation)} />}
      {workspaceVisible && (
        <div
          {...props(
            workbenchOpen ? titlebarStyles.workbenchTrack : titlebarStyles.actionTrack,
            workbenchOpen &&
              !sidebarVisible &&
              (nativeMac
                ? titlebarStyles.workbenchTrackSidebarHiddenMac
                : titlebarStyles.workbenchTrackSidebarHidden),
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
              <Hint
                content={view.maximized ? "Restore Workbench Width" : "Expand Workbench"}
                trigger={
                  <Toggle
                    iconOnly
                    icon={view.maximized ? "minimize" : "expand"}
                    aria-label={view.maximized ? "Restore workbench width" : "Expand workbench"}
                    pressed={view.maximized}
                    onPressedChange={() =>
                      workbenchController.actions.toggleMaximized({ view: viewKey })
                    }
                    title={undefined}
                  />
                }
              />
            </>
          )}
          <Hint
            content={`${workbenchOpen ? "Close Workbench Panel" : "Open Workbench Panel"} ${clientActionShortcut(clientActions.workbench, mac)}`}
            trigger={
              <Toggle
                iconOnly
                indicator="glyph"
                id="workbench-toggle"
                aria-label={workbenchOpen ? "Close workbench panel" : "Open workbench panel"}
                pressed={workbenchOpen}
                aria-keyshortcuts={clientActionAriaShortcut(clientActions.workbench, mac)}
                onPressedChange={() =>
                  workbenchController.actions.toggleWorkbench({ view: viewKey, scope })
                }
                title={undefined}
              >
                <PanelToggleIcon side="right" visible={workbenchOpen} />
              </Toggle>
            }
          />
        </div>
      )}
    </header>
  );
}
