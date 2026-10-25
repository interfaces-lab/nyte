import type { SessionId } from "@nyte-ai/sdk";
import { createContext, useContext, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import type { PaneController, PaneControllerSnapshot } from "./pane-controller.ts";
import { activePane, canSplitPane } from "./pane-layout.ts";
import type { DropPlacement, PaneId, SplitDirection } from "./pane-layout.ts";
import type { ComposerViewState, SessionViewStateStore } from "./session-view-state.ts";
import { shellActions } from "../chrome/shell-state.ts";
import { windowTabs } from "../tabs/window-tabs.ts";

const PaneControllerContext = createContext<PaneController | undefined>(undefined);

function activeTabId(): string {
  return windowTabs.getSnapshot().activeTabId;
}

export function PaneControllerProvider({
  controller,
  children,
}: {
  controller?: PaneController;
  children: ReactNode;
}): ReactElement {
  const tabId = useSyncExternalStore(windowTabs.subscribe, activeTabId, activeTabId);
  const value = controller ?? windowTabs.controller(tabId);

  return <PaneControllerContext.Provider value={value}>{children}</PaneControllerContext.Provider>;
}

export function hideFromPanes(sessionId: SessionId): () => boolean {
  return windowTabs.controller().removeSessionWithUndo(sessionId);
}

export function splitPanes(controller: PaneController, direction: SplitDirection): boolean {
  if (!canSplitPane(controller.getSnapshot().layout, windowWidth())) return false;
  controller.split(direction);

  return true;
}

export function focusNextPane(controller: PaneController): boolean {
  const layout = controller.getSnapshot().layout;

  if (layout.kind !== "split") return false;
  controller.focus(activePane(layout).id === "primary" ? "secondary" : "primary");

  return true;
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

export function useCanSplitPane(): boolean {
  const { layout } = usePaneControllerSnapshot();
  const width = useSyncExternalStore(subscribeWindowWidth, windowWidth, windowWidth);

  return canSplitPane(layout, width);
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
  resize(ratio: number): void;
  drop(sessionId: SessionId, targetPaneId: PaneId, placement: DropPlacement): void;
  removeSession(sessionId: SessionId): void;
}

export function usePaneActions(): PaneActions {
  const controller = useController();

  return {
    newChat() {
      shellActions.showWorkspace();
      controller.newChat();
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
    resize(ratio) {
      controller.resize(ratio);
    },
    drop(sessionId, targetPaneId, placement) {
      controller.drop(sessionId, targetPaneId, placement);
    },
    removeSession(sessionId) {
      controller.removeSession(sessionId);
    },
  };
}
