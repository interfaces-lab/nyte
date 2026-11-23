import { workbenchStyles } from "../workbench/workbench.stylex.ts";
import { props } from "@stylexjs/stylex";
import { useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, ReactElement } from "react";
import { clientCapabilities } from "../contract/client-actions.ts";
import type { ClientCapabilities } from "../contract/client-actions.ts";
import { nyte } from "../contract/nyte.ts";
import { appShape } from "../workbench/app-shape.ts";
import { hairline } from "@nyte-ai/ui/styles/hairline.stylex";
import { PanelToggleIcon } from "@nyte-ai/ui/icon";
import { Toggle } from "@nyte-ai/ui/toggle";
import type { SelectedWorkspace } from "../contract/bridge.ts";
import { useWorkspaces } from "../data/workspaces.ts";
import type { RailWorkspace } from "../data/workspaces.ts";
import {
  clampWorkbenchWidthToBounds,
  WORKBENCH_CENTER_WIDTH_MIN,
  DEFAULT_WIDTH,
  setActiveWorkbenchWidth,
  workbenchPanelWidth,
  workbenchSeparatorValue,
  workbenchWidthBounds,
} from "../workbench/width.ts";
import { browserSurface, EDITOR_SLOT, tabSlot, workbenchShowsChat } from "../workbench/model.ts";
import type {
  WorkbenchBrowse,
  WorkbenchScope,
  WorkbenchTab,
  WorkbenchViewKey,
} from "../workbench/model.ts";
import { workbenchScope, workbenchViewKey, workspacePathForView } from "../workbench/paths.ts";
import { railModel, shownWorkbenchTab, visibleTabs } from "../workbench/selectors.ts";
import { useWorkbenchViewState, workbench } from "../workbench/store.ts";
import type { ChangesTabPatch } from "../workbench/view-reducer.ts";
import { launch } from "../commands/launch.ts";
import { showChatForExcerpts } from "../references/add-to-chat.ts";
import { openUrl, revealChatPanel } from "../workbench/commands.ts";
import { WorkbenchWorkspaceContext } from "../workbench/workbench-workspace.tsx";
import type { WorkbenchWorkspace } from "../workbench/workbench-workspace.tsx";
import { CompactRail, Rail, RailRow } from "./workbench-rail.tsx";
import { BrowserPanel } from "../browser/browser-panel";
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
  chatFolder,
  visible,
  workspacePath,
  workspaceActive,
  sidebarVisible,
}: {
  readonly tab: WorkbenchTab;
  readonly viewKey: WorkbenchViewKey;
  readonly chatFolder: SelectedWorkspace | undefined;
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
              chatFolder={chatFolder}
              visible={visible}
              workspaceActive={workspaceActive}
              sidebarVisible={sidebarVisible}
              explorerDocked={appShape().navigator === "files"}
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
    case "design":
      return <Deferred entry="workbench">{({ DesignTab }) => <DesignTab />}</Deferred>;
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

function ChatOpener({ viewKey }: { readonly viewKey: WorkbenchViewKey }): null {
  useMountEffect(() => showChatForExcerpts(() => revealChatPanel(viewKey)));

  return null;
}

function WorkbenchViewHost({
  viewKey,
  chatFolder,
  current,
  scope,
  stageWidth,
  capabilities,
}: {
  readonly viewKey: WorkbenchViewKey;
  readonly chatFolder: SelectedWorkspace | undefined;
  readonly current: boolean;
  readonly scope: WorkbenchScope;
  readonly stageWidth: number;
  readonly capabilities: ClientCapabilities;
}): ReactElement {
  const view = useWorkbenchViewState(viewKey);
  const workspace = browsedWorkspace(view.browse, chatFolder, useWorkspaces().data);

  const workspacePath = workspacePathForView(viewKey) ?? null;
  const [resizing, setResizing] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);
  const resizeRef = useRef<ResizeState | undefined>(undefined);
  const bounds = workbenchWidthBounds(stageWidth);
  const compact = view.collapsed === "compact" || bounds.narrow;
  const maximized = view.layout.kind === "maximized";
  const chatShowing = workbenchShowsChat(view.layout);
  const panelWidth = maximized ? stageWidth : workbenchPanelWidth(view.width, stageWidth);
  const separator = workbenchSeparatorValue(panelWidth, stageWidth);

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

  const chatPanel = appShape().panel === "chat";
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
          chatFolder={chatFolder}
          visible={visible}
          workspacePath={workspacePath}
          workspaceActive={current}
          sidebarVisible={view.sidebars.includes(slot)}
        />
      </div>
    );
  };

  return (
    <WorkbenchWorkspaceContext value={workspace}>
      {current && <ChatOpener viewKey={viewKey} />}
      <section
        ref={attachPanel}
        data-nyte-workbench=""
        hidden={panelHidden}
        aria-hidden={panelHidden}
        inert={panelHidden ? true : undefined}
        {...props(
          workbenchStyles.panel,
          panelVisible && (chatPanel ? workbenchStyles.panelEndRule : hairline.inlineStartAfter),
          panelVisible && [
            chatPanel ? workbenchStyles.panelOpenCode : workbenchStyles.panelOpen,
            workbenchStyles.panelWidth(view.width.pixels),
          ],
          !panelVisible && (compact ? workbenchStyles.railHostCompact : workbenchStyles.railHost),
          panelVisible && maximized && workbenchStyles.panelOverlay,
          panelVisible && maximized && chatPanel && workbenchStyles.panelOverlayStart,
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
              workspace={chatFolder}
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
              aria-label={chatPanel ? "Resize chat panel" : "Resize workbench"}
              aria-orientation="vertical"
              aria-valuemin={separator.min}
              aria-valuemax={separator.max}
              aria-valuenow={separator.now}
              aria-valuetext={`${String(separator.now)}%`}
              title="Drag to resize. Double-click to reset."
              {...props(
                workbenchStyles.sash,
                chatPanel && workbenchStyles.sashEnd,
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
          {editorTab !== undefined && renderSlot(editorTab, editorVisible)}
          {panelTabs.map((tab) => renderSlot(tab, shownTab?.id === tab.id))}
          {panelShown && shownTab === null && (
            <div {...props(workbenchStyles.launcher)}>
              {railModel({ view, scope, capabilities, repository: false }).launchers.map(
                (launcher) => (
                  <RailRow
                    key={launcher.kind}
                    icon={launcher.icon}
                    label={launcher.label}
                    onClick={() => launch(viewKey, launcher.kind)}
                  />
                ),
              )}
            </div>
          )}
        </div>
      </section>
    </WorkbenchWorkspaceContext>
  );
}

function browsedWorkspace(
  browse: WorkbenchBrowse,
  chatFolder: SelectedWorkspace | undefined,
  records: readonly RailWorkspace[] | undefined,
): WorkbenchWorkspace {
  if (browse.kind === "follow") {
    return chatFolder === undefined
      ? { kind: "none" }
      : { kind: "ready", workspace: chatFolder, isChatFolder: true };
  }

  if (records === undefined) return { kind: "loading" };
  const record = records.find((candidate) => candidate.id === browse.id);

  if (record === undefined || !record.available) return { kind: "unavailable", id: browse.id };

  return {
    kind: "ready",
    workspace: { id: record.id, path: record.path, name: record.name },
    isChatFolder: record.path === chatFolder?.path,
  };
}

export function Workbench({
  folder,
}: {
  readonly folder: SelectedWorkspace | undefined;
}): ReactElement {
  const capabilities = clientCapabilities(nyte.host);
  const [stageWidth, setStageWidth] = useState(2 * WORKBENCH_CENTER_WIDTH_MIN);
  const viewKey = workbenchViewKey(folder?.path);
  const [visited, setVisited] = useState<readonly WorkbenchViewKey[]>([viewKey]);

  if (visited.at(-1) !== viewKey) {
    setVisited([...visited.filter((key) => key !== viewKey), viewKey].slice(-MOUNTED_VIEWS));
  }

  useMountEffect(prefetchWorkbench);

  const observeStage = (root: HTMLElement | null): (() => void) | undefined => {
    const stage = root?.parentElement;

    if (stage === undefined || stage === null) return undefined;

    const update = (): void => {
      const width = Math.floor(stage.getBoundingClientRect().width);

      if (width === 0) return;
      setStageWidth(width);
      workbench.dispatch(viewKey, { kind: "fit", narrow: workbenchWidthBounds(width).narrow });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    const leave = workbench.subscribe(update);

    return () => {
      observer.disconnect();
      leave();
    };
  };

  return (
    <aside ref={observeStage} {...props(workbenchStyles.root)} aria-label="Workbench">
      {visited.toSorted().map((key) => {
        const current = key === viewKey;

        return (
          <WorkbenchViewHost
            key={key}
            viewKey={key}
            chatFolder={current ? folder : undefined}
            current={current}
            scope={current ? workbenchScope(key) : { kind: "pathless" }}
            stageWidth={stageWidth}
            capabilities={capabilities}
          />
        );
      })}
    </aside>
  );
}
