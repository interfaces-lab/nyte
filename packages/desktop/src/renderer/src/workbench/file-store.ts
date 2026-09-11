import { useSyncExternalStore } from "react";
import { workbenchController } from "./controller.ts";
import type { WorkbenchController, WorkbenchViewKey } from "./controller.ts";
import type { FileDocumentSnapshot } from "./file-document.ts";

export interface FileLocation {
  readonly path: string;
  readonly displayPath: string;
  readonly line?: number;
  readonly column?: number;
  readonly length?: number;
}

export interface FileDraft extends Pick<
  FileDocumentSnapshot,
  "contents" | "savedContents" | "version"
> {
  readonly revision: number;
}

export interface FileTab extends FileLocation {
  /** Only explicit file/line reveals change this; ordinary tab selection preserves the caret. */
  readonly navigationRevision: number;
  readonly dirty: boolean;
  readonly saving: boolean;
  readonly preview: boolean;
  readonly draft: FileDraft | undefined;
}

export interface FileTabs {
  readonly tabs: readonly FileTab[];
  readonly activePath: string | undefined;
  readonly history: readonly FileLocation[];
  readonly historyIndex: number;
  readonly pendingClosePath: string | undefined;
  /** Changes on explicit navigation, including a repeated jump to the same line. */
  readonly navigationRevision: number;
  /** The explorer entry to focus, by workspace-relative path; the revision repeats a reveal. */
  readonly revealPath: string | undefined;
  readonly revealRevision: number;
}

const EMPTY: FileTabs = {
  tabs: [],
  activePath: undefined,
  history: [],
  historyIndex: -1,
  pendingClosePath: undefined,
  navigationRevision: 0,
  revealPath: undefined,
  revealRevision: 0,
};

function visit(
  current: FileTabs,
  location: FileLocation,
): Pick<FileTabs, "history" | "historyIndex"> {
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

function openFileTabs(
  current: FileTabs,
  location: FileLocation & { readonly preview?: boolean },
): readonly FileTab[] {
  const existing = current.tabs.find((tab) => tab.path === location.path);
  if (existing !== undefined) {
    return current.tabs.map((tab) =>
      tab === existing
        ? {
            ...tab,
            navigationRevision: current.navigationRevision + 1,
            displayPath: location.displayPath,
            line: location.line,
            column: location.column,
            length: location.length,
            preview: tab.preview && location.preview === true,
          }
        : tab,
    );
  }
  const tab: FileTab = {
    navigationRevision: current.navigationRevision + 1,
    path: location.path,
    displayPath: location.displayPath,
    line: location.line,
    column: location.column,
    length: location.length,
    dirty: false,
    saving: false,
    preview: location.preview === true,
    draft: undefined,
  };
  const previewIndex = current.tabs.findIndex(
    (candidate) => candidate.preview && !candidate.dirty && !candidate.saving,
  );
  if (tab.preview && previewIndex !== -1) {
    return current.tabs.map((candidate, index) => (index === previewIndex ? tab : candidate));
  }
  return [...current.tabs, tab];
}

/** In-memory, window-lifetime drafts. Never persist file contents to localStorage. */
export function createFileTabStore(
  controller: Pick<WorkbenchController, "actions"> = workbenchController,
) {
  const views = new Map<WorkbenchViewKey, FileTabs>();
  const listeners = new Set<() => void>();
  const getView = (key: WorkbenchViewKey): FileTabs => views.get(key) ?? EMPTY;
  const publish = (key: WorkbenchViewKey, next: FileTabs): void => {
    if (getView(key) === next) return;
    views.set(key, next);
    for (const listener of listeners) listener();
  };

  const remove = (key: WorkbenchViewKey, path: string): void => {
    const current = getView(key);
    const index = current.tabs.findIndex((tab) => tab.path === path);
    if (index === -1) return;
    const tabs = current.tabs.filter((tab) => tab.path !== path);
    const activePath =
      current.activePath === path ? (tabs[index] ?? tabs[index - 1])?.path : current.activePath;
    const history = current.history.filter((location) => location.path !== path);
    const historyIndex =
      current.history
        .slice(0, current.historyIndex + 1)
        .filter((location) => location.path !== path).length - 1;
    const next = {
      ...current,
      tabs,
      activePath,
      history,
      historyIndex,
      pendingClosePath: current.pendingClosePath === path ? undefined : current.pendingClosePath,
    };
    const active = tabs.find((tab) => tab.path === activePath);
    publish(
      key,
      active === undefined || current.activePath !== path
        ? next
        : { ...next, ...visit(next, active), navigationRevision: current.navigationRevision + 1 },
    );
  };

  const navigate = (key: WorkbenchViewKey, historyIndex: number): void => {
    const current = getView(key);
    const location = current.history[historyIndex];
    if (location === undefined) return;
    publish(key, {
      ...current,
      tabs: openFileTabs(current, location),
      activePath: location.path,
      historyIndex,
      navigationRevision: current.navigationRevision + 1,
    });
    controller.actions.openTab(key, "files");
  };

  const actions = {
    open(key: WorkbenchViewKey, location: FileLocation & { readonly preview?: boolean }): void {
      const current = getView(key);
      const tabs = openFileTabs(current, location);
      publish(key, {
        ...current,
        tabs,
        activePath: location.path,
        ...visit(current, location),
        navigationRevision: current.navigationRevision + 1,
      });
      controller.actions.openTab(key, "files");
    },
    /** Focuses an explorer entry without opening a tab; folders have no tab to open. */
    reveal(key: WorkbenchViewKey, displayPath: string): void {
      const current = getView(key);
      publish(key, {
        ...current,
        revealPath: displayPath,
        revealRevision: current.revealRevision + 1,
      });
      controller.actions.openTab(key, "files");
    },
    select(key: WorkbenchViewKey, path: string): void {
      const current = getView(key);
      const tab = current.tabs.find((candidate) => candidate.path === path);
      if (tab === undefined) return;
      publish(key, {
        ...current,
        activePath: path,
        ...visit(current, tab),
        navigationRevision: current.navigationRevision + 1,
      });
      controller.actions.openTab(key, "files");
    },
    /** Returns false while confirmation is required. The tab and draft remain intact. */
    close(key: WorkbenchViewKey, path: string): boolean {
      const current = getView(key);
      const tab = current.tabs.find((candidate) => candidate.path === path);
      if (tab?.dirty || tab?.saving) {
        publish(key, { ...current, pendingClosePath: path });
        return false;
      }
      remove(key, path);
      return true;
    },
    cancelClose(key: WorkbenchViewKey): void {
      const current = getView(key);
      if (current.pendingClosePath === undefined) return;
      publish(key, { ...current, pendingClosePath: undefined });
    },
    /** Only discards the file named by the current confirmation. */
    discardClose(key: WorkbenchViewKey): void {
      const current = getView(key);
      const path = current.pendingClosePath;
      if (path !== undefined && !current.tabs.find((tab) => tab.path === path)?.saving)
        remove(key, path);
    },
    setSaving(key: WorkbenchViewKey, path: string, saving: boolean): void {
      const current = getView(key);
      const tab = current.tabs.find((candidate) => candidate.path === path);
      if (tab === undefined || tab.saving === saving) return;
      publish(key, {
        ...current,
        tabs: current.tabs.map((candidate) => (candidate === tab ? { ...tab, saving } : candidate)),
      });
    },
    setDirty(key: WorkbenchViewKey, path: string, dirty: boolean): void {
      const current = getView(key);
      const tab = current.tabs.find((candidate) => candidate.path === path);
      if (tab === undefined || tab.dirty === dirty) return;
      publish(key, {
        ...current,
        tabs: current.tabs.map((candidate) =>
          candidate === tab ? { ...tab, dirty, preview: dirty ? false : tab.preview } : candidate,
        ),
      });
    },
    /** Call on edit changes, not only editor teardown. Undefined clears a saved/reloaded draft. */
    setDraft(
      key: WorkbenchViewKey,
      path: string,
      draft: Omit<FileDraft, "revision"> | undefined,
    ): void {
      const current = getView(key);
      const tab = current.tabs.find((candidate) => candidate.path === path);
      if (
        tab === undefined ||
        (tab.draft?.contents === draft?.contents &&
          tab.draft?.version === draft?.version &&
          tab.draft?.savedContents === draft?.savedContents &&
          tab.dirty === (draft !== undefined))
      )
        return;
      publish(key, {
        ...current,
        tabs: current.tabs.map((candidate) =>
          candidate === tab
            ? {
                ...tab,
                draft:
                  draft === undefined
                    ? undefined
                    : { ...draft, revision: (tab.draft?.revision ?? 0) + 1 },
                dirty: draft !== undefined,
                preview: draft === undefined ? tab.preview : false,
              }
            : candidate,
        ),
      });
    },
    pin(key: WorkbenchViewKey, path: string): void {
      const current = getView(key);
      const tab = current.tabs.find((candidate) => candidate.path === path);
      if (tab === undefined || !tab.preview) return;
      publish(key, {
        ...current,
        tabs: current.tabs.map((candidate) =>
          candidate === tab ? { ...tab, preview: false } : candidate,
        ),
      });
    },
    back(key: WorkbenchViewKey): void {
      navigate(key, getView(key).historyIndex - 1);
    },
    forward(key: WorkbenchViewKey): void {
      navigate(key, getView(key).historyIndex + 1);
    },
  };

  return {
    getView,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    actions,
  };
}

const fileStore = createFileTabStore();
export const fileActions = fileStore.actions;
export const getFileTabs = fileStore.getView;

export function useFileTabs(viewKey: WorkbenchViewKey): FileTabs {
  return useSyncExternalStore(fileStore.subscribe, () => fileStore.getView(viewKey));
}
