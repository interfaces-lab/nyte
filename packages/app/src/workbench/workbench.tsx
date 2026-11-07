import { workbenchStyles } from "./workbench.stylex.ts";
import { props } from "@stylexjs/stylex";
import { useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, ReactElement } from "react";
import { clientCapabilities } from "../contract/client-actions.ts";
import type { ClientCapabilities } from "../contract/client-actions.ts";
import { nyte } from "../contract/nyte.ts";
import { hairline } from "@nyte-ai/ui/styles/hairline.stylex";
import { Icon, PanelToggleIcon } from "@nyte-ai/ui/icon";
import { Row } from "@nyte-ai/ui/row";
import { Toggle } from "@nyte-ai/ui/toggle";
import { useHostState } from "../data/host.ts";
import {
  clampWorkbenchWidthToBounds,
  WORKBENCH_CENTER_WIDTH_MIN,
  DEFAULT_WIDTH,
  setActiveWorkbenchWidth,
  workbenchPanelWidth,
  workbenchWidthBounds,
} from "./width.ts";
import {
  browserSurface,
  DEFAULT_VIEW,
  EDITOR_SLOT,
  tabSlot,
  WORKBENCH_KINDS,
  workbenchLaunchers,
  workbenchShowsChat,
} from "./model.ts";
import type {
  WorkbenchScope,
  WorkbenchTab,
  WorkbenchViewKey,
  WorkbenchViewState,
} from "./model.ts";
import { workbenchScope, workbenchViewKey, workspacePathForView } from "./paths.ts";
import { shownWorkbenchTab, visibleTabs } from "./selectors.ts";
import { useWorkbenchSnapshot, workbench } from "./store.ts";
import type { ChangesTabPatch } from "./view-reducer.ts";
import { launch, openUrl } from "./commands.ts";
import { CompactRail, Rail } from "./rail.tsx";
import { BrowserPanel } from "./browser/browser-panel";
import { CanvasPanel } from "../canvas/canvas-panel.tsx";
import { Deferred, loadDeferred } from "../lib/deferred.tsx";
import { preferences, useSetting } from "../preferences/index.ts";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";

const MOUNTED_VIEWS = 3;

interface ResizeState {
  readonly pointerId: number;
  readonly startX: number;
  readonly startWidth: number;
  nextWidth: number;
}

function prefetchWorkbench(): () => void {
  if (!("requestIdleCallback" in window)) return () => undefined;

  let idle = 0;
  let stopped = false;

  const loadPanels = (): void => {
    if (!stopped) idle = requestIdleCallback(() => void loadDeferred("workbench").catch(() => {}));
  };

  const frame = requestAnimationFrame(() => {
    idle = requestIdleCallback(() => {
      void loadDeferred("ghostty")
        .then(({ loadGhostty }) => loadGhostty())
        .catch(() => {})
        .finally(loadPanels);
    });
  });

  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
    cancelIdleCallback(idle);
  };
}

function PanelContent({
  tab,
  viewKey,
  visible,
  workspacePath,
  workspaceActive,
  sidebarVisible,
}: {
  readonly tab: WorkbenchTab;
  readonly viewKey: WorkbenchViewKey;
  readonly visible: boolean;
  readonly workspacePath: string | null;
  readonly workspaceActive: boolean;
  readonly sidebarVisible: boolean;
}): ReactElement {
  const uiFontSize = useSetting(preferences.uiFontSize);

  const toggleSidebar = (): void =>
    workbench.dispatch(viewKey, { kind: "toggle-sidebar", slot: tabSlot(tab) });

  switch (tab.kind) {
    case "file":
    case "editor":
      return (
        <Deferred entry="workbench">
          {({ EditorPanel }) => (
            <EditorPanel
              key={uiFontSize}
              viewKey={viewKey}
              visible={visible}
              workspaceActive={workspaceActive}
              sidebarVisible={sidebarVisible}
              onToggleSidebar={toggleSidebar}
            />
          )}
        </Deferred>
      );
    case "changes": {
      const change = (patch: ChangesTabPatch): void =>
        workbench.dispatch(viewKey, {
          kind: "patch",
          id: tab.id,
          change: { kind: "changes", patch },
        });

      return (
        <Deferred entry="workbench">
          {({ ChangesPanel }) => (
            <ChangesPanel
              visible={visible}
              scope={tab.scope}
              selectedPath={tab.selectedPath ?? undefined}
              revealPathRevision={tab.pathRevealRevision}
              scrollTop={tab.scrollTop}
              fileTreeVisible={sidebarVisible}
              onScopeChange={(scope) => change({ scope, selectedPath: null, scrollTop: 0 })}
              onToggleFileTree={toggleSidebar}
              onScrollTop={(scrollTop, selectedPath) =>
                change({ scrollTop: Math.max(0, scrollTop), selectedPath: selectedPath ?? null })
              }
              onOpenLink={
                nyte.host.browser === undefined ? undefined : (url) => openUrl(viewKey, url)
              }
            />
          )}
        </Deferred>
      );
    }

    case "browser":
      return (
        <BrowserPanel
          surface={browserSurface(tab)}
          visible={visible}
          historyVisible={sidebarVisible}
          onToggleHistory={toggleSidebar}
          url={tab.url}
          onUrlChange={(url) =>
            workbench.dispatch(viewKey, {
              kind: "patch",
              id: tab.id,
              change: { kind: "browser", patch: { url } },
            })
          }
          workspacePath={workspacePath}
          toolbarActions={
            <Toggle
              iconOnly
              indicator="glyph"
              aria-label={sidebarVisible ? "Hide visit history" : "Show visit history"}
              pressed={sidebarVisible}
              onPressedChange={toggleSidebar}
            >
              <PanelToggleIcon side="right" visible={sidebarVisible} />
            </Toggle>
          }
        />
      );
    case "canvas":
      return (
        <CanvasPanel
          sessionId={tab.sessionId}
          part={tab.part}
          visible={visible}
          pinned={tab.pinned}
          onPin={(pinned) =>
            workbench.dispatch(viewKey, {
              kind: "patch",
              id: tab.id,
              change: { kind: "canvas", patch: { pinned } },
            })
          }
        />
      );
    case "terminal":
      return (
        <Deferred entry="workbench">
          {({ TerminalPanel }) => (
            <TerminalPanel tabId={tab.id} workspacePath={workspacePath} visible={visible} />
          )}
        </Deferred>
      );
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
  stageWidth,
  workspaceName,
  capabilities,
}: {
  readonly viewKey: WorkbenchViewKey;
  readonly view: WorkbenchViewState;
  readonly current: boolean;
  readonly scope: WorkbenchScope;
  readonly stageWidth: number;
  readonly workspaceName: string | undefined;
  readonly capabilities: ClientCapabilities;
}): ReactElement {
  const workspacePath = workspacePathForView(viewKey) ?? null;
  const [resizing, setResizing] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);
  const resizeRef = useRef<ResizeState | undefined>(undefined);
  const bounds = workbenchWidthBounds(stageWidth);
  const compact = view.collapsed === "compact" || bounds.narrow;
  const maximized = view.layout.kind === "maximized";
  const chatShowing = workbenchShowsChat(view.layout);
  const panelWidth = maximized ? stageWidth : workbenchPanelWidth(view.width, stageWidth);

  const setWidth = (width: number): void =>
    workbench.dispatch(viewKey, { kind: "set-width", pixels: width });

  const resetWidth = () =>
    workbench.dispatch(viewKey, { kind: "set-width", pixels: DEFAULT_WIDTH.pixels });

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

    const panel = panelRef.current;

    if (panel !== null) {
      const preview = props(workbenchStyles.panelWidth(resize.nextWidth)).style;

      for (const entry of Object.entries(preview ?? {})) {
        panel.style.setProperty(entry[0], String(entry[1]));
      }

      setActiveWorkbenchWidth(resize.nextWidth);
    }
  };

  const endResize = (event: PointerEvent<HTMLDivElement>): void => {
    const resize = resizeRef.current;

    if (resize === undefined || resize.pointerId !== event.pointerId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    resizeRef.current = undefined;
    setWidth(resize.nextWidth);
    setResizing(false);
  };

  const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>): void => {
    const width =
      event.key === "ArrowLeft"
        ? panelWidth + stageWidth * 0.02
        : event.key === "ArrowRight"
          ? panelWidth - stageWidth * 0.02
          : event.key === "Home"
            ? bounds.min
            : event.key === "End"
              ? bounds.max
              : undefined;

    if (width === undefined) return;
    event.preventDefault();
    setWidth(clampWorkbenchWidthToBounds(width, bounds));
  };

  const panelVisible = current && view.expanded;
  const panelShown = panelVisible && !chatShowing;
  const panelHidden = !current || (panelVisible && chatShowing);

  const attachPanel = (panel: HTMLElement | null): (() => void) | undefined => {
    panelRef.current = panel;

    if (!panelVisible || panel === null) return undefined;

    if (chatShowing) {
      setActiveWorkbenchWidth(stageWidth);

      return undefined;
    }

    const update = (): void => setActiveWorkbenchWidth(panel.getBoundingClientRect().width);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(panel);
    window.addEventListener("resize", update);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  };

  const mountedTabs = visibleTabs(view, scope, capabilities);
  const editorTab = mountedTabs.find((tab) => tabSlot(tab) === EDITOR_SLOT);
  const panelTabs = mountedTabs.filter((tab) => tabSlot(tab) !== EDITOR_SLOT);
  const shownTab = current ? shownWorkbenchTab(view, scope, capabilities) : null;
  const editorVisible = shownTab !== null && tabSlot(shownTab) === EDITOR_SLOT;

  const renderSlot = (tab: WorkbenchTab, visible: boolean): ReactElement => {
    const slot = tabSlot(tab);

    return (
      <div
        key={slot}
        id={`${viewKey}-panel-${slot}`}
        role="tabpanel"
        aria-labelledby={`${viewKey}-tab-${slot}`}
        hidden={!visible}
        aria-hidden={!visible}
        inert={!visible ? true : undefined}
        {...props(workbenchStyles.panelSlot, !visible && workbenchStyles.panelSlotHidden)}
      >
        <PanelContent
          tab={tab}
          viewKey={viewKey}
          visible={visible}
          workspacePath={workspacePath}
          workspaceActive={current}
          sidebarVisible={view.sidebars.includes(slot)}
        />
      </div>
    );
  };

  return (
    <section
      ref={attachPanel}
      hidden={panelHidden}
      aria-hidden={panelHidden}
      inert={panelHidden ? true : undefined}
      {...props(
        workbenchStyles.panel,
        panelVisible && hairline.inlineStart,
        panelVisible && [workbenchStyles.panelOpen, workbenchStyles.panelWidth(view.width.pixels)],
        !panelVisible && (compact ? workbenchStyles.railHostCompact : workbenchStyles.railHost),
        panelVisible && maximized && workbenchStyles.panelOverlay,
        panelHidden && workbenchStyles.panelHidden,
      )}
    >
      {!panelVisible &&
        current &&
        (compact ? (
          <CompactRail viewKey={viewKey} scope={scope} capabilities={capabilities} />
        ) : (
          <Rail
            viewKey={viewKey}
            view={view}
            scope={scope}
            workspaceName={workspaceName}
            capabilities={capabilities}
          />
        ))}
      <div
        hidden={!panelVisible}
        {...props(workbenchStyles.panelBody, !panelVisible && workbenchStyles.panelHidden)}
      >
        {panelVisible && !maximized && (
          <div
            role="separator"
            tabIndex={0}
            aria-label="Resize workbench"
            aria-orientation="vertical"
            aria-valuemin={Math.round((bounds.min / stageWidth) * 100)}
            aria-valuemax={Math.round((bounds.max / stageWidth) * 100)}
            aria-valuenow={Math.round((panelWidth / stageWidth) * 100)}
            aria-valuetext={`${String(Math.round((panelWidth / stageWidth) * 100))}%`}
            title="Drag to resize. Double-click to reset."
            {...props(workbenchStyles.sash, resizing && workbenchStyles.sashActive)}
            onKeyDown={resizeWithKeyboard}
            onPointerDown={beginResize}
            onPointerMove={moveResize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            onDoubleClick={resetWidth}
          />
        )}
        {editorTab !== undefined && renderSlot(editorTab, editorVisible)}
        {panelTabs.map((tab) => renderSlot(tab, shownTab?.id === tab.id))}
        {panelShown && shownTab === null && (
          <div {...props(workbenchStyles.launcher)}>
            {workbenchLaunchers(scope, capabilities).map((kind) => (
              <div key={kind} {...props(workbenchStyles.launcherFrame)}>
                <Row
                  variant="nav"
                  xstyle={workbenchStyles.launcherCard}
                  onClick={() => launch(viewKey, kind)}
                >
                  <Icon name={WORKBENCH_KINDS[kind].icon} size="lg" />
                  {WORKBENCH_KINDS[kind].label}
                </Row>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function Workbench({
  workspacePath,
}: {
  readonly workspacePath: string | undefined;
}): ReactElement {
  const host = useHostState();
  const capabilities = clientCapabilities(nyte.host);
  const [stageWidth, setStageWidth] = useState(2 * WORKBENCH_CENTER_WIDTH_MIN);
  const viewKey = workbenchViewKey(workspacePath);
  const snapshot = useWorkbenchSnapshot();
  const [visited, setVisited] = useState<readonly WorkbenchViewKey[]>([viewKey]);

  if (visited.at(-1) !== viewKey)
    setVisited([...visited.filter((key) => key !== viewKey), viewKey].slice(-MOUNTED_VIEWS));

  useMountEffect(prefetchWorkbench);

  const observeStage = (root: HTMLElement | null): (() => void) | undefined => {
    const stage = root?.parentElement;

    if (stage === undefined || stage === null) return undefined;

    const update = (): void => {
      const width = Math.floor(stage.getBoundingClientRect().width);

      if (width > 0) setStageWidth(width);
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);

    return () => observer.disconnect();
  };

  return (
    <aside ref={observeStage} {...props(workbenchStyles.root)} aria-label="Workbench">
      {visited.toSorted().map((key) => {
        const current = key === viewKey;

        return (
          <WorkbenchViewHost
            key={key}
            viewKey={key}
            view={snapshot.views.get(key) ?? DEFAULT_VIEW}
            current={current}
            scope={current ? workbenchScope(workspacePath) : { kind: "pathless" }}
            stageWidth={stageWidth}
            workspaceName={host.data.workspace?.name}
            capabilities={capabilities}
          />
        );
      })}
    </aside>
  );
}
