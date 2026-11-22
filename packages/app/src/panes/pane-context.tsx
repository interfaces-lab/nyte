import type { SessionId } from "@nyte-ai/sdk";
import { createContext, use, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import type { Layout, PaneId, SplitDirection } from "./layout.ts";
import { useLayoutSelect } from "./layout-store.ts";
import type { LayoutStore } from "./layout-store.ts";
import type { PaneContent } from "./pane-kinds.ts";
import { canSplitPane, chatPanes } from "./pane-layout.ts";
import type { PaneCommand } from "./pane-commands.ts";
import type { DropPlacement } from "./pane-layout.ts";
import type { ComposerViewState, SessionViewStateStore } from "./session-view-state.ts";

export interface PaneController {
  readonly window: {
    run(tabId: string, command: PaneCommand): void;
    openDraftChat(
      tabId: string,
      draftId: string,
      sessionId: SessionId,
      composer?: ComposerViewState,
    ): void;
  };
  readonly tabId: string;
  readonly layout: LayoutStore;
  readonly viewState: SessionViewStateStore;
}

const PaneControllerContext = createContext<PaneController | undefined>(undefined);

export function PaneControllerProvider({
  panes,
  children,
}: {
  panes: PaneController;
  children: ReactNode;
}): ReactElement {
  return <PaneControllerContext value={panes}>{children}</PaneControllerContext>;
}

export function splitPanes(panes: PaneController, direction: SplitDirection): boolean {
  if (!canSplitPane(panes.layout.getSnapshot(), windowWidth())) return false;
  panes.window.run(panes.tabId, { kind: "split", direction });

  return true;
}

export function focusNextPane(panes: PaneController): boolean {
  const layout = panes.layout.getSnapshot();
  const shown = chatPanes(layout);

  if (shown.length < 2) return false;
  const index = shown.findIndex((pane) => pane.pane === layout.focus[0]);
  const next = shown[(index + 1) % shown.length];

  if (next === undefined) return false;
  panes.window.run(panes.tabId, { kind: "focus", pane: next.pane });

  return true;
}

function usePaneController(): PaneController {
  const panes = use(PaneControllerContext);

  if (panes === undefined) throw new Error("Pane controller is missing");

  return panes;
}

export function usePaneLayoutStore(): LayoutStore {
  return usePaneController().layout;
}

export function usePaneLayout<T>(
  select: (layout: Layout<PaneContent>) => T,
  equal?: (left: T, right: T) => boolean,
): T {
  return useLayoutSelect(usePaneLayoutStore(), select, equal);
}

export function usePaneFocused(pane: PaneId): boolean {
  return usePaneLayout((layout) => layout.focus[0] === pane);
}

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
  return usePaneController().viewState;
}

export interface PaneActions {
  openDraftChat(draftId: string, sessionId: SessionId, composer?: ComposerViewState): void;
  split(direction: SplitDirection): void;
  close(paneId: PaneId): void;
  drop(sessionId: SessionId, targetPaneId: PaneId, placement: DropPlacement): void;
}

export function usePaneActions(): PaneActions {
  const panes = usePaneController();

  return {
    openDraftChat(draftId, sessionId, composer) {
      panes.window.openDraftChat(panes.tabId, draftId, sessionId, composer);
    },
    split(direction) {
      splitPanes(panes, direction);
    },
    close(paneId) {
      panes.window.run(panes.tabId, { kind: "close", pane: paneId });
    },
    drop(sessionId, targetPaneId, placement) {
      panes.window.run(panes.tabId, {
        kind: "drop",
        sessionId,
        pane: targetPaneId,
        placement,
      });
    },
  };
}
