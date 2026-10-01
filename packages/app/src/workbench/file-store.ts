import { useSyncExternalStore } from "react";
import { workbenchController } from "./controller.ts";
import type {
  WorkbenchController,
  WorkbenchTabId,
  WorkbenchViewKey,
  WorkbenchViewState,
} from "./controller.ts";
import type { FileDocumentSnapshot } from "./file-document.ts";

interface FileLocation {
  readonly path: string;
  readonly line?: number;
  readonly column?: number;
  readonly length?: number;
}

type FileDraft = Pick<FileDocumentSnapshot, "contents" | "savedContents" | "version">;

/** What the editor knows about a tab; the controller owns its path, preview, and order. */
interface FileRuntime extends Omit<FileLocation, "path"> {
  readonly navigationRevision: number;
  readonly saving: boolean;
  readonly draft: FileDraft | undefined;
}

export interface FileTab extends FileRuntime {
  readonly displayPath: string;
  readonly id: WorkbenchTabId;
  readonly path: string;
  readonly preview: boolean;
  readonly dirty: boolean;
}

interface FileViewRuntime {
  readonly history: readonly FileLocation[];
  readonly historyIndex: number;
  readonly pendingCloseId: WorkbenchTabId | null;
  readonly revealPath: string | null;
  readonly revealRevision: number;
}

interface FileTabs {
  readonly tabs: readonly FileTab[];
  readonly active: FileTab | undefined;
  readonly pendingClose: FileTab | undefined;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly revealPath: string | undefined;
  readonly revealRevision: number;
}

const EMPTY_VIEW: FileViewRuntime = {
  history: [],
  historyIndex: -1,
  pendingCloseId: null,
  revealPath: null,
  revealRevision: 0,
};

function visit(
  current: FileViewRuntime,
  location: FileLocation,
): Pick<FileViewRuntime, "history" | "historyIndex"> {
  const previous = current.history[current.historyIndex];

  if (
    previous?.path === location.path &&
    previous.line === location.line &&
    previous.column === location.column
  ) {
    return { history: current.history, historyIndex: current.historyIndex };
  }

  const history = [
    ...current.history.slice(0, current.historyIndex + 1),
    {
      path: location.path,
      line: location.line,
      column: location.column,
      length: location.length,
    },
  ];

  return { history, historyIndex: history.length - 1 };
}

export function createFileTabStore(
  controller: Pick<WorkbenchController, "actions" | "getView" | "subscribe"> = workbenchController,
) {
  const documents = new Map<WorkbenchTabId, FileRuntime>();
  const views = new Map<WorkbenchViewKey, FileViewRuntime>();

  const snapshots = new Map<
    WorkbenchViewKey,
    { readonly revision: number; readonly source: WorkbenchViewState; readonly view: FileTabs }
  >();

  const listeners = new Set<() => void>();
  let revision = 0;

  const getRuntimeView = (key: WorkbenchViewKey): FileViewRuntime => views.get(key) ?? EMPTY_VIEW;

  // Restored tabs have no runtime until they are opened again.
  const runtime = (id: WorkbenchTabId): FileRuntime =>
    documents.get(id) ?? {
      navigationRevision: 0,
      saving: false,
      draft: undefined,
    };

  const publish = (key: WorkbenchViewKey, next: FileViewRuntime): void => {
    views.set(key, next);
    revision += 1;

    for (const listener of listeners) listener();
  };

  const fileTabs = (key: WorkbenchViewKey): readonly FileTab[] =>
    controller.getView(key).tabs.flatMap((tab) => {
      if (tab.kind !== "file") return [];
      const current = runtime(tab.id);
      const path = tab.path.replaceAll("\\", "/");
      const prefix = `${key.replaceAll("\\", "/").replace(/\/$/, "")}/`;

      return [
        {
          ...current,
          id: tab.id,
          path: tab.path,
          displayPath: path.startsWith(prefix) ? path.slice(prefix.length) : path,
          preview: tab.preview,
          dirty: current.draft !== undefined,
        },
      ];
    });

  /** Stable until either store changes, so it can serve as a `useSyncExternalStore` snapshot. */
  const getView = (key: WorkbenchViewKey): FileTabs => {
    const controllerView = controller.getView(key);
    const cached = snapshots.get(key);

    if (cached?.revision === revision && cached.source === controllerView) return cached.view;
    const current = getRuntimeView(key);
    const tabs = fileTabs(key);

    const view = {
      tabs,
      active: tabs.find((tab) => tab.id === controllerView.active),
      pendingClose: tabs.find((tab) => tab.id === current.pendingCloseId),
      canGoBack: current.historyIndex > 0,
      canGoForward: current.historyIndex < current.history.length - 1,
      revealPath: current.revealPath ?? undefined,
      revealRevision: current.revealRevision,
    };

    snapshots.set(key, { revision, source: controllerView, view });

    return view;
  };

  const find = (key: WorkbenchViewKey, path: string): FileTab | undefined =>
    fileTabs(key).find((tab) => tab.path === path);

  const pin = (key: WorkbenchViewKey, tab: FileTab): void => {
    if (tab.preview) {
      controller.actions.updateTab({
        view: key,
        id: tab.id,
        kind: "file",
        patch: { preview: false },
      });
    }
  };

  const remove = (key: WorkbenchViewKey, id: WorkbenchTabId): void => {
    const current = getRuntimeView(key);
    const tab = fileTabs(key).find((candidate) => candidate.id === id);

    if (tab === undefined) return;
    controller.actions.closeTab({ view: key, id });
    documents.delete(id);
    const history = current.history.filter((location) => location.path !== tab.path);

    const historyIndex =
      current.history
        .slice(0, current.historyIndex + 1)
        .filter((location) => location.path !== tab.path).length - 1;

    publish(key, {
      ...current,
      history,
      historyIndex,
      pendingCloseId: current.pendingCloseId === id ? null : current.pendingCloseId,
    });
  };

  const open = (
    key: WorkbenchViewKey,
    location: FileLocation & { readonly preview?: boolean },
    recordHistory: boolean,
  ): void => {
    const current = getRuntimeView(key);
    const preview = location.preview === true;
    const existing = find(key, location.path);

    if (existing === undefined && preview) {
      const replaceable = fileTabs(key).find((tab) => tab.preview && !tab.dirty && !tab.saving);

      if (replaceable !== undefined) {
        controller.actions.closeTab({ view: key, id: replaceable.id });
        documents.delete(replaceable.id);
      }
    }

    const id = controller.actions.openTab({
      view: key,
      tab: { kind: "file", path: location.path, preview },
      activate: true,
    });

    const previous = runtime(id);
    documents.set(id, {
      ...previous,
      line: location.line,
      column: location.column,
      length: location.length,
      navigationRevision: previous.navigationRevision + 1,
    });

    if (existing !== undefined && !preview) pin(key, existing);
    publish(key, { ...current, ...(recordHistory ? visit(current, location) : {}) });
  };

  const navigate = (key: WorkbenchViewKey, historyIndex: number): void => {
    const location = getRuntimeView(key).history[historyIndex];

    if (location === undefined) return;
    open(key, location, false);
    publish(key, { ...getRuntimeView(key), historyIndex });
  };

  const actions = {
    open(key: WorkbenchViewKey, location: FileLocation & { readonly preview?: boolean }): void {
      open(key, location, true);
    },
    reveal(key: WorkbenchViewKey, displayPath: string): void {
      const current = getRuntimeView(key);
      controller.actions.openTab({ view: key, tab: { kind: "files" }, activate: true });
      publish(key, {
        ...current,
        revealPath: displayPath,
        revealRevision: current.revealRevision + 1,
      });
    },
    close(key: WorkbenchViewKey, path: string): boolean {
      const tab = find(key, path);

      if (tab === undefined) return true;

      if (tab.dirty || tab.saving) {
        publish(key, { ...getRuntimeView(key), pendingCloseId: tab.id });

        return false;
      }

      remove(key, tab.id);

      return true;
    },
    cancelClose(key: WorkbenchViewKey): void {
      const current = getRuntimeView(key);

      if (current.pendingCloseId === null) return;
      publish(key, { ...current, pendingCloseId: null });
    },
    discardClose(key: WorkbenchViewKey): void {
      const { pendingCloseId } = getRuntimeView(key);

      if (pendingCloseId !== null && documents.get(pendingCloseId)?.saving !== true) {
        remove(key, pendingCloseId);
      }
    },
    setSaving(key: WorkbenchViewKey, path: string, saving: boolean): void {
      const tab = find(key, path);

      if (tab === undefined || tab.saving === saving) return;
      documents.set(tab.id, { ...runtime(tab.id), saving });
      publish(key, getRuntimeView(key));
    },
    /** An edit pins a preview tab, so the next preview cannot replace it. */
    setDraft(key: WorkbenchViewKey, path: string, draft: FileDraft | undefined): void {
      const tab = find(key, path);

      if (
        tab === undefined ||
        (tab.draft?.contents === draft?.contents &&
          tab.draft?.version === draft?.version &&
          tab.draft?.savedContents === draft?.savedContents)
      ) {
        return;
      }

      documents.set(tab.id, { ...runtime(tab.id), draft });

      if (draft !== undefined) pin(key, tab);
      publish(key, getRuntimeView(key));
    },
    pin(key: WorkbenchViewKey, path: string): void {
      const tab = find(key, path);

      if (tab !== undefined) pin(key, tab);
    },
    back(key: WorkbenchViewKey): void {
      navigate(key, getRuntimeView(key).historyIndex - 1);
    },
    forward(key: WorkbenchViewKey): void {
      navigate(key, getRuntimeView(key).historyIndex + 1);
    },
  };

  return {
    getView,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      const unsubscribe = controller.subscribe(listener);

      return () => {
        listeners.delete(listener);
        unsubscribe();
      };
    },
    actions,
  };
}

const fileStore = createFileTabStore();

export const fileActions = fileStore.actions;

export function useFileTabs(viewKey: WorkbenchViewKey): FileTabs {
  const view = (): FileTabs => fileStore.getView(viewKey);

  return useSyncExternalStore(fileStore.subscribe, view, view);
}
