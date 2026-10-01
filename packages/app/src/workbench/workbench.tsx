import { workbenchStyles } from "./workbench.stylex.ts";
import { intent } from "@nyte-ai/ui/surface-theme";
import { props } from "@stylexjs/stylex";
import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { KeyboardEvent, PointerEvent, ReactElement, ReactNode } from "react";
import type { SessionId } from "@nyte-ai/protocol";
import { changesFromTurns } from "@nyte-ai/client";
import { clientCapabilities } from "../client-actions.ts";
import type { ClientCapabilities } from "../client-actions.ts";
import { nyte } from "../nyte.ts";
import { Icon, PanelToggleIcon } from "@nyte-ai/ui/icon";
import type { IconName } from "@nyte-ai/ui/icon";
import { Button } from "@nyte-ai/ui/button";
import { Row } from "@nyte-ai/ui/row";
import { Toggle } from "@nyte-ai/ui/toggle";
import { useHostState, useSessionSnapshot } from "../queries.ts";
import {
  activeWorkbenchTab,
  clampWorkbenchWidthToBounds,
  defaultWorkbenchTab,
  WORKBENCH_ACTIVE_WIDTH_VARIABLE,
  WORKBENCH_CENTER_WIDTH_MIN,
  WORKBENCH_WIDTH_DEFAULT,
  workbenchController,
  workbenchScope,
  workbenchTabAvailable,
  workbenchKindLabel,
  workbenchTabLabel,
  workbenchTabs,
  workbenchViewKey,
  workbenchWidthBounds,
  useWorkbenchSnapshot,
  WORKBENCH_HOME_VIEW_KEY,
} from "./controller";
import type {
  WorkbenchScope,
  WorkbenchTab,
  WorkbenchTabId,
  WorkbenchTabKind,
  WorkbenchViewKey,
  WorkbenchViewState,
} from "./controller";
import { terminalActions, useTerminalRuntime } from "./terminal-store";
import { BrowserPanel } from "./browser-panel";
import { FilesPanel } from "./files-panel.tsx";
import { useFileTabs } from "./file-store.ts";
import { TerminalPanel } from "./terminal-panel";
import { ChangesPanel } from "./changes-panel";

// Views visited since launch stay mounted so a dev server terminal or a
// browser page in another folder survives switching away and back, and a
// trip through Settings that unmounts the stage.
let visitedViews: readonly WorkbenchViewKey[] = Object.freeze([]);

const visitedListeners = new Set<() => void>();

function visitWorkbenchView(key: WorkbenchViewKey): void {
  if (visitedViews.includes(key)) return;
  visitedViews = Object.freeze([...visitedViews, key]);

  for (const listener of visitedListeners) listener();
}

function subscribeVisited(listener: () => void): () => void {
  visitedListeners.add(listener);

  return () => visitedListeners.delete(listener);
}

const tabIcons = {
  file: "file",
  files: "file",
  changes: "git-branch",
  browser: "globe",
  terminal: "console",
} satisfies Record<WorkbenchTabKind, IconName>;

interface ResizeState {
  readonly pointerId: number;
  readonly startX: number;
  readonly startWidth: number;
  nextWidth: number;
}

function setActiveWidth(width: number): void {
  document.documentElement.style.setProperty(WORKBENCH_ACTIVE_WIDTH_VARIABLE, `${String(width)}px`);
}

function RailRow({
  icon,
  label,
  title,
  children,
  onClick,
}: {
  readonly icon: IconName;
  readonly label: string;
  readonly title?: string;
  readonly children?: ReactNode;
  readonly onClick: () => void;
}): ReactElement {
  return (
    <Row interactive xstyle={workbenchStyles.railRow}>
      <Row.Primary title={title} onClick={onClick}>
        <Row.Leading>
          <Icon name={icon} size={14} />
        </Row.Leading>
        <Row.Label xstyle={workbenchStyles.railLabel}>{label}</Row.Label>
        {children}
      </Row.Primary>
    </Row>
  );
}

function DoubleChevron({ back = false }: { readonly back?: boolean }): ReactElement {
  return (
    <span {...props(workbenchStyles.doubleChevron, back && workbenchStyles.doubleChevronBack)}>
      <Icon name="chevron-right" size={11} />
      <span {...props(workbenchStyles.doubleChevronTrail)}>
        <Icon name="chevron-right" size={11} />
      </span>
    </span>
  );
}

function RailChangeStats({ sessionId }: { readonly sessionId: SessionId }): ReactElement | null {
  const snapshot = useSessionSnapshot(sessionId);

  const stats = changesFromTurns(snapshot.data?.transcript ?? []).reduce(
    (total, file) => ({ added: total.added + file.added, removed: total.removed + file.removed }),
    { added: 0, removed: 0 },
  );

  if (stats.added === 0 && stats.removed === 0) return null;

  return (
    <span
      aria-label={`${String(stats.added)} added, ${String(stats.removed)} removed`}
      {...props(workbenchStyles.railStats)}
    >
      {stats.added > 0 && (
        <span {...props(intent.success, workbenchStyles.railAdded)}>+{stats.added}</span>
      )}
      {stats.removed > 0 && (
        <span {...props(intent.danger, workbenchStyles.railRemoved)}>-{stats.removed}</span>
      )}
    </span>
  );
}

function openWorkbenchTab({
  view,
  kind,
  workspacePath,
  capabilities,
}: {
  readonly view: WorkbenchViewKey;
  readonly kind: WorkbenchTabKind;
  readonly workspacePath: string | null;
  readonly capabilities: ClientCapabilities;
}): void {
  if (!workbenchTabAvailable({ kind: "project" }, kind, capabilities)) return;
  const id = workbenchController.actions.openTab({
    view,
    tab: defaultWorkbenchTab(kind),
    activate: true,
  });

  if (kind === "terminal") void terminalActions.create({ id, workspacePath });
}

function FloatingWorkbenchPanel({
  viewKey,
  view,
  scope,
  sessionId,
  workspaceName,
  workspacePath,
  capabilities,
}: {
  readonly viewKey: WorkbenchViewKey;
  readonly view: WorkbenchViewState;
  readonly scope: WorkbenchScope;
  readonly sessionId: SessionId | undefined;
  readonly workspaceName: string | undefined;
  readonly workspacePath: string | null;
  readonly capabilities: ClientCapabilities;
}): ReactElement {
  const terminals = useTerminalRuntime();
  const files = useFileTabs(viewKey);
  const visibleTabs = view.tabs.filter((tab) =>
    workbenchTabAvailable(scope, tab.kind, capabilities),
  );

  return (
    <nav aria-label="Workbench navigation" {...props(workbenchStyles.rail)}>
      <section {...props(workbenchStyles.railSection)}>
        <div {...props(workbenchStyles.railHeading)}>
          <span {...props(workbenchStyles.railHeadingText)}>Open Tabs</span>
          <Button
            size="sm"
            iconOnly
            aria-label="Collapse workbench"
            xstyle={workbenchStyles.chevronLayout}
            onClick={() => workbenchController.actions.toggleCollapsed({ view: viewKey })}
          >
            <DoubleChevron />
          </Button>
        </div>
        {visibleTabs.map((tab) => {
          const file =
            tab.kind === "file" ? files.tabs.find((item) => item.id === tab.id) : undefined;

          const terminal = tab.kind === "terminal" ? terminals.get(tab.id) : undefined;
          const label = file?.displayPath ?? terminal?.title ?? workbenchTabLabel(tab);

          return (
            <RailRow
              key={tab.id}
              icon={tabIcons[tab.kind]}
              label={label}
              title={file?.displayPath ?? terminal?.cwd}
              onClick={() => workbenchController.actions.activateTab({ view: viewKey, id: tab.id })}
            />
          );
        })}
      </section>

      <section {...props(workbenchStyles.railSection)}>
        <div {...props(workbenchStyles.railHeading)}>
          <span {...props(workbenchStyles.railHeadingText)}>
            {workspaceName === undefined ? "On This Mac" : `On ${workspaceName}`}
          </span>
        </div>
        {workbenchTabs(scope, capabilities).map((kind) => (
          <RailRow
            key={kind}
            icon={tabIcons[kind]}
            label={workbenchKindLabel(kind)}
            onClick={() => openWorkbenchTab({ view: viewKey, kind, workspacePath, capabilities })}
          >
            {kind === "changes" && sessionId !== undefined && (
              <RailChangeStats sessionId={sessionId} />
            )}
          </RailRow>
        ))}
      </section>
    </nav>
  );
}

function CompactWorkbenchBar({
  viewKey,
  scope,
  workspacePath,
  capabilities,
}: {
  readonly viewKey: WorkbenchViewKey;
  readonly scope: WorkbenchScope;
  readonly workspacePath: string | null;
  readonly capabilities: ClientCapabilities;
}): ReactElement {
  return (
    <nav aria-label="Workbench navigation" {...props(workbenchStyles.iconRail)}>
      <Button
        iconOnly
        aria-label="Expand workbench"
        onClick={() => workbenchController.actions.toggleCollapsed({ view: viewKey })}
      >
        <DoubleChevron back />
      </Button>
      <span aria-hidden="true" {...props(workbenchStyles.iconRailDivider)} />
      {workbenchTabs(scope, capabilities).map((kind) => (
        <Button
          iconOnly
          key={kind}
          icon={tabIcons[kind]}
          aria-label={`Open ${workbenchKindLabel(kind)}`}
          onClick={() => openWorkbenchTab({ view: viewKey, kind, workspacePath, capabilities })}
        />
      ))}
    </nav>
  );
}

function PanelContent({
  tab,
  viewKey,
  sessionId,
  visible,
  workspacePath,
  workspaceActive,
  sidebarVisible,
  onToggleSidebar,
}: {
  readonly tab: WorkbenchTab;
  readonly viewKey: WorkbenchViewKey;
  readonly sessionId: SessionId | undefined;
  readonly visible: boolean;
  readonly workspacePath: string | null;
  readonly workspaceActive: boolean;
  readonly sidebarVisible: boolean;
  readonly onToggleSidebar: () => void;
}): ReactElement {
  switch (tab.kind) {
    case "file":
    case "files":
      return <FilesPanel viewKey={viewKey} visible={visible} workspaceActive={workspaceActive} />;
    case "changes":
      return (
        <ChangesPanel
          visible={visible}
          sessionId={sessionId}
          scope={tab.scope}
          selectedPath={tab.selectedPath ?? undefined}
          revealPathRevision={tab.pathRevealRevision}
          scrollTop={tab.scrollTop}
          fileTreeVisible={sidebarVisible}
          onScopeChange={(scope) =>
            workbenchController.actions.updateTab({
              view: viewKey,
              id: tab.id,
              kind: "changes",
              patch: {
                scope,
                selectedPath: null,
                pathRevealRevision: tab.pathRevealRevision,
                scrollTop: 0,
              },
            })
          }
          onToggleFileTree={onToggleSidebar}
          onSelectPath={(path) =>
            workbenchController.actions.updateTab({
              view: viewKey,
              id: tab.id,
              kind: "changes",
              patch: { ...tab, selectedPath: path ?? null },
            })
          }
          onRevealPath={(path) =>
            workbenchController.actions.updateTab({
              view: viewKey,
              id: tab.id,
              kind: "changes",
              patch: {
                ...tab,
                selectedPath: path,
                pathRevealRevision: tab.pathRevealRevision + 1,
              },
            })
          }
          onScrollTop={(scrollTop) =>
            workbenchController.actions.scrollTab({
              view: viewKey,
              id: tab.id,
              scrollTop: Math.max(0, scrollTop),
            })
          }
        />
      );
    case "browser":
      return (
        <BrowserPanel
          surface={tab.id}
          visible={visible}
          historyVisible={sidebarVisible}
          url={tab.url}
          onUrlChange={(url) =>
            workbenchController.actions.updateTab({
              view: viewKey,
              id: tab.id,
              kind: "browser",
              patch: { url },
            })
          }
          workspacePath={workspacePath}
          toolbarActions={
            <Toggle
              iconOnly
              indicator="glyph"
              aria-label={sidebarVisible ? "Hide visit history" : "Show visit history"}
              pressed={sidebarVisible}
              onPressedChange={onToggleSidebar}
            >
              <PanelToggleIcon side="right" visible={sidebarVisible} />
            </Toggle>
          }
        />
      );
    case "terminal":
      return <TerminalPanel tabId={tab.id} workspacePath={workspacePath} visible={visible} />;
    default: {
      const _exhaustive: never = tab;

      return _exhaustive;
    }
  }
}

function WorkbenchViewHost({
  viewKey,
  view,
  current,
  scope,
  sessionId,
  stageWidth,
  workspaceName,
  workspacePath,
  capabilities,
}: {
  readonly viewKey: WorkbenchViewKey;
  readonly view: WorkbenchViewState;
  readonly current: boolean;
  readonly scope: WorkbenchScope;
  readonly sessionId: SessionId | undefined;
  readonly stageWidth: number;
  readonly workspaceName: string | undefined;
  readonly workspacePath: string | null;
  readonly capabilities: ClientCapabilities;
}): ReactElement {
  const [resizing, setResizing] = useState(false);
  const [sidebars, setSidebars] = useState<ReadonlyMap<WorkbenchTabId, boolean>>(new Map());
  const panelRef = useRef<HTMLElement>(null);
  const resizeRef = useRef<ResizeState | undefined>(undefined);
  const bounds = workbenchWidthBounds(stageWidth);
  const compact = view.collapsed === "compact" || bounds.kind === "overlay";
  const panelWidth = view.maximized ? stageWidth : clampWorkbenchWidthToBounds(view.width, bounds);
  const defaultWidth = clampWorkbenchWidthToBounds(WORKBENCH_WIDTH_DEFAULT, bounds);

  const resetWidth = useCallback(
    () => workbenchController.actions.setWidth({ view: viewKey, width: defaultWidth }),
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
    workbenchController.actions.setWidth({ view: viewKey, width: resize.nextWidth });
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
    workbenchController.actions.setWidth({
      view: viewKey,
      width: clampWorkbenchWidthToBounds(width, bounds),
    });
  };

  const activeTab = activeWorkbenchTab(view, scope, capabilities);
  const panelVisible = current && view.expanded && activeTab !== null;
  useLayoutEffect(() => {
    if (panelVisible) setActiveWidth(panelWidth);
  }, [panelVisible, panelWidth]);

  const mountedTabs = view.tabs.filter((tab) =>
    workbenchTabAvailable(scope, tab.kind, capabilities),
  );
  const fileTab = mountedTabs.find((tab) => tab.kind === "file" || tab.kind === "files");
  const panelTabs = mountedTabs.filter((tab) => tab.kind !== "file" && tab.kind !== "files");

  const fileVisible =
    panelVisible &&
    (activeTab?.kind === "file" || activeTab?.kind === "files") &&
    fileTab !== undefined;

  const renderSlot = (tab: WorkbenchTab, visible: boolean, id: string): ReactElement => {
    const sidebarVisible = sidebars.get(tab.id) ?? tab.kind === "changes";

    return (
      <div
        key={id}
        id={`${viewKey}-panel-${id}`}
        role="tabpanel"
        aria-labelledby={`${viewKey}-tab-${tab.id}`}
        hidden={!visible}
        aria-hidden={!visible}
        inert={!visible ? true : undefined}
        {...props(workbenchStyles.panelSlot, !visible && workbenchStyles.panelSlotHidden)}
      >
        <PanelContent
          tab={tab}
          viewKey={viewKey}
          sessionId={sessionId}
          visible={visible}
          workspacePath={workspacePath}
          workspaceActive={current}
          sidebarVisible={sidebarVisible}
          onToggleSidebar={() =>
            setSidebars((currentSidebars) => new Map(currentSidebars).set(tab.id, !sidebarVisible))
          }
        />
      </div>
    );
  };

  return (
    <section
      ref={panelRef}
      hidden={!current}
      aria-hidden={!current}
      inert={!current ? true : undefined}
      {...props(
        workbenchStyles.panel,
        panelVisible && workbenchStyles.panelOpen,
        !panelVisible && (compact ? workbenchStyles.railHostCompact : workbenchStyles.railHost),
        panelVisible &&
          (view.maximized || bounds.kind === "overlay") &&
          workbenchStyles.panelOverlay,
        !current && workbenchStyles.panelHidden,
      )}
      style={panelVisible ? { width: panelWidth } : undefined}
    >
      {!panelVisible &&
        current &&
        (compact ? (
          <CompactWorkbenchBar
            viewKey={viewKey}
            scope={scope}
            workspacePath={workspacePath}
            capabilities={capabilities}
          />
        ) : (
          <FloatingWorkbenchPanel
            viewKey={viewKey}
            view={view}
            scope={scope}
            sessionId={sessionId}
            workspaceName={workspaceName}
            workspacePath={workspacePath}
            capabilities={capabilities}
          />
        ))}
      <div
        hidden={!panelVisible}
        {...props(workbenchStyles.panelBody, !panelVisible && workbenchStyles.panelHidden)}
      >
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
            {...props(
              resizing && intent.primary,
              workbenchStyles.sash,
              resizing && workbenchStyles.sashActive,
            )}
            onKeyDown={resizeWithKeyboard}
            onPointerDown={beginResize}
            onPointerMove={moveResize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            onDoubleClick={resetWidth}
          />
        )}
        {fileTab !== undefined && renderSlot(fileTab, fileVisible, "files")}
        {panelTabs.map((tab) => renderSlot(tab, panelVisible && activeTab?.id === tab.id, tab.id))}
      </div>
    </section>
  );
}

interface WorkbenchProps {
  readonly workspacePath: string | undefined;
  readonly sessionId: SessionId | undefined;
}

export function Workbench({ workspacePath, sessionId }: WorkbenchProps): ReactElement {
  const host = useHostState();
  const capabilities = clientCapabilities(nyte.host);
  const rootRef = useRef<HTMLElement>(null);

  const [stageWidth, setStageWidth] = useState(
    WORKBENCH_WIDTH_DEFAULT + WORKBENCH_CENTER_WIDTH_MIN,
  );

  const viewKey = workbenchViewKey(workspacePath);
  const snapshot = useWorkbenchSnapshot();

  const visited = useSyncExternalStore(
    subscribeVisited,
    () => visitedViews,
    () => visitedViews,
  );

  useLayoutEffect(() => visitWorkbenchView(viewKey), [viewKey]);
  const views = visited.includes(viewKey) ? visited : [...visited, viewKey];

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
    <aside ref={rootRef} {...props(workbenchStyles.root)} aria-label="Workbench">
      {views.map((key) => {
        const current = key === viewKey;
        const viewWorkspacePath = key === WORKBENCH_HOME_VIEW_KEY ? undefined : key;

        return (
          <WorkbenchViewHost
            key={key}
            viewKey={key}
            view={snapshot.views.get(key) ?? workbenchController.getView(key)}
            current={current}
            scope={current ? workbenchScope(viewWorkspacePath) : { kind: "pathless" }}
            sessionId={current ? sessionId : undefined}
            stageWidth={stageWidth}
            workspaceName={host.data?.workspace?.name}
            capabilities={capabilities}
            workspacePath={viewWorkspacePath ?? null}
          />
        );
      })}
    </aside>
  );
}
