import type { FileDocument } from "@nyte-ai/sdk";
import type { QueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { keys, queryClient } from "../../data/query-client.ts";
import type {
  EditorGroupId,
  KindTab,
  WorkbenchTabId,
  WorkbenchViewKey,
  WorkbenchViewState,
} from "../model.ts";
import { workspaceFile } from "../paths.ts";
import { workbench } from "../store.ts";
import type { WorkbenchStore } from "../store.ts";
import type { WorkbenchViewAction } from "../view-reducer.ts";
import type { FileBuffer, FileDocumentSnapshot } from "./file-document.ts";

interface FileLocation {
  readonly path: string;
  readonly line?: number;
  readonly column?: number;
  readonly length?: number;
}

type FileScope = Exclude<FileDocument, { readonly kind: "missing" }>["scope"];

type FileDraft = Pick<FileDocumentSnapshot, "contents" | "savedContents" | "version">;

/** Where a tab was last asked to show its file. */
interface FileNavigation extends Omit<FileLocation, "path"> {
  readonly navigationRevision: number;
}

/** What every tab showing one file shares: its contents, how they're shown, and whether they're saved. */
interface FileState {
  /** Opening at a line shows the source. */
  readonly showSource: boolean;
  readonly saving: boolean;
  readonly draft: FileDraft | undefined;
}

export interface FileTab extends FileNavigation, FileState {
  /** The path inside the view's workspace, or the absolute path of a file outside it. */
  readonly displayPath: string;
  /**
   * Outside the view's workspace: not under its folder, or, once its document loads, scoped outside
   * by the host, as a symlink out of the workspace is. It has no place in the workspace tree.
   */
  readonly external: boolean;
  readonly id: WorkbenchTabId;
  readonly path: string;
  readonly group: EditorGroupId;
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

export interface FileGroup {
  readonly id: EditorGroupId;
  readonly tabs: readonly FileTab[];
  /** The file it shows: for the focused group, the strip's selection when that's one of its files. */
  readonly active: FileTab | undefined;
}

interface FileTabs {
  readonly tabs: readonly FileTab[];
  /** The strip's file, which is the focused group's. */
  readonly active: FileTab | undefined;
  readonly groups: readonly FileGroup[];
  readonly group: EditorGroupId;
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

const CLEAN: FileState = { showSource: false, saving: false, draft: undefined };

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

/** Moves the entries of `key`'s files that `target` maps to their new paths. */
function rekey<Value>(
  map: Map<string, Value>,
  key: WorkbenchViewKey,
  target: (path: string) => string | undefined,
): void {
  const prefix = fileKey(key, "");

  for (const [held, value] of Array.from(map)) {
    const path = held.startsWith(prefix) ? target(held.slice(prefix.length)) : undefined;

    if (path === undefined) continue;
    map.delete(held);
    map.set(fileKey(key, path), value);
  }
}

/** One file in one view: tabs in different groups share it, views don't. */
function fileKey(key: WorkbenchViewKey, path: string): string {
  return `${key}\n${path}`;
}

/**
 * Open files over the workbench's file tabs. Tabs showing one file share its buffer, draft and
 * save state, kept until the last of them closes; closing one of several never asks. `split`
 * opens a tab's file, by default the strip's, in a new group beside its own; `place` drops a tab
 * into a group or beside it.
 */
export function createFileTabStore(
  store: WorkbenchStore = workbench,
  queries: QueryClient = queryClient,
) {
  const navigations = new Map<WorkbenchTabId, FileNavigation>();
  const files = new Map<string, FileState>();
  const buffers = new Map<string, FileBuffer>();
  const views = new Map<WorkbenchViewKey, FileViewRuntime>();

  const snapshots = new Map<
    WorkbenchViewKey,
    {
      readonly revision: number;
      readonly source: WorkbenchViewState;
      readonly scopes: readonly (FileScope | undefined)[];
      readonly view: FileTabs;
    }
  >();

  const listeners = new Set<() => void>();
  let revision = 0;

  const getRuntimeView = (key: WorkbenchViewKey): FileViewRuntime => views.get(key) ?? EMPTY_VIEW;

  const navigation = (id: WorkbenchTabId): FileNavigation =>
    navigations.get(id) ?? { navigationRevision: 0 };

  const fileState = (key: WorkbenchViewKey, path: string): FileState =>
    files.get(fileKey(key, path)) ?? CLEAN;

  const commit = (key: WorkbenchViewKey, action?: WorkbenchViewAction): void => {
    revision += 1;
    const before = store.getSnapshot();

    if (action !== undefined) store.dispatch(key, action);

    if (store.getSnapshot() !== before) return;

    for (const listener of listeners) listener();
  };

  const documentScope = (path: string): FileScope | undefined => {
    const document = queries.getQueryData<FileDocument>(keys.workspaceFile(path));

    return document === undefined || document.kind === "missing" ? undefined : document.scope;
  };

  const fileTabs = (key: WorkbenchViewKey): readonly FileTab[] =>
    store.getView(key).tabs.flatMap((tab) => {
      if (tab.kind !== "file") return [];
      const state = fileState(key, tab.path);

      const inside =
        documentScope(tab.path) === "external" ? undefined : workspaceFile(tab.path, [key]);

      return [
        {
          ...navigation(tab.id),
          ...state,
          id: tab.id,
          path: tab.path,
          group: tab.group,
          displayPath: inside?.relative ?? tab.path,
          external: inside === undefined,
          preview: tab.preview,
          dirty: state.draft !== undefined,
        },
      ];
    });

  const getView = (key: WorkbenchViewKey): FileTabs => {
    const workbenchView = store.getView(key);
    const cached = snapshots.get(key);

    const scopes = workbenchView.tabs.map((tab) =>
      tab.kind === "file" ? documentScope(tab.path) : undefined,
    );

    if (
      cached?.revision === revision &&
      cached.source === workbenchView &&
      cached.scopes.every((scope, index) => scope === scopes[index])
    )
      return cached.view;
    const current = getRuntimeView(key);
    const tabs = fileTabs(key);
    const active = tabs.find((tab) => tab.id === workbenchView.active);

    const view = {
      tabs,
      active,
      groups: workbenchView.groups.map((group) => {
        const held = tabs.filter((tab) => tab.group === group.id);

        return {
          id: group.id,
          tabs: held,
          active:
            group.id === workbenchView.group ? active : held.find((tab) => tab.id === group.active),
        };
      }),
      group: workbenchView.group,
      pendingClose: tabs.find((tab) => tab.id === current.pendingCloseId),
      canGoBack: current.historyIndex > 0,
      canGoForward: current.historyIndex < current.history.length - 1,
      revealPath: current.revealPath ?? undefined,
      revealRevision: current.revealRevision,
    };

    snapshots.set(key, { revision, source: workbenchView, scopes, view });

    return view;
  };

  const inGroup = (
    key: WorkbenchViewKey,
    path: string,
    group: EditorGroupId = store.getView(key).group,
  ): FileTab | undefined => fileTabs(key).find((tab) => tab.path === path && tab.group === group);

  const setFileState = (key: WorkbenchViewKey, path: string, change: Partial<FileState>): void => {
    const current = fileState(key, path);
    const next = { ...current, ...change };

    if (
      next.showSource === current.showSource &&
      next.saving === current.saving &&
      next.draft?.contents === current.draft?.contents &&
      next.draft?.version === current.draft?.version &&
      next.draft?.savedContents === current.draft?.savedContents
    )
      return;

    files.set(fileKey(key, path), next);

    const pinned =
      next.draft === undefined
        ? undefined
        : fileTabs(key).find((tab) => tab.path === path && tab.preview);

    commit(
      key,
      pinned === undefined
        ? undefined
        : { kind: "patch", id: pinned.id, change: { kind: "file", patch: { preview: false } } },
    );
  };

  const remove = (key: WorkbenchViewKey, id: WorkbenchTabId): void => {
    const current = getRuntimeView(key);
    const tab = fileTabs(key).find((candidate) => candidate.id === id);

    if (tab === undefined) return;
    navigations.delete(id);

    if (!fileTabs(key).some((other) => other.id !== id && other.path === tab.path)) {
      files.delete(fileKey(key, tab.path));
      buffers.delete(fileKey(key, tab.path));
    }

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

  const navigate = (id: WorkbenchTabId, location: FileLocation): void => {
    const previous = navigation(id);

    navigations.set(id, {
      line: location.line,
      column: location.column,
      length: location.length,
      navigationRevision: previous.navigationRevision + 1,
    });
  };

  const open = (
    key: WorkbenchViewKey,
    location: FileLocation & { readonly preview?: boolean },
    next: (current: FileViewRuntime) => FileViewRuntime,
  ): void => {
    const preview = location.preview === true;
    const group = store.getView(key).group;
    const existing = inGroup(key, location.path, group);
    const id = existing?.id ?? crypto.randomUUID();

    const replace =
      existing === undefined && preview
        ? fileTabs(key).find(
            (tab) => tab.group === group && tab.preview && !tab.dirty && !tab.saving,
          )?.id
        : undefined;

    if (replace !== undefined) navigations.delete(replace);
    navigate(id, location);

    if (location.line !== undefined)
      files.set(fileKey(key, location.path), {
        ...fileState(key, location.path),
        showSource: true,
      });

    views.set(key, next(getRuntimeView(key)));
    commit(key, {
      kind: "open-file",
      tab: { id, kind: "file", path: location.path, preview, group },
      replace,
    });
  };

  const historyStep = (key: WorkbenchViewKey, historyIndex: number): void => {
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
    close(key: WorkbenchViewKey, id: WorkbenchTabId): boolean {
      const tab = fileTabs(key).find((candidate) => candidate.id === id);

      if (tab === undefined) return true;

      const shared = fileTabs(key).some((other) => other.id !== id && other.path === tab.path);

      if (!shared && (tab.dirty || tab.saving)) {
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
      const pending = fileTabs(key).find((tab) => tab.id === getRuntimeView(key).pendingCloseId);

      if (pending !== undefined && !pending.saving) remove(key, pending.id);
    },
    setShowSource(key: WorkbenchViewKey, path: string, showSource: boolean): void {
      setFileState(key, path, { showSource });
    },
    setSaving(key: WorkbenchViewKey, path: string, saving: boolean): void {
      setFileState(key, path, { saving });
    },
    setDraft(key: WorkbenchViewKey, path: string, draft: FileDraft | undefined): void {
      setFileState(key, path, { draft });
    },
    buffer(key: WorkbenchViewKey, path: string, create: () => FileBuffer): FileBuffer {
      const held = buffers.get(fileKey(key, path));

      if (held !== undefined) return held;
      const made = create();
      buffers.set(fileKey(key, path), made);

      return made;
    },
    pin(key: WorkbenchViewKey, id: WorkbenchTabId): void {
      const tab = fileTabs(key).find((candidate) => candidate.id === id);

      if (tab?.preview === true)
        store.dispatch(key, {
          kind: "patch",
          id: tab.id,
          change: { kind: "file", patch: { preview: false } },
        });
    },
    split(key: WorkbenchViewKey, side: "before" | "after", id?: WorkbenchTabId): void {
      const source = fileTabs(key).find((tab) => tab.id === (id ?? store.getView(key).active));

      if (source === undefined) return;

      const tab: KindTab<"file"> = {
        id: crypto.randomUUID(),
        kind: "file",
        path: source.path,
        preview: false,
        group: source.group,
      };

      navigate(tab.id, source);
      commit(key, { kind: "split", tab, group: crypto.randomUUID(), side });
    },
    place(
      key: WorkbenchViewKey,
      id: WorkbenchTabId,
      into: EditorGroupId,
      zone: "before" | "center" | "after",
    ): void {
      commit(key, { kind: "place", id, into, zone, group: crypto.randomUUID() });
    },
    openBeside(
      key: WorkbenchViewKey,
      path: string,
      group: EditorGroupId,
      zone: "before" | "center" | "after",
    ): void {
      commit(key, { kind: "focus-group", group });

      if (zone === "center") {
        actions.open(key, { path });

        return;
      }

      const tab: KindTab<"file"> = {
        id: crypto.randomUUID(),
        kind: "file",
        path,
        preview: false,
        group,
      };

      navigate(tab.id, { path });
      commit(key, { kind: "split", tab, group: crypto.randomUUID(), side: zone });
    },
    focusGroup(key: WorkbenchViewKey, group: EditorGroupId): void {
      commit(key, { kind: "focus-group", group });
    },
    moved(
      key: WorkbenchViewKey,
      moves: readonly { readonly from: string; readonly to: string }[],
    ): void {
      const target = (path: string): string | undefined =>
        moves.flatMap((move) =>
          path === move.from
            ? [move.to]
            : path.startsWith(`${move.from}/`)
              ? [`${move.to}${path.slice(move.from.length)}`]
              : [],
        )[0];

      const current = getRuntimeView(key);

      views.set(key, {
        ...current,
        history: current.history.map((location) => ({
          ...location,
          path: target(location.path) ?? location.path,
        })),
      });

      rekey(files, key, target);
      rekey(buffers, key, target);

      for (const tab of fileTabs(key)) {
        const path = target(tab.path);

        if (path === undefined) continue;
        buffers.get(fileKey(key, path))?.move(path);
        store.dispatch(key, {
          kind: "patch",
          id: tab.id,
          change: { kind: "file", patch: { path } },
        });
      }

      commit(key);
    },
    back(key: WorkbenchViewKey): void {
      historyStep(key, getRuntimeView(key).historyIndex - 1);
    },
    forward(key: WorkbenchViewKey): void {
      historyStep(key, getRuntimeView(key).historyIndex + 1);
    },
  };

  return {
    getView,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);

      const unsubscribe = store.subscribe(listener);
      const prefix = keys.workspaceFile("");

      const unwatch = queries.getQueryCache().subscribe((event) => {
        if (event.query.queryKey[0] === prefix[0] && event.query.queryKey[1] === prefix[1])
          listener();
      });

      return () => {
        listeners.delete(listener);
        unsubscribe();
        unwatch();
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
