/**
 * Permanent window chrome. The sidebar toggle stays on the rail side; chat
 * actions and the stage-level workbench entry stay at the trailing edge.
 */
import * as stylex from "@stylexjs/stylex";
import { useMatch, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import type { ReactElement } from "react";
import type { SessionId } from "@nyte-ai/core";
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
import { layer, shell, sidebar } from "../theme/schema.stylex.ts";
import { t } from "../theme/vars.stylex.ts";
import {
  WORKBENCH_STAGE_PANE_KEY,
  activeWorkbenchTab,
  workbenchScopeForTarget,
  workbenchController,
  workbenchViewKey,
  useWorkbenchSnapshot,
} from "../workbench/controller.ts";
import type { WorkbenchTarget } from "../workbench/controller.ts";
import { terminalActions, useTerminals } from "../workbench/terminal-store.ts";
import { shellActions, useShellState } from "./shell-state.ts";
import {
  clientActionAriaShortcut,
  clientActionShortcut,
  clientActions,
  resolveClientAction,
} from "../../../shared/client-actions.ts";

import { WorkbenchTabStrip } from "../workbench/tab-strip.tsx";

const styles = stylex.create({
  bar: {
    position: "relative",
    zIndex: layer.chrome,
    display: "flex",
    alignItems: "center",
    height: shell.titlebarHeight,
    paddingInlineEnd: 10,
    paddingInlineStart: 10,
    flexShrink: 0,
    WebkitAppRegion: "drag",
  },
  contentFill: {
    position: "absolute",
    insetBlock: 0,
    insetInlineStart: `calc(${sidebar.width} - 1px)`,
    insetInlineEnd: 0,
    borderInlineStartWidth: 1,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: t.strokeQuaternary,
    backgroundClip: "padding-box",
    backgroundColor: t.bgBase,
    pointerEvents: "none",
  },
  contentFillSidebarHidden: { insetInlineStart: 0, borderInlineStartWidth: 0 },
  workbenchTrack: {
    position: "absolute",
    zIndex: 3,
    insetBlock: 0,
    insetInlineEnd: 0,
    display: "flex",
    alignItems: "center",
    gap: 2,
    width: "var(--nyte-active-workbench-width, 500px)",
    minWidth: 0,
    paddingInlineStart: 6,
    paddingInlineEnd: 10,
    borderInlineStartWidth: 1,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: t.borderSubtle,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: t.borderSubtle,
    backgroundColor: t.bgBase,
    WebkitAppRegion: "no-drag",
  },
  workbenchTrackSidebarHiddenMac: { maxWidth: "calc(100% - 112px)" },
  workbenchTrackSidebarHidden: { maxWidth: "calc(100% - 38px)" },
  workbenchReservation: {
    width: "calc(var(--nyte-active-workbench-width, 500px) - 10px)",
    flexShrink: 0,
  },
  titleSlotWorkbenchOpen: {
    insetInlineEnd: "calc(var(--nyte-active-workbench-width, 500px) + 44px)",
  },
  // macOS reserves a 72px traffic-light lane at 100% zoom.
  barMac: { paddingInlineStart: 72 },
  actionTrack: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 28,
    flexShrink: 0,
    position: "relative",
    zIndex: 1,
    WebkitAppRegion: "no-drag",
  },
  navigationTrack: {
    position: "absolute",
    zIndex: 2,
    insetInlineStart: `calc(${sidebar.width} - 64px)`,
    insetBlock: 0,
    display: "inline-flex",
    alignItems: "center",
    gap: 2,
    WebkitAppRegion: "no-drag",
  },
  spacer: { flex: 1, minWidth: 0 },
  titleSlot: {
    position: "absolute",
    zIndex: 1,
    insetBlock: 0,
    insetInlineStart: `calc(${sidebar.width} + 12px)`,
    insetInlineEnd: 96,
    display: "flex",
    alignItems: "center",
    minWidth: 0,
    pointerEvents: "none",
  },
  // 72px of traffic lights, the 28px toggle, then a 12px title gap on macOS;
  // elsewhere the toggle alone.
  titleSlotSidebarHiddenMac: { insetInlineStart: 112 },
  titleSlotSidebarHidden: { insetInlineStart: 38 },
  sessionTitle: {
    maxWidth: "min(420px, 50vw)",
    overflow: "hidden",
    color: t.textSecondary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});

function SessionTitle({ sessionId }: { sessionId: SessionId }): ReactElement {
  const session = useSession(sessionId);
  return (
    <span
      title={session.data?.name ?? session.data?.preview}
      {...stylex.props(styles.sessionTitle)}
    >
      {session.data?.name ?? session.data?.preview ?? "New chat"}
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
  const terminalCount = useTerminals(viewKey).tabs.length;
  const terminalWorkspacePath = target.kind === "home" ? null : (workspacePath ?? null);
  const scope = workbenchScopeForTarget(target, workspacePath);
  const settingsMatch = useMatch({ from: "/settings/$section", shouldThrow: false });
  const settingsOpen = settingsMatch !== undefined;
  const workspaceVisible = !settingsOpen && stage.kind === "workspace";
  const workbenchOpen =
    workspaceVisible && view.expanded && activeWorkbenchTab(view, scope) !== null;
  const canGoBack = stage.kind === "customize" || settingsOpen || shellRouter.history.canGoBack();
  const historyIndex = shellRouter.history.location.state.__TSR_index;
  const canGoForward = historyIndex < shellRouter.history.length - 1;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!workspaceVisible) return;
      const action = resolveClientAction(event, mac, "workspace");
      if (action?.id === "terminal" || action?.id === "new-terminal") {
        event.preventDefault();
        if (action.id === "terminal" && workbenchOpen && view.activeTab === "terminal") {
          workbenchController.actions.toggle(viewKey);
        } else {
          if (action.id === "new-terminal" || terminalCount === 0) {
            void terminalActions.create(viewKey, terminalWorkspacePath);
          }
          workbenchController.actions.openTab(viewKey, "terminal");
        }
        return;
      }
      if (action?.id !== "workbench") return;
      event.preventDefault();
      workbenchController.actions.toggleWorkbench(viewKey, scope);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    mac,
    workspaceVisible,
    viewKey,
    workbenchOpen,
    view.activeTab,
    terminalCount,
    terminalWorkspacePath,
    scope,
  ]);

  if (settingsOpen) {
    return (
      <header {...stylex.props(styles.bar, mac && styles.barMac)}>
        <span aria-hidden="true" {...stylex.props(styles.contentFill)} />
      </header>
    );
  }

  return (
    <header {...stylex.props(styles.bar, mac && styles.barMac)}>
      <span
        aria-hidden="true"
        {...stylex.props(styles.contentFill, !sidebarVisible && styles.contentFillSidebarHidden)}
      />
      <span {...stylex.props(styles.actionTrack)}>
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
        <span {...stylex.props(styles.navigationTrack)}>
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
            styles.titleSlot,
            workbenchOpen && styles.titleSlotWorkbenchOpen,
            !sidebarVisible &&
              (mac ? styles.titleSlotSidebarHiddenMac : styles.titleSlotSidebarHidden),
          )}
        >
          <SessionTitle sessionId={selection.sessionId} />
        </span>
      )}
      <span {...stylex.props(styles.spacer)} />
      {workspaceVisible && layout.kind === "single" && !(workbenchOpen && view.maximized) && (
        <span {...stylex.props(styles.actionTrack)}>
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
      {workbenchOpen && <span aria-hidden="true" {...stylex.props(styles.workbenchReservation)} />}
      {workspaceVisible && (
        <div
          {...stylex.props(
            workbenchOpen ? styles.workbenchTrack : styles.actionTrack,
            workbenchOpen &&
              !sidebarVisible &&
              (mac ? styles.workbenchTrackSidebarHiddenMac : styles.workbenchTrackSidebarHidden),
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
                onPressedChange={() => workbenchController.actions.toggleMaximized(viewKey)}
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
            onPressedChange={() => workbenchController.actions.toggleWorkbench(viewKey, scope)}
          />
        </div>
      )}
    </header>
  );
}
