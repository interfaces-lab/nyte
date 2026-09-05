/**
 * Eager workbench controller and rail. Open panels stay mounted while hidden;
 * closing a tab releases its panel. The window titlebar owns the tab strip.
 *
 * Based on https://github.com/interfaces-lab/honk/blob/main/packages/app/src/workbench.tsx
 */
import * as stylex from "@stylexjs/stylex";
import { Button as BaseButton } from "@nyte-ai/ui";
import { Toolbar } from "@nyte-ai/ui/primitives";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, ReactElement, ReactNode } from "react";
import type { SessionId } from "@nyte-ai/core";
import { Icon, PanelToggleIcon } from "../components/icons";
import type { IconName } from "../components/icons";
import { focus, IconButton, ToggleIconButton } from "../components/ui";
import { refreshVcs, useHostState, useRunChanges } from "../queries.ts";
import { layer, workbench } from "../theme/schema.stylex";
import { t } from "../theme/vars.stylex";
import {
  clampWorkbenchWidthToBounds,
  workbenchTabAvailable,
  activeWorkbenchTab,
  workbenchTabLabel,
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

import { terminalActions, useTerminals } from "./terminal-store";

import { BrowserPanel } from "./browser-panel";
import { TerminalPanel } from "./terminal-panel";
import { ChangesPanel } from "./changes-panel";
const styles = stylex.create({
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
    minHeight: 0,
    backgroundColor: t.bgBase,
  },
  panelOpen: {
    minWidth: workbench.panelWidth,
    borderInlineStartWidth: 1,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: t.borderSubtle,
  },
  railHost: { width: workbench.railWidth, minWidth: workbench.railWidth },
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
  rail: {
    display: "flex",
    flexDirection: "column",
    gap: 15,
    width: "100%",
    minWidth: 0,
    paddingBlock: 5,
    paddingInline: 8,
    color: t.textSecondary,
  },
  railSection: { display: "flex", flexDirection: "column", gap: 1, minWidth: 0 },
  railHeading: {
    display: "flex",
    alignItems: "center",
    minHeight: 24,
    paddingInline: 7,
    color: t.textTertiary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
  },
  railHeadingText: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  railCollapse: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 24,
    height: 24,
    marginInlineEnd: -5,
    padding: 0,
    borderStyle: "none",
    borderRadius: t.radiusBase,
    backgroundColor: { default: "transparent", ":hover": t.fillGhostHover },
    color: t.iconTertiary,
    cursor: "pointer",
  },
  railCollapseGlyph: { display: "inline-flex", marginInlineStart: -5 },
  railRow: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    width: "100%",
    minWidth: 0,
    minHeight: 28,
    paddingBlock: 3,
    paddingInline: 7,
    borderStyle: "none",
    borderRadius: t.radiusBase,
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover) and (pointer: fine)": t.fillGhostHover },
      ":active": t.fillGhostSelected,
    },
    color: t.textSecondary,
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
    textAlign: "start",
    cursor: "pointer",
  },
  railIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 15,
    flexShrink: 0,
    color: t.iconSecondary,
  },
  railLabel: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  railStats: {
    display: "inline-flex",
    gap: 6,
    flexShrink: 0,
    fontVariantNumeric: "tabular-nums",
  },
  railAdded: { color: t.textSuccess },
  railRemoved: { color: t.textDanger },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    height: workbench.headerHeight,
    flexShrink: 0,
    paddingInline: 8,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: t.borderSubtle,
  },
  headerLabel: { color: t.textSecondary, fontSize: t.fontSm, paddingInline: 4 },
  spacer: { flex: 1, minWidth: 0 },
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

function RailRow({
  icon,
  children,
  title,
  onClick,
}: {
  readonly icon: IconName;
  readonly children: ReactNode;
  readonly title?: string;
  readonly onClick: () => void;
}): ReactElement {
  return (
    <BaseButton
      unstyled
      type="button"
      title={title}
      {...stylex.props(styles.railRow, focus.ring)}
      onClick={onClick}
    >
      <span {...stylex.props(styles.railIcon)}>
        <Icon name={icon} size={14} />
      </span>
      {children}
    </BaseButton>
  );
}

function WorkbenchRail({
  viewKey,
  view,
  scope,
  sessionId,
  workspaceName,
  workspacePath,
  onShowFiles,
}: {
  readonly viewKey: WorkbenchViewKey;
  readonly view: WorkbenchViewState;
  readonly scope: WorkbenchScope;
  readonly sessionId: SessionId | undefined;
  readonly workspaceName: string | undefined;
  readonly workspacePath: string | null;
  readonly onShowFiles: () => void;
}): ReactElement {
  const changes = useRunChanges(sessionId, scope.kind === "project");
  const stats = (changes.data ?? []).reduce(
    (total, file) => ({ added: total.added + file.added, removed: total.removed + file.removed }),
    { added: 0, removed: 0 },
  );
  const tabs = view.openTabs.filter(
    (tab) => tab !== "terminal" && workbenchTabAvailable(scope, tab),
  );
  const terminals = useTerminals(viewKey);

  return (
    <nav aria-label="Workbench navigation" {...stylex.props(styles.rail)}>
      <section {...stylex.props(styles.railSection)}>
        <div {...stylex.props(styles.railHeading)}>
          <span {...stylex.props(styles.railHeadingText)}>Open Tabs</span>
          <BaseButton
            unstyled
            type="button"
            aria-label="Show workbench"
            {...stylex.props(styles.railCollapse, focus.ring)}
            onClick={() => workbenchController.actions.toggle(viewKey)}
          >
            <Icon name="chevron-right" size={11} />
            <span {...stylex.props(styles.railCollapseGlyph)}>
              <Icon name="chevron-right" size={11} />
            </span>
          </BaseButton>
        </div>
        {tabs.map((tab) => (
          <RailRow
            key={tab}
            icon={tab === "changes" ? "git-branch" : "globe"}
            onClick={() => workbenchController.actions.openTab(viewKey, tab)}
          >
            <span {...stylex.props(styles.railLabel)}>{workbenchTabLabel(tab)}</span>
          </RailRow>
        ))}
        {view.openTabs.includes("terminal") && terminals.tabs.length === 0 && (
          <RailRow
            icon="console"
            onClick={() => workbenchController.actions.openTab(viewKey, "terminal")}
          >
            <span {...stylex.props(styles.railLabel)}>Terminal</span>
          </RailRow>
        )}
        {terminals.tabs.map((terminal) => (
          <RailRow
            key={terminal.id}
            icon="console"
            title={terminal.cwd}
            onClick={() => {
              terminalActions.select(viewKey, terminal.id);
              workbenchController.actions.openTab(viewKey, "terminal");
            }}
          >
            <span {...stylex.props(styles.railLabel)}>{terminal.title}</span>
          </RailRow>
        ))}
      </section>

      <section {...stylex.props(styles.railSection)}>
        <div {...stylex.props(styles.railHeading)}>
          <span {...stylex.props(styles.railHeadingText)}>
            {workspaceName === undefined ? "On This Mac" : `On ${workspaceName}`}
          </span>
        </div>
        {scope.kind === "project" && (
          <RailRow
            icon="git"
            onClick={() => workbenchController.actions.openTab(viewKey, "changes")}
          >
            <span {...stylex.props(styles.railLabel)}>Changes</span>
            {(stats.added > 0 || stats.removed > 0) && (
              <span
                aria-label={`${String(stats.added)} added, ${String(stats.removed)} removed`}
                {...stylex.props(styles.railStats)}
              >
                {stats.added > 0 && <span {...stylex.props(styles.railAdded)}>+{stats.added}</span>}
                {stats.removed > 0 && (
                  <span {...stylex.props(styles.railRemoved)}>-{stats.removed}</span>
                )}
              </span>
            )}
          </RailRow>
        )}
        <RailRow
          icon="globe"
          onClick={() => workbenchController.actions.openTab(viewKey, "browser")}
        >
          <span {...stylex.props(styles.railLabel)}>Browser</span>
        </RailRow>
        <RailRow
          icon="console"
          onClick={() => {
            if (terminals.tabs.length === 0) void terminalActions.create(viewKey, workspacePath);
            workbenchController.actions.openTab(viewKey, "terminal");
          }}
        >
          <span {...stylex.props(styles.railLabel)}>
            {terminals.tabs.length > 1 ? `${String(terminals.tabs.length)} Terminals` : "Terminal"}
          </span>
        </RailRow>
        {scope.kind === "project" && (
          <RailRow icon="file" onClick={onShowFiles}>
            <span {...stylex.props(styles.railLabel)}>Files</span>
          </RailRow>
        )}
      </section>
    </nav>
  );
}

function ChangesToolbar({
  sidebarVisible,
  onToggleSidebar,
}: {
  readonly sidebarVisible: boolean;
  readonly onToggleSidebar: () => void;
}): ReactElement {
  return (
    <Toolbar.Root aria-label="Changes actions" {...stylex.props(styles.header)}>
      <Icon name="git" size={14} />
      <span {...stylex.props(styles.headerLabel)}>Uncommitted</span>
      <span {...stylex.props(styles.spacer)} />
      <Toolbar.Button
        render={<IconButton icon="refresh" label="Refresh changes" onClick={refreshVcs} />}
      />
      <Toolbar.Button
        render={
          <ToggleIconButton
            icon={<PanelToggleIcon side="right" visible={sidebarVisible} />}
            label={sidebarVisible ? "Hide file tree" : "Show file tree"}
            pressed={sidebarVisible}
            onPressedChange={onToggleSidebar}
          />
        }
      />
    </Toolbar.Root>
  );
}

interface PanelContentProps {
  readonly tab: WorkbenchTabId;
  readonly viewKey: WorkbenchViewKey;
  readonly sessionId: SessionId | undefined;
  readonly view: WorkbenchViewState;
  readonly visible: boolean;
  readonly workspacePath: string | null;
  readonly sidebarVisible: boolean;
  readonly onToggleSidebar: () => void;
  readonly onSelectPath: (path: string | undefined) => void;
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
  sidebarVisible,
  onToggleSidebar,
  onSelectPath,
  onChangesScroll,
  onBrowserUrl,
}: PanelContentProps): ReactElement {
  switch (tab) {
    case "changes":
      return (
        <>
          <ChangesToolbar sidebarVisible={sidebarVisible} onToggleSidebar={onToggleSidebar} />
          <ChangesPanel
            sessionId={sessionId}
            selectedPath={view.selectedPath}
            scrollTop={view.scrollTop.changes}
            fileTreeVisible={sidebarVisible}
            onSelectPath={onSelectPath}
            onScrollTop={onChangesScroll}
          />
        </>
      );
    case "browser":
      return (
        <BrowserPanel
          surface={viewKey}
          visible={visible}
          historyVisible={sidebarVisible}
          url={view.browserUrl}
          onUrlChange={onBrowserUrl}
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
      return <TerminalPanel owner={viewKey} workspacePath={workspacePath} visible={visible} />;
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
  const activeTerminalId = useTerminals(viewKey).activeId;
  const [sidebars, setSidebars] = useState<Record<WorkbenchTabId, boolean>>({
    changes: true,
    browser: false,
    terminal: false,
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

  const hostVisible = current;
  const activeTab = activeWorkbenchTab(view, scope);
  const panelVisible = hostVisible && view.expanded && activeTab !== null;

  useLayoutEffect(() => {
    if (panelVisible) setActiveWidth(panelWidth);
  }, [panelVisible, panelWidth]);
  const mountedTabs = view.openTabs.filter((tab) => workbenchTabAvailable(scope, tab));

  return (
    <section
      ref={panelRef}
      hidden={!hostVisible}
      aria-hidden={!hostVisible}
      inert={!hostVisible ? true : undefined}
      {...stylex.props(
        styles.panel,
        panelVisible && styles.panelOpen,
        !panelVisible && styles.railHost,
        panelVisible && (view.maximized || bounds.kind === "overlay") && styles.panelOverlay,
        !hostVisible && styles.panelHidden,
      )}
      style={panelVisible ? { width: panelWidth } : undefined}
    >
      {!panelVisible && (
        <WorkbenchRail
          viewKey={viewKey}
          view={view}
          scope={scope}
          sessionId={target.kind === "session" ? target.sessionId : undefined}
          workspaceName={workspaceName}
          workspacePath={workspacePath}
          onShowFiles={() => {
            setSidebars((current) => ({ ...current, changes: true }));
            workbenchController.actions.openTab(viewKey, "changes");
          }}
        />
      )}
      <div
        hidden={!panelVisible}
        {...stylex.props(styles.panelBody, !panelVisible && styles.panelHidden)}
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
            {...stylex.props(styles.sash, resizing && styles.sashActive)}
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
              aria-labelledby={`${viewKey}-tab-${tab === "terminal" ? activeTerminalId : tab}`}
              hidden={!tabVisible}
              aria-hidden={!tabVisible}
              inert={!tabVisible ? true : undefined}
              {...stylex.props(styles.panelSlot, !tabVisible && styles.panelSlotHidden)}
            >
              <PanelContent
                tab={tab}
                viewKey={viewKey}
                sessionId={target.kind === "session" ? target.sessionId : undefined}
                view={view}
                visible={tabVisible}
                workspacePath={workspacePath}
                sidebarVisible={sidebars[tab]}
                onToggleSidebar={() =>
                  setSidebars((current) => ({ ...current, [tab]: !current[tab] }))
                }
                onSelectPath={selectPath}
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

export interface WorkbenchProps {
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
    <aside ref={rootRef} {...stylex.props(styles.root)} aria-label="Workbench">
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
