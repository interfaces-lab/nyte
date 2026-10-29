import { useSyncExternalStore } from "react";
import type { WorkbenchTabId, WorkbenchViewKey, WorkbenchViewState } from "../model.ts";
import { workspaceFile } from "../paths.ts";
import { workbench } from "../store.ts";
import type { WorkbenchStore } from "../store.ts";
import type { WorkbenchViewAction } from "../view-reducer.ts";
import type { FileDocumentSnapshot } from "./file-document.ts";

interface FileLocation {
  readonly path: string;
  readonly line?: number;
  readonly column?: number;
  readonly length?: number;
}

type FileDraft = Pick<FileDocumentSnapshot, "contents" | "savedContents" | "version">;

interface FileRuntime extends Omit<FileLocation, "path"> {
  readonly navigationRevision: number;
  readonly saving: boolean;
  readonly draft: FileDraft | undefined;
}

export interface FileTab extends FileRuntime {
  /** The path inside the view's workspace, or the absolute path of a file outside it. */
  readonly displayPath: string;
  /** Outside the view's workspace: it opens read-only and has no place in the workspace tree. */
  readonly external: boolean;
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

export function createFileTabStore(store: WorkbenchStore = workbench) {
  const documents = new Map<WorkbenchTabId, FileRuntime>();
  const views = new Map<WorkbenchViewKey, FileViewRuntime>();

  const snapshots = new Map<
    WorkbenchViewKey,
    { readonly revision: number; readonly source: WorkbenchViewState; readonly view: FileTabs }
  >();

  const listeners = new Set<() => void>();
  let revision = 0;

  const getRuntimeView = (key: WorkbenchViewKey): FileViewRuntime => views.get(key) ?? EMPTY_VIEW;

  const runtime = (id: WorkbenchTabId): FileRuntime =>
    documents.get(id) ?? {
      navigationRevision: 0,
      saving: false,
      draft: undefined,
    };

  const commit = (key: WorkbenchViewKey, action?: WorkbenchViewAction): void => {
    revision += 1;
    const before = store.getSnapshot();

    if (action !== undefined) store.dispatch(key, action);

    if (store.getSnapshot() !== before) return;

    for (const listener of listeners) listener();
  };

  const fileTabs = (key: WorkbenchViewKey): readonly FileTab[] =>
    store.getView(key).tabs.flatMap((tab) => {
      if (tab.kind !== "file") return [];
      const current = runtime(tab.id);
      const inside = workspaceFile(tab.path, [key]);

      return [
        {
          ...current,
          id: tab.id,
          path: tab.path,
          displayPath: inside?.relative ?? tab.path,
          external: inside === undefined,
          preview: tab.preview,
          dirty: current.draft !== undefined,
        },
      ];
    });

  const getView = (key: WorkbenchViewKey): FileTabs => {
    const workbenchView = store.getView(key);
    const cached = snapshots.get(key);

    if (cached?.revision === revision && cached.source === workbenchView) return cached.view;
    const current = getRuntimeView(key);
    const tabs = fileTabs(key);

    const view = {
      tabs,
      active: tabs.find((tab) => tab.id === workbenchView.active),
      pendingClose: tabs.find((tab) => tab.id === current.pendingCloseId),
      canGoBack: current.historyIndex > 0,
      canGoForward: current.historyIndex < current.history.length - 1,
      revealPath: current.revealPath ?? undefined,
      revealRevision: current.revealRevision,
    };

    snapshots.set(key, { revision, source: workbenchView, view });

    return view;
  };

  const find = (key: WorkbenchViewKey, path: string): FileTab | undefined =>
    fileTabs(key).find((tab) => tab.path === path);

  const pin = (key: WorkbenchViewKey, tab: FileTab): void => {
    if (tab.preview)
      store.dispatch(key, {
        kind: "patch",
        id: tab.id,
        change: { kind: "file", patch: { preview: false } },
      });
  };

  const remove = (key: WorkbenchViewKey, id: WorkbenchTabId): void => {
    const current = getRuntimeView(key);
    const tab = fileTabs(key).find((candidate) => candidate.id === id);

    if (tab === undefined) return;
    documents.delete(id);
    const history = current.history.filter((location) => location.path !== tab.path);

    const historyIndex =
      current.history
        .slice(0, current.historyIndex + 1)
        .filter((location) => location.path !== tab.path).length - 1;

    views.set(key, {
      ...current,
      history,
      historyIndex,
      pendingCloseId: current.pendingCloseId === id ? null : current.pendingCloseId,
    });
    commit(key, { kind: "close", id });
  };

  const open = (
    key: WorkbenchViewKey,
    location: FileLocation & { readonly preview?: boolean },
    next: (current: FileViewRuntime) => FileViewRuntime,
  ): void => {
    const preview = location.preview === true;
    const existing = find(key, location.path);
    const id = existing?.id ?? crypto.randomUUID();

    const replace =
      existing === undefined && preview
        ? fileTabs(key).find((tab) => tab.preview && !tab.dirty && !tab.saving)?.id
        : undefined;

    if (replace !== undefined) documents.delete(replace);
    const previous = runtime(id);
    documents.set(id, {
      ...previous,
      line: location.line,
      column: location.column,
      length: location.length,
      navigationRevision: previous.navigationRevision + 1,
    });
    views.set(key, next(getRuntimeView(key)));
    commit(key, {
      kind: "open-file",
      tab: { id, kind: "file", path: location.path, preview },
      replace,
    });
  };

  const navigate = (key: WorkbenchViewKey, historyIndex: number): void => {
    const location = getRuntimeView(key).history[historyIndex];

    if (location === undefined) return;
    open(key, location, (current) => ({ ...current, historyIndex }));
  };

  const actions = {
    open(key: WorkbenchViewKey, location: FileLocation & { readonly preview?: boolean }): void {
      open(key, location, (current) => ({ ...current, ...visit(current, location) }));
    },
    reveal(key: WorkbenchViewKey, displayPath: string): void {
      const current = getRuntimeView(key);
      views.set(key, {
        ...current,
        revealPath: displayPath,
        revealRevision: current.revealRevision + 1,
      });
      commit(key, {
        kind: "open",
        tab: { id: crypto.randomUUID(), kind: "files" },
        activate: true,
      });
    },
    close(key: WorkbenchViewKey, path: string): boolean {
      const tab = find(key, path);

      if (tab === undefined) return true;

      if (tab.dirty || tab.saving) {
        views.set(key, { ...getRuntimeView(key), pendingCloseId: tab.id });
        commit(key);

        return false;
      }

      remove(key, tab.id);

      return true;
    },
    cancelClose(key: WorkbenchViewKey): void {
      const current = getRuntimeView(key);

      if (current.pendingCloseId === null) return;
      views.set(key, { ...current, pendingCloseId: null });
      commit(key);
    },
    discardClose(key: WorkbenchViewKey): void {
      const pendingCloseId = getRuntimeView(key).pendingCloseId;

      if (pendingCloseId !== null && documents.get(pendingCloseId)?.saving !== true) {
        remove(key, pendingCloseId);
      }
    },
    setSaving(key: WorkbenchViewKey, path: string, saving: boolean): void {
      const tab = find(key, path);

      if (tab === undefined || tab.saving === saving) return;
      documents.set(tab.id, { ...runtime(tab.id), saving });
      commit(key);
    },
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
      commit(
        key,
        draft !== undefined && tab.preview
          ? { kind: "patch", id: tab.id, change: { kind: "file", patch: { preview: false } } }
          : undefined,
      );
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

      const unsubscribe = store.subscribe(listener);

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
