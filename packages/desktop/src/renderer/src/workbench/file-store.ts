import { useSyncExternalStore } from "react";
import { workbenchController } from "./controller.ts";
import type { WorkbenchController, WorkbenchTabId, WorkbenchViewKey } from "./controller.ts";
import type { FileDocumentSnapshot } from "./file-document.ts";

interface FileLocation {
  readonly path: string;
  readonly displayPath: string;
  readonly line?: number;
  readonly column?: number;
  readonly length?: number;
}

interface FileDraft extends Pick<FileDocumentSnapshot, "contents" | "savedContents" | "version"> {
  readonly revision: number;
}

interface FileRuntime extends Omit<FileLocation, "path"> {
  readonly navigationRevision: number;
  readonly dirty: boolean;
  readonly saving: boolean;
  readonly draft: FileDraft | undefined;
}

export interface FileTab extends FileLocation {
  readonly id: WorkbenchTabId;
  readonly navigationRevision: number;
  readonly dirty: boolean;
  readonly saving: boolean;
  readonly preview: boolean;
  readonly draft: FileDraft | undefined;
}

interface FileViewRuntime {
  readonly history: readonly FileLocation[];
  readonly historyIndex: number;
  readonly pendingCloseId: WorkbenchTabId | null;
  readonly navigationRevision: number;
  readonly revealPath: string | null;
  readonly revealRevision: number;
}

interface FileTabs {
  readonly tabs: readonly FileTab[];
  readonly activeId: WorkbenchTabId | null;
  readonly activePath: string | undefined;
  readonly history: readonly FileLocation[];
  readonly historyIndex: number;
  readonly pendingClosePath: string | undefined;
  readonly navigationRevision: number;
  readonly revealPath: string | undefined;
  readonly revealRevision: number;
}

const EMPTY_VIEW: FileViewRuntime = {
  history: [],
  historyIndex: -1,
  pendingCloseId: null,
  navigationRevision: 0,
  revealPath: null,
  revealRevision: 0,
};

function fallbackRuntime(path: string): FileRuntime {
  return {
    displayPath: path,
    navigationRevision: 0,
    dirty: false,
    saving: false,
    draft: undefined,
  };
}

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
      displayPath: location.displayPath,
      line: location.line,
      column: location.column,
      length: location.length,
    },
  ];
  return { history, historyIndex: history.length - 1 };
}

export function createFileTabStore(
  controller: Pick<WorkbenchController, "actions" | "getView"> = workbenchController,
) {
  const documents = new Map<WorkbenchTabId, FileRuntime>();
  const views = new Map<WorkbenchViewKey, FileViewRuntime>();
  const listeners = new Set<() => void>();
  let revision = 0;

  const getRuntimeView = (key: WorkbenchViewKey): FileViewRuntime => views.get(key) ?? EMPTY_VIEW;
  const publish = (key: WorkbenchViewKey, next: FileViewRuntime): void => {
    views.set(key, next);
    revision += 1;
    for (const listener of listeners) listener();
  };
  const fileTabs = (key: WorkbenchViewKey): readonly FileTab[] =>
    controller.getView(key).tabs.flatMap((tab) => {
      if (tab.kind !== "file") return [];
      const runtime = documents.get(tab.id) ?? fallbackRuntime(tab.path);
      return [{ id: tab.id, path: tab.path, preview: tab.preview, ...runtime }];
    });
  const getView = (key: WorkbenchViewKey): FileTabs => {
    const controllerView = controller.getView(key);
    const runtime = getRuntimeView(key);
    const tabs = fileTabs(key);
    const activeTab = controllerView.tabs.find((tab) => tab.id === controllerView.active);
    const activeId = activeTab?.kind === "file" ? activeTab.id : null;
    const activePath = tabs.find((tab) => tab.id === activeId)?.path;
    const pendingClosePath = tabs.find((tab) => tab.id === runtime.pendingCloseId)?.path;
    return {
      tabs,
      activeId,
      activePath,
      history: runtime.history,
      historyIndex: runtime.historyIndex,
      pendingClosePath,
      navigationRevision: runtime.navigationRevision,
      revealPath: runtime.revealPath ?? undefined,
      revealRevision: runtime.revealRevision,
    };
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
  ): WorkbenchTabId => {
    const current = getRuntimeView(key);
    const existing = fileTabs(key).find((tab) => tab.path === location.path);
    if (existing === undefined && location.preview === true) {
      const replaceable = fileTabs(key).find((tab) => tab.preview && !tab.dirty && !tab.saving);
      if (replaceable !== undefined) {
        controller.actions.closeTab({ view: key, id: replaceable.id });
        documents.delete(replaceable.id);
      }
    }
    const id = controller.actions.openTab({
      view: key,
      tab: { kind: "file", path: location.path, preview: location.preview === true },
      activate: true,
    });
    const previous = documents.get(id) ?? fallbackRuntime(location.path);
    documents.set(id, {
      ...previous,
      displayPath: location.displayPath,
      line: location.line,
      column: location.column,
      length: location.length,
      navigationRevision: current.navigationRevision + 1,
    });
    if (existing !== undefined && location.preview !== true && existing.preview) {
      controller.actions.updateTab({ view: key, id, kind: "file", patch: { preview: false } });
    }
    publish(key, {
      ...current,
      ...(recordHistory ? visit(current, location) : {}),
      navigationRevision: current.navigationRevision + 1,
    });
    return id;
  };

  const navigate = (key: WorkbenchViewKey, historyIndex: number): void => {
    const current = getRuntimeView(key);
    const location = current.history[historyIndex];
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
      controller.actions.openTab({
        view: key,
        tab: { kind: "files" },
        activate: true,
      });
      publish(key, {
        ...current,
        revealPath: displayPath,
        revealRevision: current.revealRevision + 1,
      });
    },
    select(key: WorkbenchViewKey, path: string): void {
      const current = getRuntimeView(key);
      const tab = fileTabs(key).find((candidate) => candidate.path === path);
      if (tab === undefined) return;
      controller.actions.activateTab({ view: key, id: tab.id });
      publish(key, {
        ...current,
        ...visit(current, tab),
        navigationRevision: current.navigationRevision + 1,
      });
    },
    close(key: WorkbenchViewKey, path: string): boolean {
      const current = getRuntimeView(key);
      const tab = fileTabs(key).find((candidate) => candidate.path === path);
      if (tab === undefined) return true;
      if (tab.dirty || tab.saving) {
        publish(key, { ...current, pendingCloseId: tab.id });
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
      const current = getRuntimeView(key);
      if (current.pendingCloseId === null) return;
      const tab = documents.get(current.pendingCloseId);
      if (tab?.saving !== true) remove(key, current.pendingCloseId);
    },
    setSaving(key: WorkbenchViewKey, path: string, saving: boolean): void {
      const current = getRuntimeView(key);
      const tab = fileTabs(key).find((candidate) => candidate.path === path);
      if (tab === undefined || tab.saving === saving) return;
      documents.set(tab.id, { ...tab, saving });
      publish(key, current);
    },
    setDirty(key: WorkbenchViewKey, path: string, dirty: boolean): void {
      const current = getRuntimeView(key);
      const tab = fileTabs(key).find((candidate) => candidate.path === path);
      if (tab === undefined || tab.dirty === dirty) return;
      documents.set(tab.id, { ...tab, dirty });
      if (dirty && tab.preview) {
        controller.actions.updateTab({
          view: key,
          id: tab.id,
          kind: "file",
          patch: { preview: false },
        });
      }
      publish(key, current);
    },
    setDraft(
      key: WorkbenchViewKey,
      path: string,
      draft: Omit<FileDraft, "revision"> | undefined,
    ): void {
      const current = getRuntimeView(key);
      const tab = fileTabs(key).find((candidate) => candidate.path === path);
      if (
        tab === undefined ||
        (tab.draft?.contents === draft?.contents &&
          tab.draft?.version === draft?.version &&
          tab.draft?.savedContents === draft?.savedContents &&
          tab.dirty === (draft !== undefined))
      ) {
        return;
      }
      documents.set(tab.id, {
        ...tab,
        draft:
          draft === undefined ? undefined : { ...draft, revision: (tab.draft?.revision ?? 0) + 1 },
        dirty: draft !== undefined,
      });
      if (draft !== undefined && tab.preview) {
        controller.actions.updateTab({
          view: key,
          id: tab.id,
          kind: "file",
          patch: { preview: false },
        });
      }
      publish(key, current);
    },
    pin(key: WorkbenchViewKey, path: string): void {
      const current = getRuntimeView(key);
      const tab = fileTabs(key).find((candidate) => candidate.path === path);
      if (tab === undefined || !tab.preview) return;
      controller.actions.updateTab({
        view: key,
        id: tab.id,
        kind: "file",
        patch: { preview: false },
      });
      publish(key, current);
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
      return () => listeners.delete(listener);
    },
    getSnapshot: (): number => revision,
    actions,
  };
}

const fileStore = createFileTabStore();
export const fileActions = fileStore.actions;

export function useFileTabs(viewKey: WorkbenchViewKey): FileTabs {
  useSyncExternalStore(fileStore.subscribe, fileStore.getSnapshot, fileStore.getSnapshot);
  return fileStore.getView(viewKey);
}
