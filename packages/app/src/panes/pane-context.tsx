import type { SessionId } from "@nyte-ai/sdk";
import { createContext, use, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import type { Layout, PaneId, SplitDirection } from "./layout.ts";
import { useLayoutSelect } from "./layout-store.ts";
import type { LayoutStore } from "./layout-store.ts";
import type { PaneController } from "./pane-controller.ts";
import type { PaneContent } from "./pane-kinds.ts";
import { canSplitPane, chatPanes } from "./pane-layout.ts";
import type { DropPlacement } from "./pane-layout.ts";
import type { ComposerViewState, SessionViewStateStore } from "./session-view-state.ts";
import { windowTabs } from "../tabs/window-tabs.ts";

const PaneControllerContext = createContext<PaneController | undefined>(undefined);

export function PaneControllerProvider({
  controller,
  children,
}: {
  controller?: PaneController;
  children: ReactNode;
}): ReactElement {
  const tabId = useSyncExternalStore(
    windowTabs.subscribe,
    windowTabs.paneTabId,
    windowTabs.paneTabId,
  );

  const value = controller ?? windowTabs.controller(tabId);

  return <PaneControllerContext value={value}>{children}</PaneControllerContext>;
}

export function hideFromPanes(sessionId: SessionId): () => boolean {
  return windowTabs.controller().removeSessionWithUndo(sessionId);
}

export function splitPanes(controller: PaneController, direction: SplitDirection): boolean {
  if (!canSplitPane(controller.getSnapshot(), windowWidth())) return false;
  controller.split(direction);

  return true;
}

/** Focuses the next chat pane in reading order, wrapping to the first. */
export function focusNextPane(controller: PaneController): boolean {
  const layout = controller.getSnapshot();
  const panes = chatPanes(layout);

  if (panes.length < 2) return false;
  const index = panes.findIndex((pane) => pane.pane === layout.focus[0]);
  const next = panes[(index + 1) % panes.length];

  if (next === undefined) return false;
  controller.focus(next.pane);

  return true;
}

function useController(): PaneController {
  const controller = use(PaneControllerContext);

  if (controller === undefined) throw new Error("Pane controller is missing");

  return controller;
}

export function usePaneLayoutStore(): LayoutStore {
  return useController().store;
}

/** Re-renders only when `select` returns something new. */
export function usePaneLayout<T>(
  select: (layout: Layout<PaneContent>) => T,
  equal?: (left: T, right: T) => boolean,
): T {
  return useLayoutSelect(usePaneLayoutStore(), select, equal);
}

export function usePaneFocused(pane: PaneId): boolean {
  return usePaneLayout((layout) => layout.focus[0] === pane);
}

/** More than one chat pane, so each shows its own header. */
export function useSplitPanes(): boolean {
  return usePaneLayout((layout) => chatPanes(layout).length > 1);
}

function windowWidth(): number {
  return globalThis.window === undefined ? 0 : window.innerWidth;
}

function subscribeWindowWidth(listener: () => void): () => void {
  window.addEventListener("resize", listener);

  return () => window.removeEventListener("resize", listener);
}

export function useCanSplitPane(): boolean {
  const width = useSyncExternalStore(subscribeWindowWidth, windowWidth, windowWidth);

  return usePaneLayout((layout) => canSplitPane(layout, width));
}

export function usePaneViewStateStore(): SessionViewStateStore {
  return useController().viewState;
}

export interface PaneActions {
  newChat(): void;
  openSession(sessionId: SessionId): void;
  openSessionInPane(paneId: PaneId, sessionId: SessionId): void;
  openDraftChat(draftId: string, sessionId: SessionId, composer?: ComposerViewState): void;
  split(direction: SplitDirection): void;
  close(paneId: PaneId): void;
  focus(paneId: PaneId): void;
  focusNext(): boolean;
  drop(sessionId: SessionId, targetPaneId: PaneId, placement: DropPlacement): void;
  removeSession(sessionId: SessionId): void;
}

export function usePaneActions(): PaneActions {
  const controller = useController();

  return {
    newChat() {
      windowTabs.newChat();
    },
    openSession(sessionId) {
      controller.selectSession(sessionId);
    },
    openSessionInPane(paneId, sessionId) {
      controller.selectSessionInPane(paneId, sessionId);
    },
    openDraftChat(draftId, sessionId, composer) {
      controller.openDraftChat(draftId, sessionId, composer);
    },
    split(direction) {
      splitPanes(controller, direction);
    },
    close(paneId) {
      controller.close(paneId);
    },
    focus(paneId) {
      controller.focus(paneId);
    },
    focusNext() {
      return focusNextPane(controller);
    },
    drop(sessionId, targetPaneId, placement) {
      controller.drop(sessionId, targetPaneId, placement);
    },
    removeSession(sessionId) {
      controller.removeSession(sessionId);
    },
  };
}
