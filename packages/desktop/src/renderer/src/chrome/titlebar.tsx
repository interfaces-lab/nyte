import { titlebarStyles } from "./titlebar.stylex.ts";
/**
 * Permanent window chrome. The sidebar toggle stays on the rail side; chat
 * actions and the stage-level workbench entry stay at the trailing edge.
 */
import * as stylex from "@stylexjs/stylex";
import { useMatch, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import type { ReactElement } from "react";
import type { SessionId } from "@nyte-ai/protocol";
import { PanelToggleIcon } from "../components/icons.tsx";
import { Menu, MenuItem } from "../components/menu.tsx";
import { HintIconButton, HintToggleIconButton, IconButton } from "../components/ui.tsx";
import {
  useCanSplitPane,
  usePaneActions,
  usePaneControllerSnapshot,
} from "../layout/pane-context.tsx";
import { activePane } from "../layout/pane-layout.ts";
import { macPlatform } from "../platform.ts";
import { useHostState, useSession } from "../queries.ts";
import {
  WORKBENCH_STAGE_PANE_KEY,
  activeWorkbenchTab,
  workbenchScopeForTarget,
  workbenchController,
  workbenchViewKey,
  useWorkbenchSnapshot,
} from "../workbench/controller.ts";
import type { WorkbenchTarget } from "../workbench/controller.ts";
import { terminalActions } from "../workbench/terminal-store.ts";
import { shellActions, useShellState } from "./shell-state.ts";
import {
  clientActionAriaShortcut,
  clientActionShortcut,
  clientActions,
  resolveClientAction,
} from "../../../shared/client-actions.ts";

import { WorkbenchTabStrip } from "../workbench/tab-strip.tsx";

function SessionTitle({ sessionId }: { sessionId: SessionId }): ReactElement {
  const session = useSession(sessionId);
  const panes = usePaneActions();
  const parentSessionId = session.data?.parent?.sessionId;
  const title = session.data?.name ?? session.data?.preview ?? "New chat";
  return (
    <span {...stylex.props(titlebarStyles.sessionTitleGroup)}>
      {parentSessionId !== undefined && (
        <span {...stylex.props(titlebarStyles.sessionBack)}>
          <IconButton
            icon="arrow-left"
            label="Back to parent chat"
            onClick={() => panes.openSession(parentSessionId)}
          />
        </span>
      )}
      <span title={title} {...stylex.props(titlebarStyles.sessionTitle)}>
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
  const selection = activePane(layout).selection;
  const workspacePath = host.data?.workspace?.path;
  const target: WorkbenchTarget =
    selection.kind === "session"
      ? { kind: "session", sessionId: selection.sessionId }
      : workspacePath === undefined
        ? { kind: "home" }
        : { kind: "workspace", workspacePath };
  const viewKey = workbenchViewKey({ paneKey: WORKBENCH_STAGE_PANE_KEY, target });
  const view = workbench.views.get(viewKey) ?? workbenchController.getView(viewKey);
  const userTerminals = view.tabs.filter(
    (tab) => tab.kind === "terminal" && tab.owner.kind === "user",
  );
  const terminalWorkspacePath = target.kind === "home" ? null : (workspacePath ?? null);
  const scope = workbenchScopeForTarget(target, workspacePath);
  const activeTab = activeWorkbenchTab(view, scope);
  const settingsMatch = useMatch({ from: "/settings/$section", shouldThrow: false });
  const settingsOpen = settingsMatch !== undefined;
  const workspaceVisible = !settingsOpen && stage.kind === "workspace";
  const workbenchOpen = workspaceVisible && view.expanded && activeTab !== null;
  const canGoBack = stage.kind === "customize" || settingsOpen || shellRouter.history.canGoBack();
  const historyIndex = shellRouter.history.location.state.__TSR_index;
  const canGoForward = historyIndex < shellRouter.history.length - 1;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!workspaceVisible) return;
      const action = resolveClientAction(event, mac, "workspace");
      if (action?.id === "terminal" || action?.id === "new-terminal") {
        event.preventDefault();
        if (action.id === "terminal" && workbenchOpen && activeTab?.kind === "terminal") {
          workbenchController.actions.toggle({ view: viewKey });
        } else if (action.id === "terminal" && userTerminals[0] !== undefined) {
          workbenchController.actions.activateTab({ view: viewKey, id: userTerminals[0].id });
        } else {
          const id = workbenchController.actions.openTab({
            view: viewKey,
            tab: { kind: "terminal", owner: { kind: "user" } },
            activate: true,
          });
          void terminalActions.create({ id, workspacePath: terminalWorkspacePath });
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
    mac,
    workspaceVisible,
    viewKey,
    workbenchOpen,
    activeTab,
    userTerminals,
    terminalWorkspacePath,
    scope,
  ]);

  if (settingsOpen) {
    return (
      <header {...stylex.props(titlebarStyles.bar, mac && titlebarStyles.barMac)}>
        <span aria-hidden="true" {...stylex.props(titlebarStyles.contentFill)} />
      </header>
    );
  }

  return (
    <header {...stylex.props(titlebarStyles.bar, mac && titlebarStyles.barMac)}>
      <span
        aria-hidden="true"
        {...stylex.props(
          titlebarStyles.contentFill,
          !sidebarVisible && titlebarStyles.contentFillSidebarHidden,
        )}
      />
      <span {...stylex.props(titlebarStyles.actionTrack)}>
        <HintToggleIconButton
          icon={<PanelToggleIcon side="left" visible={sidebarVisible} />}
          label={sidebarVisible ? "Hide sidebar" : "Show sidebar"}
          hint={`${sidebarVisible ? "Hide Sidebar" : "Show Sidebar"} ${clientActionShortcut(clientActions.sidebar, mac)}`}
          pressed={sidebarVisible}
          aria-keyshortcuts={clientActionAriaShortcut(clientActions.sidebar, mac)}
          onPressedChange={() => shellActions.toggleSidebar()}
        />
      </span>
      {sidebarVisible && (
        <span {...stylex.props(titlebarStyles.navigationTrack)}>
          <HintIconButton
            icon="arrow-left"
            label="Go back"
            hint={`Go Back ${clientActionShortcut(clientActions.back, mac)}`}
            disabled={!canGoBack}
            aria-keyshortcuts={clientActionAriaShortcut(clientActions.back, mac)}
            onClick={() => {
              if (stage.kind === "customize") {
                shellActions.showWorkspace();
                return;
              }
              shellRouter.history.back();
            }}
          />
          <HintIconButton
            icon="arrow-right"
            label="Go forward"
            hint={`Go Forward ${clientActionShortcut(clientActions.forward, mac)}`}
            disabled={!canGoForward}
            aria-keyshortcuts={clientActionAriaShortcut(clientActions.forward, mac)}
            onClick={() => {
              shellActions.showWorkspace();
              shellRouter.history.forward();
            }}
          />
        </span>
      )}
      {workspaceVisible && selection.kind === "session" && (
        <span
          {...stylex.props(
            titlebarStyles.titleSlot,
            workbenchOpen && titlebarStyles.titleSlotWorkbenchOpen,
            !sidebarVisible &&
              (mac
                ? titlebarStyles.titleSlotSidebarHiddenMac
                : titlebarStyles.titleSlotSidebarHidden),
          )}
        >
          <SessionTitle sessionId={selection.sessionId} />
        </span>
      )}
      <span {...stylex.props(titlebarStyles.spacer)} />
      {workspaceVisible && layout.kind === "single" && !(workbenchOpen && view.maximized) && (
        <span {...stylex.props(titlebarStyles.actionTrack)}>
          <Menu
            label="Chat actions"
            align="end"
            trigger={<IconButton icon="more" label="Chat actions" />}
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
      {workbenchOpen && (
        <span aria-hidden="true" {...stylex.props(titlebarStyles.workbenchReservation)} />
      )}
      {workspaceVisible && (
        <div
          {...stylex.props(
            workbenchOpen ? titlebarStyles.workbenchTrack : titlebarStyles.actionTrack,
            workbenchOpen &&
              !sidebarVisible &&
              (mac
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
                workspacePath={terminalWorkspacePath}
              />
              <HintToggleIconButton
                icon={view.maximized ? "minimize" : "expand"}
                label={view.maximized ? "Restore workbench width" : "Expand workbench"}
                hint={view.maximized ? "Restore Workbench Width" : "Expand Workbench"}
                pressed={view.maximized}
                onPressedChange={() =>
                  workbenchController.actions.toggleMaximized({ view: viewKey })
                }
              />
            </>
          )}
          <HintToggleIconButton
            id="workbench-toggle"
            icon={<PanelToggleIcon side="right" visible={workbenchOpen} />}
            label={workbenchOpen ? "Hide workbench" : "Show workbench"}
            hint={`${workbenchOpen ? "Hide Workbench" : "Show Workbench"} ${clientActionShortcut(clientActions.workbench, mac)}`}
            pressed={workbenchOpen}
            aria-keyshortcuts={clientActionAriaShortcut(clientActions.workbench, mac)}
            onPressedChange={() =>
              workbenchController.actions.toggleWorkbench({ view: viewKey, scope })
            }
          />
        </div>
      )}
    </header>
  );
}
