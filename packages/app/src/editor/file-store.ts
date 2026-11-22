import type { EditorViewState } from "@nyte-ai/ui/diffs/edit";
import { useSyncExternalStore } from "react";
import type { MessageReference } from "../references/message-references.ts";
import type {
  EditorDrop,
  EditorGroupId,
  EditorTarget,
  KindTab,
  WorkbenchTabId,
  WorkbenchViewKey,
  WorkbenchViewState,
} from "../workbench/model.ts";
import { activeEditorFile } from "../workbench/model.ts";
import { workspaceFile } from "../workbench/paths.ts";
import { workbench } from "../workbench/store.ts";
import type { WorkbenchStore } from "../workbench/store.ts";
import type { WorkbenchViewAction } from "../workbench/view-reducer.ts";
import type { FileBuffer, FileDocumentSnapshot } from "./file-document.ts";

type FileLineRange = NonNullable<Extract<MessageReference, { readonly kind: "file" }>["lines"]>;

export type FileTarget =
  | { readonly kind: "position"; readonly line: number; readonly column?: number }
  | {
      readonly kind: "match";
      readonly line: number;
      readonly column: number;
      readonly length: number;
    }
  | { readonly kind: "lines"; readonly lines: FileLineRange }
  | {
      readonly kind: "range";
      readonly line: number;
      readonly column: number;
      readonly endLine: number;
      readonly endColumn: number;
    }
  | { readonly kind: "view"; readonly view: EditorViewState };

interface FileLocation {
  readonly path: string;
  readonly target?: FileTarget;
}

export type DocumentHolder = `tab:${WorkbenchTabId}` | "design";

interface HeldDocument {
  readonly buffer: FileBuffer;
  readonly holders: Set<DocumentHolder>;
}

type FileDraft = Pick<FileDocumentSnapshot, "savedContents" | "version"> & {
  readonly contents: string;
};

interface FileNavigation {
  readonly target?: FileTarget;
  readonly navigationRevision: number;
}

interface FileState {
  readonly showSource: boolean;
  readonly readOnly: boolean;
  readonly saving: boolean;
  readonly draft: FileDraft | undefined;
}

export interface FileTab extends FileNavigation, FileState {
  readonly displayPath: string;
  readonly external: boolean;
  readonly id: WorkbenchTabId;
  readonly path: string;
  readonly group: EditorGroupId;
  readonly preview: boolean;
  readonly dirty: boolean;
}

interface FileViewRuntime {
  readonly recent: readonly string[];
  readonly back: readonly FileLocation[];
  readonly forward: readonly FileLocation[];
  readonly closeQueue: readonly WorkbenchTabId[];
  readonly revealPath: string | null;
  readonly revealRevision: number;
}

export interface FileGroup {
  readonly id: EditorGroupId;
  readonly tabs: readonly FileTab[];
  readonly active: FileTab | undefined;
}

interface FileTabs {
  readonly recent: readonly string[];
  readonly tabs: readonly FileTab[];
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
  recent: [],
  back: [],
  forward: [],
  closeQueue: [],
  revealPath: null,
  revealRevision: 0,
};

const CLEAN: FileState = { showSource: false, readOnly: false, saving: false, draft: undefined };

const HISTORY_LIMIT = 150;

const MERGE_LINES = 4;

function targetLine(target: FileTarget | undefined): number {
  if (target === undefined) return 1;

  switch (target.kind) {
    case "lines":
      return target.lines.start;
    case "view": {
      const primary = target.view.selections?.at(-1);

      if (primary === undefined) return 1;

      return (primary.direction === -1 ? primary.start.line : primary.end.line) + 1;
    }
    default:
      return target.line;
  }
}

function samePlace(first: FileLocation, second: FileLocation): boolean {
  if (first.path !== second.path) return false;

  if (first.target?.kind !== "view" || second.target?.kind !== "view") {
    return targetLine(first.target) === targetLine(second.target);
  }
  const one = first.target.view.selections?.at(-1);
  const two = second.target.view.selections?.at(-1);

  return (
    one?.start.line === two?.start.line &&
    one?.start.character === two?.start.character &&
    one?.end.line === two?.end.line &&
    one?.end.character === two?.end.character
  );
}

function pushPlace(stack: readonly FileLocation[], place: FileLocation): readonly FileLocation[] {
  const last = stack.at(-1);

  const kept =
    last !== undefined &&
    last.path === place.path &&
    Math.abs(targetLine(last.target) - targetLine(place.target)) < MERGE_LINES
      ? stack.slice(0, -1)
      : stack;

  return [...kept, place].slice(-HISTORY_LIMIT);
}

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

function fileKey(key: WorkbenchViewKey, path: string): string {
  return `${key}\n${path}`;
}

export function createFileTabStore(store: WorkbenchStore = workbench) {
  const navigations = new Map<WorkbenchTabId, FileNavigation>();
  const files = new Map<string, FileState>();
  const buffers = new Map<string, HeldDocument>();
  const views = new Map<WorkbenchViewKey, FileViewRuntime>();
  const places = new Map<WorkbenchTabId, () => FileTarget | undefined>();

  const snapshots = new Map<
    WorkbenchViewKey,
    {
      readonly revision: number;
      readonly source: WorkbenchViewState;
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

  const fileTabs = (key: WorkbenchViewKey): readonly FileTab[] =>
    store.getView(key).tabs.flatMap((tab) => {
      if (tab.kind !== "file") return [];
      const state = fileState(key, tab.path);

      const inside = workspaceFile(tab.path, [key]);

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

    if (cached?.revision === revision && cached.source === workbenchView) return cached.view;
    const current = getRuntimeView(key);
    const tabs = fileTabs(key);
    const selected = activeEditorFile(workbenchView);
    const active = tabs.find((tab) => tab.id === selected?.id);

    const view = {
      recent: current.recent,
      tabs,
      active,
      groups: workbenchView.groups.map((group) => {
        const held = tabs.filter((tab) => tab.group === group.id);

        return {
          id: group.id,
          tabs: held,
          active: held.find((tab) => tab.id === group.active) ?? held[0],
        };
      }),
      group: workbenchView.group,
      pendingClose: current.closeQueue
        .map((id) => tabs.find((tab) => tab.id === id))
        .find((tab) => tab !== undefined),
      canGoBack: current.back.length > 0,
      canGoForward: current.forward.length > 0,
      revealPath: current.revealPath ?? undefined,
      revealRevision: current.revealRevision,
    };

    snapshots.set(key, { revision, source: workbenchView, view });

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
      next.readOnly === current.readOnly &&
      next.saving === current.saving &&
      next.draft?.contents === current.draft?.contents &&
      next.draft?.version === current.draft?.version &&
      next.draft?.savedContents === current.draft?.savedContents
    ) {
      return;
    }

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

  const release = (entry: HeldDocument, holder: DocumentHolder): void => {
    entry.holders.delete(holder);

    if (entry.holders.size > 0) return;

    for (const [held, other] of buffers) if (other === entry) buffers.delete(held);
  };

  const releaseTab = (key: WorkbenchViewKey, id: WorkbenchTabId, path: string): void => {
    const entry = buffers.get(fileKey(key, path));

    if (entry !== undefined) release(entry, `tab:${id}`);
  };

  const holdDocument = (input: {
    readonly view: WorkbenchViewKey;
    readonly path: string;
    readonly holder: DocumentHolder;
    readonly create: () => FileBuffer;
  }) => {
    const key = fileKey(input.view, input.path);
    const entry = buffers.get(key) ?? { buffer: input.create(), holders: new Set() };

    buffers.set(key, entry);
    entry.holders.add(input.holder);

    return { buffer: entry.buffer, release: () => release(entry, input.holder) };
  };

  const remove = (key: WorkbenchViewKey, id: WorkbenchTabId): void => {
    const current = getRuntimeView(key);
    const tab = fileTabs(key).find((candidate) => candidate.id === id);

    if (tab === undefined) return;
    navigations.delete(id);
    releaseTab(key, id, tab.path);

    if (!fileTabs(key).some((other) => other.id !== id && other.path === tab.path)) {
      files.delete(fileKey(key, tab.path));
    }

    places.delete(id);
    views.set(key, {
      ...current,
      closeQueue: current.closeQueue.filter((pending) => pending !== id),
    });
    commit(key, { kind: "close", id });
  };

  const advanceCloseQueue = (key: WorkbenchViewKey): void => {
    for (const id of getRuntimeView(key).closeQueue) {
      const tabs = fileTabs(key);
      const tab = tabs.find((candidate) => candidate.id === id);

      if (tab === undefined) {
        const current = getRuntimeView(key);
        views.set(key, {
          ...current,
          closeQueue: current.closeQueue.filter((pending) => pending !== id),
        });
        continue;
      }

      const shared = tabs.some((other) => other.id !== id && other.path === tab.path);

      if (!shared && (tab.dirty || tab.saving)) return;
      remove(key, id);
    }
  };

  const navigate = (id: WorkbenchTabId, location: FileLocation): void => {
    const previous = navigation(id);

    navigations.set(id, {
      target: location.target,
      navigationRevision: previous.navigationRevision + 1,
    });
  };

  const open = (
    key: WorkbenchViewKey,
    location: FileLocation & { readonly preview?: boolean; readonly readOnly?: boolean },
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

    const replaced = fileTabs(key).find((tab) => tab.id === replace);

    if (replaced !== undefined) {
      navigations.delete(replaced.id);
      releaseTab(key, replaced.id, replaced.path);
    }

    navigate(id, location);

    if (location.target !== undefined || location.readOnly === true) {
      files.set(fileKey(key, location.path), {
        ...fileState(key, location.path),
        showSource: location.target !== undefined || fileState(key, location.path).showSource,
        readOnly: location.readOnly === true || fileState(key, location.path).readOnly,
      });
    }

    views.set(key, next(getRuntimeView(key)));
    commit(key, {
      kind: "open-file",
      tab: { id, kind: "file", path: location.path, preview, group },
      replace,
    });
  };

  const currentPlace = (key: WorkbenchViewKey): FileLocation | undefined => {
    const view = store.getView(key);
    const active = activeEditorFile(view);

    if (active === undefined) return undefined;

    return { path: active.path, target: places.get(active.id)?.() ?? navigation(active.id).target };
  };

  const actions = {
    remember(key: WorkbenchViewKey, path: string): void {
      const current = getRuntimeView(key);

      if (current.recent[0] === path) return;
      views.set(key, {
        ...current,
        recent: [path, ...current.recent.filter((held) => held !== path)],
      });
      commit(key);
    },
    open(
      key: WorkbenchViewKey,
      location: FileLocation & { readonly preview?: boolean; readonly readOnly?: boolean },
    ): void {
      const here = currentPlace(key);

      open(key, location, (current) =>
        here === undefined || samePlace(here, location)
          ? current
          : { ...current, back: pushPlace(current.back, here), forward: [] },
      );
    },
    track(id: WorkbenchTabId, read: () => FileTarget | undefined): () => void {
      places.set(id, read);

      return () => {
        if (places.get(id) === read) places.delete(id);
      };
    },
    reveal(key: WorkbenchViewKey, displayPath: string): void {
      const current = getRuntimeView(key);
      views.set(key, {
        ...current,
        revealPath: displayPath,
        revealRevision: current.revealRevision + 1,
      });
      const active = getView(key).active;

      commit(
        key,
        active === undefined
          ? {
              kind: "open",
              tab: { id: crypto.randomUUID(), kind: "editor" },
              activate: true,
            }
          : { kind: "activate", id: active.id },
      );
    },
    close(key: WorkbenchViewKey, id: WorkbenchTabId): boolean {
      const tab = fileTabs(key).find((candidate) => candidate.id === id);

      if (tab === undefined) return true;

      const shared = fileTabs(key).some((other) => other.id !== id && other.path === tab.path);

      if (!shared && (tab.dirty || tab.saving)) {
        const current = getRuntimeView(key);

        if (!current.closeQueue.includes(tab.id)) {
          views.set(key, { ...current, closeQueue: [...current.closeQueue, tab.id] });
          commit(key);
        }

        return false;
      }

      remove(key, tab.id);

      return true;
    },
    closeGroup(key: WorkbenchViewKey, group: EditorGroupId): boolean {
      for (const tab of fileTabs(key)) if (tab.group === group) actions.close(key, tab.id);

      return !fileTabs(key).some((tab) => tab.group === group);
    },
    cancelClose(key: WorkbenchViewKey): void {
      const current = getRuntimeView(key);

      if (current.closeQueue.length === 0) return;
      views.set(key, { ...current, closeQueue: [] });
      commit(key);
    },
    discardClose(key: WorkbenchViewKey): void {
      const pending = getView(key).pendingClose;

      if (pending === undefined || pending.saving) return;
      remove(key, pending.id);
      advanceCloseQueue(key);
    },
    setReadOnly(key: WorkbenchViewKey, path: string, readOnly: boolean): void {
      setFileState(key, path, { readOnly });
    },
    documents(
      key: WorkbenchViewKey,
    ): readonly (FileDocumentSnapshot & { readonly path: string; readonly contents: string })[] {
      const prefix = fileKey(key, "");

      return [...buffers].flatMap((entry) =>
        entry[0].startsWith(prefix)
          ? [
              {
                ...entry[1].buffer.getSnapshot(),
                contents: entry[1].buffer.text(),
                path: entry[0].slice(prefix.length),
              },
            ]
          : [],
      );
    },
    buffer(key: WorkbenchViewKey, path: string): FileBuffer | undefined {
      return buffers.get(fileKey(key, path))?.buffer;
    },
    holds(key: WorkbenchViewKey, id: WorkbenchTabId): boolean {
      return store.getView(key).tabs.some((tab) => tab.id === id);
    },
    setShowSource(key: WorkbenchViewKey, path: string, showSource: boolean): void {
      setFileState(key, path, { showSource });
    },
    toggleSource(key: WorkbenchViewKey, path: string): void {
      setFileState(key, path, { showSource: !fileState(key, path).showSource });
    },
    setSaving(key: WorkbenchViewKey, path: string, saving: boolean): void {
      setFileState(key, path, { saving });
      advanceCloseQueue(key);
    },
    setDraft(key: WorkbenchViewKey, path: string, draft: FileDraft | undefined): void {
      setFileState(key, path, { draft });
      advanceCloseQueue(key);
    },
    pin(key: WorkbenchViewKey, id: WorkbenchTabId): void {
      const tab = fileTabs(key).find((candidate) => candidate.id === id);

      if (tab?.preview === true) {
        store.dispatch(key, {
          kind: "patch",
          id: tab.id,
          change: { kind: "file", patch: { preview: false } },
        });
      }
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
    place(key: WorkbenchViewKey, source: EditorDrop, target: EditorTarget): void {
      const held = store.getView(key).tabs.find((tab) => {
        if (tab.kind !== "file") return false;

        if (source.kind === "tab") return tab.id === source.id;

        return (
          (target.kind === "tabs" || target.zone === "center") &&
          tab.path === source.path &&
          tab.group === target.group
        );
      });

      const tab: KindTab<"file"> | undefined =
        held?.kind === "file"
          ? held
          : source.kind === "file"
            ? {
                id: crypto.randomUUID(),
                kind: "file",
                path: source.path,
                preview: false,
                group: target.group,
              }
            : undefined;

      if (tab === undefined) return;

      if (held === undefined) navigate(tab.id, { path: tab.path });
      commit(key, { kind: "place", tab, target, group: crypto.randomUUID() });

      if (
        source.kind === "tab" &&
        !store.getView(key).tabs.some((entry) => entry.id === source.id)
      ) {
        navigations.delete(source.id);
      }
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
        recent: [...new Set(current.recent.map((path) => target(path) ?? path))],
        back: current.back.map((location) => ({
          ...location,
          path: target(location.path) ?? location.path,
        })),
        forward: current.forward.map((location) => ({
          ...location,
          path: target(location.path) ?? location.path,
        })),
      });

      const prefix = fileKey(key, "");

      for (const [held, entry] of buffers) {
        const path = held.startsWith(prefix) ? target(held.slice(prefix.length)) : undefined;

        if (path !== undefined) entry.buffer.move(path);
      }

      rekey(files, key, target);
      rekey(buffers, key, target);

      for (const tab of fileTabs(key)) {
        const path = target(tab.path);

        if (path === undefined) continue;
        store.dispatch(key, {
          kind: "patch",
          id: tab.id,
          change: { kind: "file", patch: { path } },
        });
      }

      commit(key);
    },
    back(key: WorkbenchViewKey): void {
      const location = getRuntimeView(key).back.at(-1);

      if (location === undefined) return;
      const here = currentPlace(key);

      open(key, location, (current) => ({
        ...current,
        back: current.back.slice(0, -1),
        forward: here === undefined ? current.forward : [...current.forward, here],
      }));
    },
    forward(key: WorkbenchViewKey): void {
      const here = currentPlace(key);
      const stack = getRuntimeView(key).forward;
      const skipped = stack.findLastIndex(
        (location) => here === undefined || !samePlace(here, location),
      );
      const location = stack[skipped];

      if (location === undefined) return;
      open(key, location, (current) => ({
        ...current,
        back: here === undefined ? current.back : pushPlace(current.back, here),
        forward: current.forward.slice(0, skipped),
      }));
    },
  };

  return {
    getView,
    unsaved: (): boolean => [...files.values()].some((file) => file.draft !== undefined),
    holdDocument,
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

export const holdDocument = fileStore.holdDocument;

export function scheduleSave(
  buffer: FileBuffer,
  save: () => Promise<void>,
  delayMs: number,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = (): void => {
    clearTimeout(timer);
    timer = undefined;
    const current = buffer.getSnapshot();

    if (
      !current.dirty ||
      current.remote ||
      (current.status.kind !== "idle" && current.status.kind !== "saved")
    ) {
      return;
    }

    timer = setTimeout(() => {
      timer = undefined;
      void save();
    }, delayMs);
  };

  schedule();
  const unsubscribe = buffer.subscribe(schedule);

  return () => {
    unsubscribe();
    clearTimeout(timer);
  };
}

export function watchUnsavedEdits(report: (held: boolean) => void): () => void {
  let held = false;

  return fileStore.subscribe(() => {
    const next = fileStore.unsaved();

    if (next === held) return;
    held = next;
    report(next);
  });
}

export function useFileTabs(viewKey: WorkbenchViewKey): FileTabs {
  const view = (): FileTabs => fileStore.getView(viewKey);

  return useSyncExternalStore(fileStore.subscribe, view, view);
}
