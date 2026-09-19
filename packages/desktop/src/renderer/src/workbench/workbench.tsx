/**
 * Eager workbench controller. Open panels stay mounted while hidden; closing a
 * tab releases its panel. The window titlebar owns the tab strip. Collapsing
 * leaves a compact bar of the tabs this scope can open, the way Cursor
 * collapses a part rather than widening it into a second sidebar.
 *
 * Based on https://github.com/interfaces-lab/honk/blob/main/packages/app/src/workbench.tsx
 */
import { create, props } from "@stylexjs/stylex";
import { Button } from "@nyte-ai/ui";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, ReactElement, ReactNode } from "react";
import type { SessionId } from "@nyte-ai/protocol";
import { changesFromTurns } from "@nyte-ai/client";
import { Icon, PanelToggleIcon } from "../components/icons";
import type { IconName } from "../components/icons";
import { focus, IconButton, ToggleIconButton } from "../components/ui";
import { useHostState, useSessionSnapshot } from "../queries.ts";
import { glyph, layer, workbench } from "../theme/schema.stylex";
import { t } from "../theme/vars.stylex";
import {
  clampWorkbenchWidthToBounds,
  workbenchTabAvailable,
  activeWorkbenchTab,
  workbenchTabLabel,
  workbenchTabs,
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
import { FilesPanel } from "./files-panel.tsx";
import { useFileTabs, fileActions } from "./file-store.ts";
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
    minHeight: 0,
    backgroundColor: t.bgBase,
  },
  panelOpen: {
    minWidth: workbench.panelWidth,
    borderInlineStartWidth: 1,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: t.strokeTertiary,
  },
  railHost: { width: workbench.railWidth, minWidth: workbench.railWidth },
  /** The compact bar's 34px box plus its 6px margins. */
  railHostCompact: { width: 46, minWidth: 46 },
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
  /** The floating panel: the always-present list of what this scope can open. */
  rail: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    width: "100%",
    minWidth: 0,
    paddingBlock: 4,
    paddingInline: 8,
    color: t.textSecondary,
  },
  railSection: { display: "flex", flexDirection: "column", gap: 1, minWidth: 0 },
  railHeading: {
    display: "flex",
    alignItems: "center",
    minHeight: 24,
    paddingInline: 6,
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
  /** The floating panel's collapse control, sized to its heading row. */
  chevron: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 24,
    height: 24,
    marginInlineEnd: -4,
    padding: 0,
    borderStyle: "none",
    borderRadius: t.radiusBase,
    backgroundColor: { default: "transparent", ":hover": t.fillGhostHover },
    color: t.iconTertiary,
    cursor: "pointer",
  },
  /** Two chevrons overlap into one glyph; the icon set has no chevron-left. */
  doubleChevron: { display: "inline-flex", alignItems: "center" },
  doubleChevronBack: { transform: "scaleX(-1)" },
  doubleChevronTrail: { display: "inline-flex", marginInlineStart: -4 },
  railRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    width: "100%",
    minWidth: 0,
    minHeight: 28,
    paddingBlock: 2,
    paddingInline: 6,
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
    width: glyph.box,
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
  /**
   * The collapsed workbench: a compact bar of the tabs this scope can open,
   * sized to hold one 28px icon button inside its 2px padding and hairline
   * border. `railHost` above reserves that 34px box plus its 6px margins.
   */
  iconRail: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
    boxSizing: "border-box",
    width: 34,
    marginBlockStart: 4,
    marginInline: 6,
    padding: 2,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: t.strokeTertiary,
    /** Concentric with the 8px buttons inside it: 8 + 2px of padding. */
    borderRadius: 10,
    backgroundColor: t.bgElevated,
    color: t.textSecondary,
    boxShadow: `0 1px 2px ${t.shadowControlColor}`,
  },
  iconRailDivider: {
    height: 1,
    marginInline: 2,
    backgroundColor: t.strokeTertiary,
  },
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

const tabIcons = {
  files: "file",
  changes: "git-branch",
  browser: "globe",
  terminal: "console",
  agents: "robot",
} satisfies Record<WorkbenchTabId, IconName>;

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
      {...props(styles.railRow, focus.ring)}
      onClick={onClick}
    >
      <span {...props(styles.railIcon)}>
        <Icon name={icon} size={14} />
      </span>
      <span {...props(styles.railLabel)}>{label}</span>
      {children}
    </Button>
  );
}

/**
 * The control that swaps the floating panel for the compact bar. It always
 * points away from the surface it would leave, so the same glyph reads as
 * collapse on the panel and expand on the bar.
 */
function DoubleChevron({ back = false }: { readonly back?: boolean }): ReactElement {
  return (
    <span {...props(styles.doubleChevron, back && styles.doubleChevronBack)}>
      <Icon name="chevron-right" size={11} />
      <span {...props(styles.doubleChevronTrail)}>
        <Icon name="chevron-right" size={11} />
      </span>
    </span>
  );
}

/**
 * The declared line counts of one session, folded from the transcript the
 * chat in this pane is already observing. The floating panel always names the
 * active pane's session, so this shares that observation rather than opening a
 * read of its own.
 */
function RailChangeStats({ sessionId }: { readonly sessionId: SessionId }): ReactElement | null {
  const snapshot = useSessionSnapshot(sessionId);
  const transcript = snapshot.data?.transcript;
  const stats = useMemo(
    () =>
      changesFromTurns(transcript ?? []).reduce(
        (total, file) => ({
          added: total.added + file.added,
          removed: total.removed + file.removed,
        }),
        { added: 0, removed: 0 },
      ),
    [transcript],
  );
  if (stats.added === 0 && stats.removed === 0) return null;
  return (
    <span
      aria-label={`${String(stats.added)} added, ${String(stats.removed)} removed`}
      {...props(styles.railStats)}
    >
      {stats.added > 0 && <span {...props(styles.railAdded)}>+{stats.added}</span>}
      {stats.removed > 0 && <span {...props(styles.railRemoved)}>-{stats.removed}</span>}
    </span>
  );
}

/** Opening the Terminal tab with no shell yet has to start one first. */
function openWorkbenchTab({
  viewKey,
  tab,
  terminalCount,
  workspacePath,
}: {
  readonly viewKey: WorkbenchViewKey;
  readonly tab: WorkbenchTabId;
  readonly terminalCount: number;
  readonly workspacePath: string | null;
}): void {
  if (tab === "terminal" && terminalCount === 0) {
    void terminalActions.create(viewKey, workspacePath);
  }
  workbenchController.actions.openTab(viewKey, tab);
}

/** The floating panel: what this scope can open, and what is already open. */
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
  const terminals = useTerminals(viewKey);
  const files = useFileTabs(viewKey);
  const openTabs = view.openTabs.filter(
    (tab) => tab !== "terminal" && workbenchTabAvailable(scope, tab),
  );

  return (
    <nav aria-label="Workbench navigation" {...props(styles.rail)}>
      <section {...props(styles.railSection)}>
        <div {...props(styles.railHeading)}>
          <span {...props(styles.railHeadingText)}>Open Tabs</span>
          <Button
            unstyled
            type="button"
            aria-label="Collapse workbench"
            title="Collapse workbench"
            {...props(styles.chevron, focus.ring)}
            onClick={() => workbenchController.actions.toggleCollapsed(viewKey)}
          >
            <DoubleChevron />
          </Button>
        </div>
        {openTabs.flatMap((tab) =>
          tab === "files" && files.tabs.length > 0
            ? files.tabs.map((file) => (
                <RailRow
                  key={`file:${file.path}`}
                  icon="file"
                  label={file.displayPath}
                  title={`${file.displayPath}${file.dirty ? ", unsaved changes" : ""}`}
                  onClick={() => fileActions.select(viewKey, file.path)}
                />
              ))
            : [
                <RailRow
                  key={tab}
                  icon={tabIcons[tab]}
                  label={workbenchTabLabel(tab)}
                  onClick={() => workbenchController.actions.openTab(viewKey, tab)}
                />,
              ],
        )}
        {view.openTabs.includes("terminal") && terminals.tabs.length === 0 && (
          <RailRow
            icon="console"
            label="Terminal"
            onClick={() => workbenchController.actions.openTab(viewKey, "terminal")}
          />
        )}
        {terminals.tabs.map((terminal) => (
          <RailRow
            key={terminal.id}
            icon="console"
            label={terminal.title}
            title={terminal.cwd}
            onClick={() => {
              terminalActions.select(viewKey, terminal.id);
              workbenchController.actions.openTab(viewKey, "terminal");
            }}
          />
        ))}
      </section>

      <section {...props(styles.railSection)}>
        <div {...props(styles.railHeading)}>
          <span {...props(styles.railHeadingText)}>
            {workspaceName === undefined ? "On This Mac" : `On ${workspaceName}`}
          </span>
        </div>
        {workbenchTabs(scope).map((tab) => (
          <RailRow
            key={tab}
            icon={tabIcons[tab]}
            label={
              tab === "terminal" && terminals.tabs.length > 1
                ? `${String(terminals.tabs.length)} Terminals`
                : workbenchTabLabel(tab)
            }
            onClick={() =>
              openWorkbenchTab({
                viewKey,
                tab,
                terminalCount: terminals.tabs.length,
                workspacePath,
              })
            }
          >
            {tab === "changes" && sessionId !== undefined && (
              <RailChangeStats sessionId={sessionId} />
            )}
          </RailRow>
        ))}
      </section>
    </nav>
  );
}

/** The floating panel collapsed to its icons. */
function CompactWorkbenchBar({
  viewKey,
  scope,
  workspacePath,
}: {
  readonly viewKey: WorkbenchViewKey;
  readonly scope: WorkbenchScope;
  readonly workspacePath: string | null;
}): ReactElement {
  const terminals = useTerminals(viewKey);

  return (
    <nav aria-label="Workbench navigation" {...props(styles.iconRail)}>
      <IconButton
        icon={<DoubleChevron back />}
        label="Expand workbench"
        onClick={() => workbenchController.actions.toggleCollapsed(viewKey)}
      />
      <span aria-hidden="true" {...props(styles.iconRailDivider)} />
      {workbenchTabs(scope).map((tab) => (
        <IconButton
          key={tab}
          icon={tabIcons[tab]}
          label={`Open ${workbenchTabLabel(tab)}`}
          onClick={() =>
            openWorkbenchTab({ viewKey, tab, terminalCount: terminals.tabs.length, workspacePath })
          }
        />
      ))}
    </nav>
  );
}

interface PanelContentProps {
  readonly tab: WorkbenchTabId;
  readonly viewKey: WorkbenchViewKey;
  readonly sessionId: SessionId | undefined;
  readonly view: WorkbenchViewState;
  readonly visible: boolean;
  readonly workspaceActive: boolean;
  readonly workspacePath: string | null;
  readonly sidebarVisible: boolean;
  readonly onToggleSidebar: () => void;
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
  sidebarVisible,
  onToggleSidebar,
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
          fileTreeVisible={sidebarVisible}
          onScopeChange={(scope) => workbenchController.actions.selectChangesScope(viewKey, scope)}
          onToggleFileTree={onToggleSidebar}
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
          historyVisible={sidebarVisible}
          url={view.browserUrl}
          onUrlChange={onBrowserUrl}
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
  const files = useFileTabs(viewKey);
  const [sidebars, setSidebars] = useState<Record<WorkbenchTabId, boolean>>({
    files: true,
    changes: true,
    browser: false,
    terminal: false,
    agents: false,
  });
  const panelRef = useRef<HTMLElement>(null);
  const resizeRef = useRef<ResizeState | undefined>(undefined);
  const bounds = workbenchWidthBounds(stageWidth);
  // A stage too narrow for the floating panel forces the compact bar.
  const compact = view.collapsed === "compact" || bounds.kind === "overlay";
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

  const hostVisible = current;
  const activeTab = activeWorkbenchTab(view, scope);
  const panelVisible = hostVisible && view.expanded && activeTab !== null;

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
      hidden={!hostVisible}
      aria-hidden={!hostVisible}
      inert={!hostVisible ? true : undefined}
      {...props(
        styles.panel,
        panelVisible && styles.panelOpen,
        !panelVisible && (compact ? styles.railHostCompact : styles.railHost),
        panelVisible && (view.maximized || bounds.kind === "overlay") && styles.panelOverlay,
        !hostVisible && styles.panelHidden,
      )}
      style={panelVisible ? { width: panelWidth } : undefined}
    >
      {!panelVisible &&
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
      <div hidden={!panelVisible} {...props(styles.panelBody, !panelVisible && styles.panelHidden)}>
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
                sidebarVisible={sidebars[tab]}
                onToggleSidebar={() =>
                  setSidebars((current) => ({ ...current, [tab]: !current[tab] }))
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
