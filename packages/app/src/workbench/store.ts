import { useSyncExternalStore } from "react";
import type { PartId, SessionId } from "@nyte-ai/sdk";
import { clientCapabilities } from "../contract/client-actions.ts";
import type { ClientCapabilities } from "../contract/client-actions.ts";
import { nyte, windowApp } from "../contract/nyte.ts";
import { localArea } from "../lib/storage.ts";
import { DEFAULT_VIEW } from "./model.ts";
import type {
  WorkbenchSnapshot,
  WorkbenchTabId,
  WorkbenchViewKey,
  WorkbenchViewState,
} from "./model.ts";
import { useWorkbenchViewKey, workbenchScope } from "./paths.ts";
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
  readonly move: (from: WorkbenchViewKey, into: WorkbenchViewKey) => void;
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

  const write = (views: ReadonlyMap<WorkbenchViewKey, WorkbenchViewState>): void => {
    const written = Object.freeze({ views });
    snapshot = written;

    for (const listener of listeners) listener();
    persistence?.set(persistable(written));
  };

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
      write(new Map(read().views).set(key, freezeView(next)));
    },
    move(from: WorkbenchViewKey, into: WorkbenchViewKey) {
      const views = new Map(read().views);
      const source = views.get(from);

      if (source === undefined) return;
      const target = views.get(into);
      views.delete(from);

      const moved =
        target === undefined
          ? source
          : source.tabs.reduce(
              (view, tab) =>
                reduceView(view, {
                  kind: "open",
                  tab: tab.kind === "file" ? { ...tab, group: view.group } : tab,
                  activate: false,
                }),
              target,
            );

      write(views.set(into, freezeView(moved)));
    },
  });
}

let windowPersistence: WorkbenchPersistence | undefined;

function appPersistence(): WorkbenchPersistence {
  windowPersistence ??= workbenchPersistence(localArea(), windowApp());

  return windowPersistence;
}

export const workbench = createWorkbenchStore(() => clientCapabilities(nyte.host), {
  get: () => appPersistence().get(),
  set: (value) => appPersistence().set(value),
});

export function useWorkbenchSnapshot(): WorkbenchSnapshot {
  return useSyncExternalStore(workbench.subscribe, workbench.getSnapshot, workbench.getSnapshot);
}

export function useWorkbenchView(workspacePath: string | undefined) {
  const key = useWorkbenchViewKey(workspacePath);
  const read = (): WorkbenchViewState => workbench.getView(key);

  return {
    key,
    view: useSyncExternalStore(workbench.subscribe, read, read),
    scope: workbenchScope(key),
  };
}

export function useVisibleCanvasTab(
  workspacePath: string | undefined,
  canvas: { readonly sessionId: SessionId; readonly part: PartId } | undefined,
): WorkbenchTabId | undefined {
  const key = useWorkbenchViewKey(workspacePath);

  const read = (): WorkbenchTabId | undefined => {
    if (canvas === undefined) return undefined;

    const tab = shownWorkbenchTab(
      workbench.getView(key),
      workbenchScope(key),
      clientCapabilities(nyte.host),
    );

    return tab?.kind === "canvas" && tab.sessionId === canvas.sessionId && tab.part === canvas.part
      ? tab.id
      : undefined;
  };

  return useSyncExternalStore(workbench.subscribe, read, read);
}
