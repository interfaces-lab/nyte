import type { SessionId } from "@nyte-ai/sdk";
import { useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import { PaneControllerProvider } from "../panes/pane-context.tsx";
import { windowTabs } from "./window-tabs.ts";

/** Gives the panes below it the active window tab's panes. */
export function WindowPanesProvider({ children }: { children: ReactNode }): ReactElement {
  const tabId = useSyncExternalStore(
    windowTabs.subscribe,
    windowTabs.paneTabId,
    windowTabs.paneTabId,
  );

  return (
    <PaneControllerProvider panes={windowTabs.store.tab(tabId)}>{children}</PaneControllerProvider>
  );
}

export function hideFromPanes(sessionId: SessionId): () => void {
  return windowTabs.store.hide(sessionId);
}
