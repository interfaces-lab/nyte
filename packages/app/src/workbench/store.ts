import { useSyncExternalStore } from "react";
import type { PartId, SessionId } from "@nyte-ai/sdk";
import { clientCapabilities } from "../contract/client-actions.ts";
import type { ClientCapabilities } from "../contract/client-actions.ts";
import { nyte, windowApp } from "../contract/nyte.ts";
import { localArea } from "../lib/storage.ts";
import { appShape } from "./app-shape.ts";
import { DEFAULT_VIEW, EDITOR_SLOT, tabSlot } from "./model.ts";
import type {
  WorkbenchSnapshot,
  WorkbenchTabId,
  WorkbenchViewKey,
  WorkbenchViewState,
} from "./model.ts";
import { useWorkbenchViewKey, workbenchScope } from "./paths.ts";
import type { WorkbenchPersistence } from "./persistence.ts";
import { persistable, restoreSnapshot, workbenchPersistence } from "./persistence.ts";
import { shownDockTab, shownWorkbenchTab } from "./selectors.ts";
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

/** How a window's workbench starts and whether it can close. */
export interface WorkbenchArrangement {
  /** The view of a project the window hasn't shown yet. */
  readonly initial: WorkbenchViewState;
  /** The workbench is the window's main area: it stays open on its Editor, and every other tab opens in the dock. */
  readonly main: boolean;
}

const SIDE_PANEL: WorkbenchArrangement = { initial: DEFAULT_VIEW, main: false };

function holdMain(view: WorkbenchViewState, closing: boolean): WorkbenchViewState {
  const active = view.tabs.find((tab) => tab.id === view.active);
  const docks = !closing && active !== undefined && tabSlot(active) !== EDITOR_SLOT;
  const docked = docks ? { ...view, dock: { ...view.dock, open: true, active: active.id } } : view;
  const editor = docked.tabs.find((tab) => tab.kind === "editor");

  if (
    editor !== undefined &&
    docked.expanded &&
    (active === undefined || tabSlot(active) === EDITOR_SLOT)
  ) {
    return docked;
  }

  return reduceView(
    docked,
    editor === undefined
      ? { kind: "open", tab: { id: crypto.randomUUID(), kind: "editor" }, activate: true }
      : { kind: "activate", id: editor.id },
  );
}

export function createWorkbenchStore(
  capabilities: () => ClientCapabilities,
  persistence?: WorkbenchPersistence,
  arrangement: () => WorkbenchArrangement = () => SIDE_PANEL,
): WorkbenchStore {
  const listeners = new Set<() => void>();
  let snapshot: WorkbenchSnapshot | undefined;

  const held = (view: WorkbenchViewState, closing = false): WorkbenchViewState =>
    arrangement().main ? holdMain(view, closing) : view;

  const restore = (): WorkbenchSnapshot => {
    const restored = restoreSnapshot(persistence?.get(), capabilities);

    return Object.freeze({
      views: new Map([...restored.views].map((entry) => [entry[0], held(entry[1])])),
    });
  };

  const read = (): WorkbenchSnapshot => (snapshot ??= restore());

  const getView = (key: WorkbenchViewKey): WorkbenchViewState =>
    read().views.get(key) ?? arrangement().initial;

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
      const next = held(reduceView(current, action), action.kind === "close");

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

export const workbench = createWorkbenchStore(
  () => clientCapabilities(nyte.host),
  {
    get: () => appPersistence().get(),
    set: (value) => appPersistence().set(value),
  },
  () => {
    const shape = appShape();

    return { initial: shape.initial, main: shape.panel === "chat" };
  },
);

export function useWorkbenchViewState(key: WorkbenchViewKey): WorkbenchViewState {
  const read = (): WorkbenchViewState => workbench.getView(key);

  return useSyncExternalStore(workbench.subscribe, read, read);
}

export function useWorkbenchView(workspacePath: string | undefined) {
  const key = useWorkbenchViewKey(workspacePath);

  return { key, view: useWorkbenchViewState(key), scope: workbenchScope(key) };
}

export function useVisibleCanvasTab(
  workspacePath: string | undefined,
  canvas: { readonly sessionId: SessionId; readonly part: PartId } | undefined,
): WorkbenchTabId | undefined {
  const key = useWorkbenchViewKey(workspacePath);

  const read = (): WorkbenchTabId | undefined => {
    if (canvas === undefined) return undefined;

    const view = workbench.getView(key);
    const scope = workbenchScope(key);
    const capabilities = clientCapabilities(nyte.host);
    const shown = shownWorkbenchTab(view, scope, capabilities);

    const tab =
      shown !== null && appShape().panel === "chat"
        ? shownDockTab(view, scope, capabilities)
        : shown;

    return tab?.kind === "canvas" && tab.sessionId === canvas.sessionId && tab.part === canvas.part
      ? tab.id
      : undefined;
  };

  return useSyncExternalStore(workbench.subscribe, read, read);
}
