import type { SessionId } from "@nyte-ai/protocol";
import { useRouter } from "@tanstack/react-router";
import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import { PaneController } from "./pane-controller.ts";
import type { PaneControllerSnapshot } from "./pane-controller.ts";
import { activePane, activeSelection, canSplitPane } from "./pane-layout.ts";
import type {
  DropPlacement,
  PaneId,
  PaneLayout,
  PaneSelection,
  SplitDirection,
} from "./pane-layout.ts";
import type { SessionViewStateStore } from "./session-view-state.ts";
import { shellActions } from "../chrome/shell-state.ts";
import { activeTab } from "../tabs/model.ts";
import { routeShows } from "../tabs/places.ts";
import { windowTabs } from "../tabs/window-tabs.ts";

const controllerCache = new Map<string, PaneController>();

const PaneControllerContext = createContext<PaneController | undefined>(undefined);

function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function paneControllerForWorkspace(workspacePath: string | undefined): PaneController {
  const workspaceKey = workspacePath ?? "no-workspace";
  const existing = controllerCache.get(workspaceKey);

  if (existing !== undefined) return existing;

  const controller = new PaneController({
    storage: browserStorage(),
    storageKey: `nyte.desktop.panes.v1:${workspaceKey}`,
  });

  controllerCache.set(workspaceKey, controller);

  return controller;
}

/** The controller showing now: the active window tab's on the desktop, else the folder's. */
export function activePaneController(workspacePath: string | null | undefined): PaneController {
  return windowTabs.enabled
    ? windowTabs.controller()
    : paneControllerForWorkspace(workspacePath ?? undefined);
}

export function PaneControllerProvider({
  workspaceKey,
  controller: tabController,
  children,
}: {
  workspaceKey: string | undefined;
  /** A window tab's controller, which wins over the folder's. */
  controller?: PaneController;
  children: ReactNode;
}): ReactElement {
  const controller = useMemo(
    () => tabController ?? paneControllerForWorkspace(workspaceKey),
    [tabController, workspaceKey],
  );

  return (
    <PaneControllerContext.Provider value={controller}>{children}</PaneControllerContext.Provider>
  );
}

function useController(): PaneController {
  const controller = useContext(PaneControllerContext);

  if (controller === undefined) throw new Error("Pane controller is missing");

  return controller;
}

export function usePaneControllerSnapshot(): PaneControllerSnapshot {
  const controller = useController();

  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}

function windowWidth(): number {
  return globalThis.window === undefined ? 0 : window.innerWidth;
}

function subscribeWindowWidth(listener: () => void): () => void {
  window.addEventListener("resize", listener);

  return () => window.removeEventListener("resize", listener);
}

/** A pinned tab stays on its one place, so it never splits. */
function activeTabPinned(): boolean {
  return windowTabs.enabled && activeTab(windowTabs.getSnapshot()).pinned;
}

export function useCanSplitPane(): boolean {
  const { layout } = usePaneControllerSnapshot();
  const width = useSyncExternalStore(subscribeWindowWidth, windowWidth, windowWidth);
  const pinned = useSyncExternalStore(windowTabs.subscribe, activeTabPinned, activeTabPinned);

  return !pinned && canSplitPane(layout, width);
}

export function usePaneViewStateStore(): SessionViewStateStore {
  return useController().viewState;
}

function activePath(layout: PaneLayout): string {
  const selection = activeSelection(layout);

  return selection.kind === "blank" ? "/" : `/session/${selection.sessionId}`;
}

export interface PaneActions {
  syncRoute(selection: PaneSelection): void;
  newChat(): void;
  openSession(sessionId: SessionId): void;
  openSessionInPane(paneId: PaneId, sessionId: SessionId): void;
  split(direction: SplitDirection): void;
  close(paneId: PaneId): void;
  focus(paneId: PaneId): void;
  focusNext(): boolean;
  resize(ratio: number): void;
  drop(sessionId: SessionId, targetPaneId: PaneId, placement: DropPlacement): void;
  removeSession(sessionId: SessionId): void;
}

export function usePaneActions(): PaneActions {
  const controller = useController();
  const router = useRouter();

  const navigateToActive = useCallback(
    (layout: PaneLayout): void => {
      // Window tabs move the route themselves once the tab has settled.
      if (windowTabs.enabled) return;
      const path = activePath(layout);

      if (router.state.location.pathname === path) return;
      const selection = activeSelection(layout);

      if (selection.kind === "blank") {
        void router.navigate({ to: "/" });
      } else {
        void router.navigate({
          to: "/session/$sessionId",
          params: { sessionId: selection.sessionId },
        });
      }
    },
    [router],
  );

  return useMemo(
    () => ({
      syncRoute(selection) {
        // A route that resolves after its tab moved on is stale, not a navigation.
        if (windowTabs.enabled && !routeShows(router, selection)) return;
        controller.syncSelection(selection);
      },
      newChat() {
        if (windowTabs.enabled) {
          windowTabs.dispatch({ kind: "new-tab" });

          return;
        }

        shellActions.showWorkspace();
        navigateToActive(controller.newChat());
      },
      openSession(sessionId) {
        navigateToActive(controller.selectSession(sessionId));
      },
      openSessionInPane(paneId, sessionId) {
        navigateToActive(controller.selectSessionInPane(paneId, sessionId));
      },
      split(direction) {
        if (activeTabPinned() || !canSplitPane(controller.getSnapshot().layout, windowWidth()))
          return;
        navigateToActive(controller.split(direction));
      },
      close(paneId) {
        navigateToActive(controller.close(paneId));
      },
      focus(paneId) {
        const current = controller.getSnapshot().layout;
        const layout = controller.focus(paneId);

        if (layout !== current) navigateToActive(layout);
      },
      focusNext() {
        const layout = controller.getSnapshot().layout;

        if (layout.kind !== "split") return false;
        navigateToActive(
          controller.focus(activePane(layout).id === "primary" ? "secondary" : "primary"),
        );

        return true;
      },
      resize(ratio) {
        controller.resize(ratio);
      },
      drop(sessionId, targetPaneId, placement) {
        navigateToActive(controller.drop(sessionId, targetPaneId, placement));
      },
      removeSession(sessionId) {
        navigateToActive(controller.removeSession(sessionId));
      },
    }),
    [controller, navigateToActive, router],
  );
}
