import { workbenchStyles } from "./workbench.stylex.ts";
import * as stylex from "@stylexjs/stylex";
import { Button } from "@nyte-ai/ui";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, ReactElement, ReactNode } from "react";
import type { SessionId } from "@nyte-ai/protocol";
import { changesFromTurns } from "@nyte-ai/client";
import { Icon, PanelToggleIcon } from "../components/icons";
import type { IconName } from "../components/icons";
import { focus, IconButton, ToggleIconButton } from "../components/ui";
import { useHostState, useSessionSnapshot } from "../queries.ts";
import {
  activeWorkbenchTab,
  clampWorkbenchWidthToBounds,
  defaultWorkbenchTab,
  WORKBENCH_ACTIVE_WIDTH_VARIABLE,
  WORKBENCH_CENTER_WIDTH_MIN,
  WORKBENCH_WIDTH_DEFAULT,
  workbenchController,
  workbenchScopeForTarget,
  workbenchTabAvailable,
  workbenchTabLabel,
  workbenchTabs,
  workbenchViewIdentity,
  workbenchViewKey,
  workbenchWidthBounds,
  useWorkbenchSnapshot,
} from "./controller";
import type {
  WorkbenchScope,
  WorkbenchTab,
  WorkbenchTabId,
  WorkbenchTabKind,
  WorkbenchTarget,
  WorkbenchViewKey,
  WorkbenchViewState,
} from "./controller";
import { terminalActions, useTerminalRuntime } from "./terminal-store";
import { BrowserPanel } from "./browser-panel";
import { FilesPanel } from "./files-panel.tsx";
import { useFileTabs } from "./file-store.ts";
import { TerminalPanel } from "./terminal-panel";
import { ChangesPanel } from "./changes-panel";

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
    <Button
      unstyled
      type="button"
      title={title}
      {...stylex.props(workbenchStyles.railRow, focus.ring)}
      onClick={onClick}
    >
      <span {...stylex.props(workbenchStyles.railIcon)}>
        <Icon name={icon} size={14} />
      </span>
      <span {...stylex.props(workbenchStyles.railLabel)}>{label}</span>
      {children}
    </Button>
  );
}

function DoubleChevron({ back = false }: { readonly back?: boolean }): ReactElement {
  return (
    <span
      {...stylex.props(workbenchStyles.doubleChevron, back && workbenchStyles.doubleChevronBack)}
    >
      <Icon name="chevron-right" size={11} />
      <span {...stylex.props(workbenchStyles.doubleChevronTrail)}>
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
      {...stylex.props(workbenchStyles.railStats)}
    >
      {stats.added > 0 && <span {...stylex.props(workbenchStyles.railAdded)}>+{stats.added}</span>}
      {stats.removed > 0 && (
        <span {...stylex.props(workbenchStyles.railRemoved)}>-{stats.removed}</span>
      )}
    </span>
  );
}

function openWorkbenchTab({
  view,
  kind,
  workspacePath,
}: {
  readonly view: WorkbenchViewKey;
  readonly kind: WorkbenchTabKind;
  readonly workspacePath: string | null;
}): void {
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
}: {
  readonly viewKey: WorkbenchViewKey;
  readonly view: WorkbenchViewState;
  readonly scope: WorkbenchScope;
  readonly sessionId: SessionId | undefined;
  readonly workspaceName: string | undefined;
  readonly workspacePath: string | null;
}): ReactElement {
  const terminals = useTerminalRuntime();
  const files = useFileTabs(viewKey);
  const visibleTabs = view.tabs.filter((tab) => workbenchTabAvailable(scope, tab.kind));

  return (
    <nav aria-label="Workbench navigation" {...stylex.props(workbenchStyles.rail)}>
      <section {...stylex.props(workbenchStyles.railSection)}>
        <div {...stylex.props(workbenchStyles.railHeading)}>
          <span {...stylex.props(workbenchStyles.railHeadingText)}>Open Tabs</span>
          <Button
            unstyled
            type="button"
            aria-label="Collapse workbench"
            title="Collapse workbench"
            {...stylex.props(workbenchStyles.chevron, focus.ring)}
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

      <section {...stylex.props(workbenchStyles.railSection)}>
        <div {...stylex.props(workbenchStyles.railHeading)}>
          <span {...stylex.props(workbenchStyles.railHeadingText)}>
            {workspaceName === undefined ? "On This Mac" : `On ${workspaceName}`}
          </span>
        </div>
        {workbenchTabs(scope).map((kind) => (
          <RailRow
            key={kind}
            icon={tabIcons[kind]}
            label={workbenchTabLabel(kind)}
            onClick={() => openWorkbenchTab({ view: viewKey, kind, workspacePath })}
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
}: {
  readonly viewKey: WorkbenchViewKey;
  readonly scope: WorkbenchScope;
  readonly workspacePath: string | null;
}): ReactElement {
  return (
    <nav aria-label="Workbench navigation" {...stylex.props(workbenchStyles.iconRail)}>
      <IconButton
        icon={<DoubleChevron back />}
        label="Expand workbench"
        onClick={() => workbenchController.actions.toggleCollapsed({ view: viewKey })}
      />
      <span aria-hidden="true" {...stylex.props(workbenchStyles.iconRailDivider)} />
      {workbenchTabs(scope).map((kind) => (
        <IconButton
          key={kind}
          icon={tabIcons[kind]}
          label={`Open ${workbenchTabLabel(kind)}`}
          onClick={() => openWorkbenchTab({ view: viewKey, kind, workspacePath })}
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
            workbenchController.actions.updateTab({
              view: viewKey,
              id: tab.id,
              kind: "changes",
              patch: { ...tab, scrollTop: Math.max(0, scrollTop) },
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
            <ToggleIconButton
              icon={<PanelToggleIcon side="right" visible={sidebarVisible} />}
              label={sidebarVisible ? "Hide visit history" : "Show visit history"}
              pressed={sidebarVisible}
              onPressedChange={onToggleSidebar}
            />
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
  target,
  view,
  current,
  scope,
  stageWidth,
  workspaceName,
  workspacePath,
}: {
  readonly viewKey: WorkbenchViewKey;
  readonly target: WorkbenchTarget;
  readonly view: WorkbenchViewState;
  readonly current: boolean;
  readonly scope: WorkbenchScope;
  readonly stageWidth: number;
  readonly workspaceName: string | undefined;
  readonly workspacePath: string | null;
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

  const activeTab = activeWorkbenchTab(view, scope);
  const panelVisible = current && view.expanded && activeTab !== null;
  useLayoutEffect(() => {
    if (panelVisible) setActiveWidth(panelWidth);
  }, [panelVisible, panelWidth]);

  const mountedTabs = view.tabs.filter((tab) => workbenchTabAvailable(scope, tab.kind));
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
        {...stylex.props(workbenchStyles.panelSlot, !visible && workbenchStyles.panelSlotHidden)}
      >
        <PanelContent
          tab={tab}
          viewKey={viewKey}
          sessionId={target.kind === "session" ? target.sessionId : undefined}
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
      {...stylex.props(
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
          <CompactWorkbenchBar viewKey={viewKey} scope={scope} workspacePath={workspacePath} />
        ) : (
          <FloatingWorkbenchPanel
            viewKey={viewKey}
            view={view}
            scope={scope}
            sessionId={target.kind === "session" ? target.sessionId : undefined}
            workspaceName={workspaceName}
            workspacePath={workspacePath}
          />
        ))}
      <div
        hidden={!panelVisible}
        {...stylex.props(workbenchStyles.panelBody, !panelVisible && workbenchStyles.panelHidden)}
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
            {...stylex.props(workbenchStyles.sash, resizing && workbenchStyles.sashActive)}
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
  readonly target: WorkbenchTarget;
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
    <aside ref={rootRef} {...stylex.props(workbenchStyles.root)} aria-label="Workbench">
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
            workspaceName={host.data?.workspace?.name}
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
