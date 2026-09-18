/**
 * Eager workbench controller. Open panels stay mounted while hidden; closing a
 * tab releases its panel. The window titlebar owns the tab strip and the only
 * control that hides the panel, which frees the panel's width for the stage.
 *
 * Based on https://github.com/interfaces-lab/honk/blob/main/packages/app/src/workbench.tsx
 */
import { create, props } from "@stylexjs/stylex";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, ReactElement } from "react";
import type { SessionId } from "@nyte-ai/protocol";
import { PanelToggleIcon } from "../components/icons";
import { ToggleIconButton } from "../components/ui";
import { useHostState } from "../queries.ts";
import { layer, workbench } from "../theme/schema.stylex";
import { t } from "../theme/vars.stylex";
import {
  clampWorkbenchWidthToBounds,
  workbenchTabAvailable,
  activeWorkbenchTab,
  WORKBENCH_ACTIVE_WIDTH_VARIABLE,
  WORKBENCH_CENTER_WIDTH_MIN,
  WORKBENCH_WIDTH_DEFAULT,
  workbenchController,
  workbenchScopeForTarget,
  workbenchViewIdentity,
  workbenchViewKey,
  workbenchWidthBounds,
  useWorkbenchSnapshot,
} from "./controller";
import type {
  WorkbenchScope,
  WorkbenchTabId,
  WorkbenchTarget,
  WorkbenchViewKey,
  WorkbenchViewState,
} from "./controller";

import { useTerminals } from "./terminal-store";

import { BrowserPanel } from "./browser-panel";
import { FilesPanel } from "./files-panel.tsx";
import { useFileTabs } from "./file-store.ts";
import { TerminalPanel } from "./terminal-panel";
import { AgentsPanel } from "./agents-panel.tsx";
import { ChangesPanel } from "./changes-panel";
const styles = create({
  root: {
    position: "relative",
    display: "flex",
    minWidth: 0,
    minHeight: 0,
    height: "100%",
    flexShrink: 0,
    backgroundColor: t.bgBase,
  },
  panel: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    minWidth: workbench.panelWidth,
    minHeight: 0,
    borderInlineStartWidth: 1,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: t.strokeTertiary,
    backgroundColor: t.bgBase,
  },
  panelOverlay: {
    position: "absolute",
    zIndex: layer.workbench,
    insetBlock: 0,
    insetInlineEnd: 0,
    minWidth: 0,
    maxWidth: "100vw",
    boxShadow: t.shadowWorkbench,
  },
  panelHidden: { display: "none" },
  panelBody: { display: "flex", flex: 1, minWidth: 0, minHeight: 0, flexDirection: "column" },
  panelSlot: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
  },
  panelSlotHidden: { display: "none" },
  sash: {
    position: "absolute",
    zIndex: 2,
    insetBlock: 0,
    insetInlineStart: -6,
    width: 12,
    borderStyle: "none",
    outlineStyle: "none",
    backgroundColor: {
      default: "transparent",
      ":hover": t.fillGhostHover,
      ":focus-visible": t.fillGhostSelected,
    },
    cursor: "col-resize",
    touchAction: "none",
    WebkitAppRegion: "no-drag",
  },
  sashActive: { backgroundColor: t.fillPrimary, opacity: 0.25 },
});

interface ResizeState {
  readonly pointerId: number;
  readonly startX: number;
  readonly startWidth: number;
  nextWidth: number;
}

function setActiveWidth(width: number): void {
  document.documentElement.style.setProperty(WORKBENCH_ACTIVE_WIDTH_VARIABLE, `${String(width)}px`);
}

interface PanelContentProps {
  readonly tab: WorkbenchTabId;
  readonly viewKey: WorkbenchViewKey;
  readonly sessionId: SessionId | undefined;
  readonly view: WorkbenchViewState;
  readonly visible: boolean;
  readonly workspaceActive: boolean;
  readonly workspacePath: string | null;
  /** The panel's own inner list: the Changes file tree, the Browser's visit history. */
  readonly tabSidebarVisible: boolean;
  readonly onToggleTabSidebar: () => void;
  readonly onSelectPath: (path: string | undefined) => void;
  readonly onRevealPath: (path: string) => void;
  readonly onChangesScroll: (scrollTop: number) => void;
  readonly onBrowserUrl: (url: string | undefined) => void;
}

function PanelContent({
  tab,
  viewKey,
  sessionId,
  view,
  visible,
  workspacePath,
  workspaceActive,
  tabSidebarVisible,
  onToggleTabSidebar,
  onSelectPath,
  onRevealPath,
  onChangesScroll,
  onBrowserUrl,
}: PanelContentProps): ReactElement {
  switch (tab) {
    case "files":
      return <FilesPanel viewKey={viewKey} workspaceActive={workspaceActive} />;
    case "changes":
      return (
        <ChangesPanel
          sessionId={sessionId}
          scope={view.changesScope}
          selectedPath={view.selectedPath}
          revealPathRevision={view.pathRevealRevision}
          scrollTop={view.scrollTop.changes}
          fileTreeVisible={tabSidebarVisible}
          onScopeChange={(scope) => workbenchController.actions.selectChangesScope(viewKey, scope)}
          onToggleFileTree={onToggleTabSidebar}
          onSelectPath={onSelectPath}
          onRevealPath={onRevealPath}
          onScrollTop={onChangesScroll}
        />
      );
    case "browser":
      return (
        <BrowserPanel
          surface={viewKey}
          visible={visible}
          historyVisible={tabSidebarVisible}
          url={view.browserUrl}
          onUrlChange={onBrowserUrl}
          workspacePath={workspacePath}
          toolbarActions={
            <ToggleIconButton
              icon={<PanelToggleIcon side="right" visible={tabSidebarVisible} />}
              label={tabSidebarVisible ? "Hide visit history" : "Show visit history"}
              pressed={tabSidebarVisible}
              onPressedChange={onToggleTabSidebar}
            />
          }
        />
      );
    case "terminal":
      return (
        <TerminalPanel
          owner={viewKey}
          sessionId={sessionId}
          workspacePath={workspacePath}
          visible={visible}
        />
      );
    case "agents":
      return <AgentsPanel owner={viewKey} sessionId={sessionId} visible={visible} />;
    default: {
      const _exhaustive: never = tab;
      return _exhaustive;
    }
  }
}

function WorkbenchViewHost({
  viewKey,
  target,
  view,
  current,
  scope,
  stageWidth,
  workspacePath,
}: {
  readonly viewKey: WorkbenchViewKey;
  readonly target: WorkbenchTarget;
  readonly view: WorkbenchViewState;
  readonly current: boolean;
  readonly scope: WorkbenchScope;
  readonly stageWidth: number;
  readonly workspacePath: string | null;
}): ReactElement {
  const [resizing, setResizing] = useState(false);
  const activeTerminalId = useTerminals(viewKey).activeId;
  const files = useFileTabs(viewKey);
  const [tabSidebars, setTabSidebars] = useState<Record<WorkbenchTabId, boolean>>({
    files: true,
    changes: true,
    browser: false,
    terminal: false,
    agents: false,
  });
  const panelRef = useRef<HTMLElement>(null);
  const resizeRef = useRef<ResizeState | undefined>(undefined);
  const bounds = workbenchWidthBounds(stageWidth);
  const panelWidth = view.maximized ? stageWidth : clampWorkbenchWidthToBounds(view.width, bounds);
  const defaultWidth = clampWorkbenchWidthToBounds(WORKBENCH_WIDTH_DEFAULT, bounds);
  const selectPath = useCallback(
    (path: string | undefined) => workbenchController.actions.selectPath(viewKey, path),
    [viewKey],
  );
  const revealPath = useCallback(
    (path: string) => workbenchController.actions.revealPath(viewKey, path),
    [viewKey],
  );
  const setChangesScroll = useCallback(
    (scrollTop: number) => workbenchController.actions.setScrollTop(viewKey, "changes", scrollTop),
    [viewKey],
  );
  const setBrowserUrl = useCallback(
    (url: string | undefined) => workbenchController.actions.setBrowserUrl(viewKey, url),
    [viewKey],
  );
  const resetWidth = useCallback(
    () => workbenchController.actions.setWidth(viewKey, defaultWidth),
    [defaultWidth, viewKey],
  );

  const beginResize = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: panelWidth,
      nextWidth: panelWidth,
    };
    setResizing(true);
  };

  const moveResize = (event: PointerEvent<HTMLDivElement>): void => {
    const resize = resizeRef.current;
    if (resize === undefined || resize.pointerId !== event.pointerId) return;
    resize.nextWidth = clampWorkbenchWidthToBounds(
      resize.startWidth + resize.startX - event.clientX,
      bounds,
    );
    if (panelRef.current !== null) panelRef.current.style.width = `${String(resize.nextWidth)}px`;
    setActiveWidth(resize.nextWidth);
  };

  const endResize = (event: PointerEvent<HTMLDivElement>): void => {
    const resize = resizeRef.current;
    if (resize === undefined || resize.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    resizeRef.current = undefined;
    workbenchController.actions.setWidth(viewKey, resize.nextWidth);
    setResizing(false);
  };

  const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>): void => {
    let width: number | undefined;
    if (event.key === "ArrowLeft") width = panelWidth + 20;
    else if (event.key === "ArrowRight") width = panelWidth - 20;
    else if (event.key === "Home") width = bounds.min;
    else if (event.key === "End") width = bounds.max;
    if (width === undefined) return;
    event.preventDefault();
    workbenchController.actions.setWidth(viewKey, clampWorkbenchWidthToBounds(width, bounds));
  };

  const activeTab = activeWorkbenchTab(view, scope);
  const panelVisible = current && view.expanded && activeTab !== null;

  useLayoutEffect(() => {
    if (panelVisible) setActiveWidth(panelWidth);
  }, [panelVisible, panelWidth]);
  // Retained views are pathless while inactive, but their file editors still own drafts.
  const mountedTabs = view.openTabs.filter(
    (tab) => workbenchTabAvailable(scope, tab) || (tab === "files" && files.tabs.length > 0),
  );

  return (
    <section
      ref={panelRef}
      hidden={!panelVisible}
      aria-hidden={!panelVisible}
      inert={panelVisible ? undefined : true}
      {...props(
        styles.panel,
        panelVisible && (view.maximized || bounds.kind === "overlay") && styles.panelOverlay,
        !panelVisible && styles.panelHidden,
      )}
      style={panelVisible ? { width: panelWidth } : undefined}
    >
      <div {...props(styles.panelBody)}>
        {panelVisible && !view.maximized && (
          <div
            role="separator"
            tabIndex={0}
            aria-label="Resize workbench"
            aria-orientation="vertical"
            aria-valuemin={bounds.min}
            aria-valuemax={bounds.max}
            aria-valuenow={panelWidth}
            title="Drag to resize. Double-click to reset."
            {...props(styles.sash, resizing && styles.sashActive)}
            onKeyDown={resizeWithKeyboard}
            onPointerDown={beginResize}
            onPointerMove={moveResize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            onDoubleClick={resetWidth}
          />
        )}
        {mountedTabs.map((tab) => {
          const tabVisible = panelVisible && activeTab === tab;
          return (
            <div
              key={tab}
              id={`${viewKey}-panel-${tab}`}
              role="tabpanel"
              aria-labelledby={`${viewKey}-tab-${
                tab === "terminal"
                  ? activeTerminalId
                  : tab === "files" && files.activePath !== undefined
                    ? `file:${encodeURIComponent(files.activePath)}`
                    : tab
              }`}
              hidden={!tabVisible}
              aria-hidden={!tabVisible}
              inert={!tabVisible ? true : undefined}
              {...props(styles.panelSlot, !tabVisible && styles.panelSlotHidden)}
            >
              <PanelContent
                tab={tab}
                viewKey={viewKey}
                sessionId={target.kind === "session" ? target.sessionId : undefined}
                view={view}
                visible={tabVisible}
                workspacePath={workspacePath}
                workspaceActive={current}
                tabSidebarVisible={tabSidebars[tab]}
                onToggleTabSidebar={() =>
                  setTabSidebars((current) => ({ ...current, [tab]: !current[tab] }))
                }
                onSelectPath={selectPath}
                onRevealPath={revealPath}
                onChangesScroll={setChangesScroll}
                onBrowserUrl={setBrowserUrl}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

interface WorkbenchProps {
  readonly target: WorkbenchTarget;
  /** Stable stage identity; views are keyed on it together with their data target. */
  readonly paneKey: string;
}

export function Workbench({ target, paneKey }: WorkbenchProps): ReactElement {
  const host = useHostState();
  const rootRef = useRef<HTMLElement>(null);
  const [stageWidth, setStageWidth] = useState(
    WORKBENCH_WIDTH_DEFAULT + WORKBENCH_CENTER_WIDTH_MIN,
  );
  const viewKey = workbenchViewKey({ paneKey, target });
  const snapshot = useWorkbenchSnapshot();
  const retainedViews = [...snapshot.views].flatMap(([knownViewKey, view]) => {
    const identity = workbenchViewIdentity(knownViewKey);
    return identity?.paneKey === paneKey && identity.key !== viewKey ? [{ identity, view }] : [];
  });
  const currentIdentity = workbenchViewIdentity(viewKey);
  const paneViews =
    currentIdentity === undefined
      ? retainedViews
      : [
          ...retainedViews,
          {
            identity: currentIdentity,
            view: snapshot.views.get(viewKey) ?? workbenchController.getView(viewKey),
          },
        ];

  useLayoutEffect(() => {
    const stage = rootRef.current?.parentElement;
    if (stage === undefined || stage === null) return;
    const update = (): void => {
      const width = Math.floor(stage.getBoundingClientRect().width);
      if (width > 0) setStageWidth((current) => (current === width ? current : width));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  return (
    <aside ref={rootRef} {...props(styles.root)} aria-label="Workbench">
      {paneViews.map(({ identity, view }) => {
        const current = identity.key === viewKey;
        const scope: WorkbenchScope = current
          ? workbenchScopeForTarget(identity.target, host.data?.workspace?.path)
          : { kind: "pathless" };
        return (
          <WorkbenchViewHost
            key={identity.key}
            viewKey={identity.key}
            target={identity.target}
            view={view}
            current={current}
            scope={scope}
            stageWidth={stageWidth}
            workspacePath={
              identity.target.kind === "home"
                ? null
                : identity.target.kind === "workspace"
                  ? identity.target.workspacePath
                  : (host.data?.workspace?.path ?? null)
            }
          />
        );
      })}
    </aside>
  );
}
