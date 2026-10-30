import { useSyncExternalStore } from "react";
import type { PartId, SessionId } from "@nyte-ai/sdk";
import { clientCapabilities } from "../contract/client-actions.ts";
import type { ClientCapabilities } from "../contract/client-actions.ts";
import { nyte } from "../contract/nyte.ts";
import { DEFAULT_VIEW } from "./model.ts";
import type {
  WorkbenchSnapshot,
  WorkbenchTabId,
  WorkbenchViewKey,
  WorkbenchViewState,
} from "./model.ts";
import { workbenchScope, workbenchViewKey } from "./paths.ts";
import type { WorkbenchPersistence } from "./persistence.ts";
import { persistable, restoreSnapshot, workbenchPersistence } from "./persistence.ts";
import { shownWorkbenchTab } from "./selectors.ts";
import { reduceView } from "./view-reducer.ts";
import type { WorkbenchViewAction } from "./view-reducer.ts";

export interface WorkbenchStore {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => WorkbenchSnapshot;
  readonly getView: (key: WorkbenchViewKey) => WorkbenchViewState;
  readonly dispatch: (view: WorkbenchViewKey, action: WorkbenchViewAction) => void;
}

function freezeView(view: WorkbenchViewState): WorkbenchViewState {
  return Object.freeze({
    ...view,
    tabs: Object.freeze(view.tabs.map((tab) => Object.freeze(tab))),
  });
}

export function createWorkbenchStore(
  capabilities: () => ClientCapabilities,
  persistence?: WorkbenchPersistence,
): WorkbenchStore {
  const listeners = new Set<() => void>();
  let snapshot: WorkbenchSnapshot | undefined;

  const read = (): WorkbenchSnapshot =>
    (snapshot ??= restoreSnapshot(persistence?.get(), capabilities));

  const getView = (key: WorkbenchViewKey): WorkbenchViewState =>
    read().views.get(key) ?? DEFAULT_VIEW;

  return Object.freeze({
    subscribe(listener: () => void) {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    getSnapshot: read,
    getView,
    dispatch(key: WorkbenchViewKey, action: WorkbenchViewAction) {
      const current = getView(key);
      const next = reduceView(current, action);

      if (next === current) return;
      const written = Object.freeze({ views: new Map(read().views).set(key, freezeView(next)) });
      persistence?.set(persistable(written));
      snapshot = written;

      for (const listener of listeners) listener();
    },
  });
}

export const workbench = createWorkbenchStore(
  () => clientCapabilities(nyte.host),
  workbenchPersistence(),
);

export function useWorkbenchSnapshot(): WorkbenchSnapshot {
  return useSyncExternalStore(workbench.subscribe, workbench.getSnapshot, workbench.getSnapshot);
}

/** One workspace's workbench: its view, and the scope its tabs are available in. */
export function useWorkbenchView(workspacePath: string | undefined) {
  const key = workbenchViewKey(workspacePath);
  const read = (): WorkbenchViewState => workbench.getView(key);

  return {
    key,
    view: useSyncExternalStore(workbench.subscribe, read, read),
    scope: workbenchScope(workspacePath),
  };
}

/** The workbench tab drawing this canvas while it is on screen beside the chat. */
export function useVisibleCanvasTab(
  workspacePath: string | undefined,
  canvas: { readonly sessionId: SessionId; readonly part: PartId } | undefined,
): WorkbenchTabId | undefined {
  const read = (): WorkbenchTabId | undefined => {
    if (canvas === undefined) return undefined;

    const tab = shownWorkbenchTab(
      workbench.getView(workbenchViewKey(workspacePath)),
      workbenchScope(workspacePath),
      clientCapabilities(nyte.host),
    );

    return tab?.kind === "canvas" && tab.sessionId === canvas.sessionId && tab.part === canvas.part
      ? tab.id
      : undefined;
  };

  return useSyncExternalStore(workbench.subscribe, read, read);
}
