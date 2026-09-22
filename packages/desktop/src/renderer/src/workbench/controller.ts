import { useSyncExternalStore } from "react";
import type { Oid, SessionId } from "@nyte-ai/protocol";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

export const WORKBENCH_WIDTH_DEFAULT = 500;
const WORKBENCH_WIDTH_MIN = 384;
export const WORKBENCH_CENTER_WIDTH_MIN = 424;
export const WORKBENCH_STAGE_PANE_KEY = "stage";
export const WORKBENCH_ACTIVE_WIDTH_VARIABLE = "--nyte-active-workbench-width";

export type WorkbenchTabId = string;
export type WorkbenchViewKey = string;
export type WorkbenchTabKind = WorkbenchTab["kind"];

export type WorkbenchChangesScope =
  | { readonly kind: "uncommitted" }
  | { readonly kind: "staged" }
  | { readonly kind: "unstaged" }
  | { readonly kind: "turn"; readonly turnId: Oid }
  | { readonly kind: "commit"; readonly oid: string };

export type TerminalOwner =
  | { readonly kind: "user" }
  | { readonly kind: "agent"; readonly sessionId: SessionId; readonly jobId: string };

export type WorkbenchTab =
  | { readonly id: WorkbenchTabId; readonly kind: "terminal"; readonly owner: TerminalOwner }
  | {
      readonly id: WorkbenchTabId;
      readonly kind: "file";
      readonly path: string;
      readonly preview: boolean;
    }
  | {
      readonly id: WorkbenchTabId;
      readonly kind: "changes";
      readonly scope: WorkbenchChangesScope;
      readonly selectedPath: string | null;
      readonly pathRevealRevision: number;
      readonly scrollTop: number;
    }
  | { readonly id: WorkbenchTabId; readonly kind: "browser"; readonly url: string }
  | { readonly id: WorkbenchTabId; readonly kind: "files" };

export type WorkbenchTabInput = WorkbenchTab extends infer Tab
  ? Tab extends WorkbenchTab
    ? Omit<Tab, "id">
    : never
  : never;

export function sameChangesScope(
  left: WorkbenchChangesScope,
  right: WorkbenchChangesScope,
): boolean {
  switch (left.kind) {
    case "uncommitted":
    case "staged":
    case "unstaged":
      return right.kind === left.kind;
    case "turn":
      return right.kind === "turn" && right.turnId === left.turnId;
    case "commit":
      return right.kind === "commit" && right.oid === left.oid;
    default: {
      const _exhaustive: never = left;
      return _exhaustive;
    }
  }
}

export type WorkbenchTarget =
  | { readonly kind: "home" }
  | { readonly kind: "workspace"; readonly workspacePath: string }
  | { readonly kind: "session"; readonly sessionId: SessionId };

export type WorkbenchScope = { readonly kind: "pathless" } | { readonly kind: "project" };

export function workbenchScopeForTarget(
  target: WorkbenchTarget,
  currentWorkspacePath: string | undefined,
): WorkbenchScope {
  switch (target.kind) {
    case "home":
      return { kind: "pathless" };
    case "workspace":
      return { kind: "project" };
    case "session":
      return currentWorkspacePath === undefined ? { kind: "pathless" } : { kind: "project" };
    default: {
      const _exhaustive: never = target;
      return _exhaustive;
    }
  }
}

interface WorkbenchViewIdentity {
  readonly key: WorkbenchViewKey;
  readonly paneKey: string;
  readonly target: WorkbenchTarget;
}

const PATHLESS_TABS = Object.freeze(["browser", "terminal"] satisfies WorkbenchTabKind[]);
const PROJECT_TABS = Object.freeze([
  "files",
  "changes",
  "browser",
  "terminal",
] satisfies WorkbenchTabKind[]);

export function workbenchTabs(scope: WorkbenchScope): readonly WorkbenchTabKind[] {
  switch (scope.kind) {
    case "pathless":
      return PATHLESS_TABS;
    case "project":
      return PROJECT_TABS;
    default: {
      const _exhaustive: never = scope;
      return _exhaustive;
    }
  }
}

export function workbenchTabAvailable(scope: WorkbenchScope, kind: WorkbenchTabKind): boolean {
  switch (kind) {
    case "browser":
    case "terminal":
      return true;
    case "file":
    case "files":
    case "changes":
      return scope.kind === "project";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

type WorkbenchWidthBounds =
  | { readonly kind: "docked"; readonly min: number; readonly max: number }
  | { readonly kind: "overlay"; readonly min: number; readonly max: number };

export interface WorkbenchViewState {
  readonly tabs: readonly WorkbenchTab[];
  readonly active: WorkbenchTabId | null;
  readonly expanded: boolean;
  readonly collapsed: "floating" | "compact";
  readonly maximized: boolean;
  readonly width: number;
}

interface WorkbenchSnapshot {
  readonly views: ReadonlyMap<WorkbenchViewKey, WorkbenchViewState>;
}

type ChangesPatch = Omit<Extract<WorkbenchTab, { readonly kind: "changes" }>, "id" | "kind">;
type FilePatch = Omit<Extract<WorkbenchTab, { readonly kind: "file" }>, "id" | "kind" | "path">;
type BrowserPatch = Omit<Extract<WorkbenchTab, { readonly kind: "browser" }>, "id" | "kind">;

export type WorkbenchTabUpdate =
  | {
      readonly view: WorkbenchViewKey;
      readonly id: WorkbenchTabId;
      readonly kind: "changes";
      readonly patch: ChangesPatch;
    }
  | {
      readonly view: WorkbenchViewKey;
      readonly id: WorkbenchTabId;
      readonly kind: "file";
      readonly patch: FilePatch;
    }
  | {
      readonly view: WorkbenchViewKey;
      readonly id: WorkbenchTabId;
      readonly kind: "browser";
      readonly patch: BrowserPatch;
    };

export interface WorkbenchPersistence {
  read(): PersistedWorkbenchSnapshot | undefined;
  write(value: PersistedWorkbenchSnapshot): void;
}

export interface WorkbenchController {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => WorkbenchSnapshot;
  readonly getView: (key: WorkbenchViewKey) => WorkbenchViewState;
  readonly actions: {
    readonly openTab: (input: {
      readonly view: WorkbenchViewKey;
      readonly tab: WorkbenchTabInput;
      readonly activate: boolean;
    }) => WorkbenchTabId;
    readonly activateTab: (input: {
      readonly view: WorkbenchViewKey;
      readonly id: WorkbenchTabId;
    }) => void;
    readonly closeTab: (input: {
      readonly view: WorkbenchViewKey;
      readonly id: WorkbenchTabId;
    }) => void;
    readonly moveTab: (input: {
      readonly view: WorkbenchViewKey;
      readonly id: WorkbenchTabId;
      readonly index: number;
    }) => void;
    readonly updateTab: (input: WorkbenchTabUpdate) => void;
    readonly toggle: (input: { readonly view: WorkbenchViewKey }) => void;
    readonly toggleCollapsed: (input: { readonly view: WorkbenchViewKey }) => void;
    readonly toggleWorkbench: (input: {
      readonly view: WorkbenchViewKey;
      readonly scope: WorkbenchScope;
    }) => void;
    readonly toggleMaximized: (input: { readonly view: WorkbenchViewKey }) => void;
    readonly setWidth: (input: { readonly view: WorkbenchViewKey; readonly width: number }) => void;
  };
}

const STORAGE_KEY = "nyte:desktop:workbench:v6";
const VIEW_IDENTITIES = new Map<WorkbenchViewKey, WorkbenchViewIdentity>();
const DEFAULT_VIEW = Object.freeze({
  tabs: Object.freeze([]),
  active: null,
  expanded: false,
  collapsed: "floating",
  maximized: false,
  width: WORKBENCH_WIDTH_DEFAULT,
}) satisfies WorkbenchViewState;

const strict = { additionalProperties: false };
const nonEmpty = Type.String({ minLength: 1 });
const persistedFileTab = Type.Object(
  {
    id: nonEmpty,
    kind: Type.Literal("file"),
    path: nonEmpty,
    preview: Type.Boolean(),
  },
  strict,
);
const persistedChangesTab = Type.Object(
  {
    id: nonEmpty,
    kind: Type.Literal("changes"),
    scope: Type.Union([
      Type.Object({ kind: Type.Literal("uncommitted") }, strict),
      Type.Object({ kind: Type.Literal("staged") }, strict),
      Type.Object({ kind: Type.Literal("unstaged") }, strict),
      Type.Object({ kind: Type.Literal("turn"), turnId: nonEmpty }, strict),
      Type.Object({ kind: Type.Literal("commit"), oid: nonEmpty }, strict),
    ]),
    selectedPath: Type.Union([nonEmpty, Type.Null()]),
    pathRevealRevision: Type.Integer({ minimum: 0 }),
    scrollTop: Type.Number({ minimum: 0 }),
  },
  strict,
);
const persistedBrowserTab = Type.Object(
  { id: nonEmpty, kind: Type.Literal("browser"), url: nonEmpty },
  strict,
);
const persistedFilesTab = Type.Object({ id: nonEmpty, kind: Type.Literal("files") }, strict);
const persistedTab = Type.Union([
  persistedFileTab,
  persistedChangesTab,
  persistedBrowserTab,
  persistedFilesTab,
]);
const persistedWorkbenchView = Type.Object(
  {
    key: nonEmpty,
    tabs: Type.Array(persistedTab),
    active: Type.Union([nonEmpty, Type.Null()]),
    expanded: Type.Boolean(),
    maximized: Type.Boolean(),
    width: Type.Number(),
  },
  strict,
);
const persistedWorkbenchSnapshot = Type.Object(
  { version: Type.Literal(6), views: Type.Array(persistedWorkbenchView) },
  strict,
);

type PersistedWorkbenchSnapshot = Static<typeof persistedWorkbenchSnapshot>;
type PersistedTab = Static<typeof persistedTab>;

function persistedTabFor(tab: WorkbenchTab): PersistedTab | undefined {
  switch (tab.kind) {
    case "file":
    case "browser":
    case "files":
    case "changes":
      return tab;
    case "terminal":
      return undefined;
    default: {
      const _exhaustive: never = tab;
      return _exhaustive;
    }
  }
}

export function activeWorkbenchTab(
  view: WorkbenchViewState,
  scope: WorkbenchScope,
): WorkbenchTab | null {
  if (view.active === null) return null;
  const active = view.tabs.find((tab) => tab.id === view.active);
  if (active !== undefined && workbenchTabAvailable(scope, active.kind)) return active;
  return view.tabs.find((tab) => workbenchTabAvailable(scope, tab.kind)) ?? null;
}

export function workbenchTabLabel(tab: WorkbenchTab | WorkbenchTabKind): string {
  if (typeof tab !== "string" && tab.kind === "file") {
    return tab.path.split(/[\\/]/).at(-1) ?? tab.path;
  }
  const kind = typeof tab === "string" ? tab : tab.kind;
  switch (kind) {
    case "file":
      return "File";
    case "files":
      return "Files";
    case "changes":
      return "Changes";
    case "browser":
      return "Browser";
    case "terminal":
      return "Terminal";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

export function defaultWorkbenchTab(kind: WorkbenchTabKind): WorkbenchTabInput {
  switch (kind) {
    case "files":
      return { kind: "files" };
    case "changes":
      return {
        kind: "changes",
        scope: { kind: "uncommitted" },
        selectedPath: null,
        pathRevealRevision: 0,
        scrollTop: 0,
      };
    case "browser":
      return { kind: "browser", url: "about:blank" };
    case "terminal":
      return { kind: "terminal", owner: { kind: "user" } };
    case "file":
      throw new Error("A file tab requires a path");
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

function clampWorkbenchWidth(width: number): number {
  return Number.isFinite(width)
    ? Math.max(WORKBENCH_WIDTH_MIN, Math.round(width))
    : WORKBENCH_WIDTH_DEFAULT;
}

export function workbenchWidthBounds(availableWidth: number): WorkbenchWidthBounds {
  const width = Math.max(0, Math.floor(availableWidth));
  if (width < WORKBENCH_WIDTH_MIN + WORKBENCH_CENTER_WIDTH_MIN) {
    return Object.freeze({
      kind: "overlay",
      min: Math.min(WORKBENCH_WIDTH_MIN, width),
      max: width,
    });
  }
  return Object.freeze({
    kind: "docked",
    min: WORKBENCH_WIDTH_MIN,
    max: width - WORKBENCH_CENTER_WIDTH_MIN,
  });
}

export function clampWorkbenchWidthToBounds(width: number, bounds: WorkbenchWidthBounds): number {
  const normalized = Number.isFinite(width) ? Math.round(width) : WORKBENCH_WIDTH_DEFAULT;
  return Math.min(bounds.max, Math.max(bounds.min, normalized));
}

export function decodePersistedWorkbenchSnapshot(
  serialized: string,
): PersistedWorkbenchSnapshot | undefined {
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!Value.Check(persistedWorkbenchSnapshot, parsed)) return undefined;
    const valid = parsed.views.every((view) => {
      const ids = new Set(view.tabs.map((tab) => tab.id));
      return (
        ids.size === view.tabs.length &&
        (view.active === null ? view.tabs.length === 0 && !view.expanded : ids.has(view.active))
      );
    });
    return valid ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function restoreSnapshot(persisted: PersistedWorkbenchSnapshot | undefined): WorkbenchSnapshot {
  const views = new Map<WorkbenchViewKey, WorkbenchViewState>();
  for (const stored of persisted?.views ?? []) {
    const tabs: readonly WorkbenchTab[] = stored.tabs;
    const active = tabs.some((tab) => tab.id === stored.active)
      ? stored.active
      : (tabs[0]?.id ?? null);
    views.set(
      stored.key,
      Object.freeze({
        tabs: Object.freeze(tabs.map((tab) => Object.freeze(tab))),
        active,
        expanded: stored.expanded && active !== null,
        collapsed: "floating",
        maximized: stored.maximized,
        width: clampWorkbenchWidth(stored.width),
      }),
    );
  }
  return Object.freeze({ views });
}

function persistable(snapshot: WorkbenchSnapshot): PersistedWorkbenchSnapshot {
  return {
    version: 6,
    views: [...snapshot.views].map(([key, view]) => {
      const tabs = view.tabs.flatMap((tab) => {
        const persisted = persistedTabFor(tab);
        return persisted === undefined ? [] : [persisted];
      });
      const active = tabs.find((tab) => tab.id === view.active)?.id ?? tabs[0]?.id ?? null;
      return {
        key,
        tabs,
        active,
        expanded: view.expanded && active !== null,
        maximized: view.maximized,
        width: view.width,
      };
    }),
  };
}

function browserPersistence(): WorkbenchPersistence | undefined {
  if (globalThis.window === undefined) return undefined;
  return {
    read() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        return raw === null ? undefined : decodePersistedWorkbenchSnapshot(raw);
      } catch {
        return undefined;
      }
    },
    write(value) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      } catch {
        return;
      }
    },
  };
}

export function workbenchViewKey(input: {
  readonly paneKey: string;
  readonly target: WorkbenchTarget;
}): WorkbenchViewKey {
  if (input.paneKey === "") throw new Error("Invalid workbench pane key: empty");
  let targetKey: string;
  switch (input.target.kind) {
    case "home":
      targetKey = "home";
      break;
    case "workspace":
      targetKey = `workspace:${encodeURIComponent(input.target.workspacePath)}`;
      break;
    case "session":
      targetKey = `session:${encodeURIComponent(input.target.sessionId)}`;
      break;
    default: {
      const _exhaustive: never = input.target;
      return _exhaustive;
    }
  }
  const key = `${encodeURIComponent(input.paneKey)}:${targetKey}`;
  if (!VIEW_IDENTITIES.has(key)) {
    VIEW_IDENTITIES.set(
      key,
      Object.freeze({ key, paneKey: input.paneKey, target: Object.freeze({ ...input.target }) }),
    );
  }
  return key;
}

export function workbenchViewIdentity(key: WorkbenchViewKey): WorkbenchViewIdentity | undefined {
  return VIEW_IDENTITIES.get(key);
}

function freezeView(view: WorkbenchViewState): WorkbenchViewState {
  return Object.freeze({
    ...view,
    tabs: Object.freeze(view.tabs.map((tab) => Object.freeze(tab))),
  });
}

function sameTab(tab: WorkbenchTab, input: WorkbenchTabInput): boolean {
  if (tab.kind !== input.kind) return false;
  switch (tab.kind) {
    case "file":
      return input.kind === "file" && tab.path === input.path;
    case "terminal":
      return (
        input.kind === "terminal" &&
        tab.owner.kind === "agent" &&
        input.owner.kind === "agent" &&
        tab.owner.sessionId === input.owner.sessionId &&
        tab.owner.jobId === input.owner.jobId
      );
    case "browser":
      return input.kind === "browser" && tab.url === input.url;
    case "changes":
    case "files":
      return true;
    default: {
      const _exhaustive: never = tab;
      return _exhaustive;
    }
  }
}

function sameTabUpdate(tab: WorkbenchTab, input: WorkbenchTabUpdate): boolean {
  switch (input.kind) {
    case "changes":
      return (
        tab.kind === "changes" &&
        sameChangesScope(tab.scope, input.patch.scope) &&
        tab.selectedPath === input.patch.selectedPath &&
        tab.pathRevealRevision === input.patch.pathRevealRevision &&
        tab.scrollTop === input.patch.scrollTop
      );
    case "file":
      return tab.kind === "file" && tab.preview === input.patch.preview;
    case "browser":
      return tab.kind === "browser" && tab.url === input.patch.url;
    default: {
      const _exhaustive: never = input;
      return _exhaustive;
    }
  }
}

export function createWorkbenchController(persistence?: WorkbenchPersistence): WorkbenchController {
  let snapshot = restoreSnapshot(persistence?.read());
  const listeners = new Set<() => void>();

  const publish = (key: WorkbenchViewKey, view: WorkbenchViewState): void => {
    const views = new Map(snapshot.views);
    views.set(key, freezeView(view));
    snapshot = Object.freeze({ views });
    persistence?.write(persistable(snapshot));
    for (const listener of listeners) listener();
  };

  const update = (
    key: WorkbenchViewKey,
    change: (current: WorkbenchViewState) => WorkbenchViewState,
  ): void => {
    const current = snapshot.views.get(key) ?? DEFAULT_VIEW;
    const next = change(current);
    if (next !== current) publish(key, next);
  };

  const actions: WorkbenchController["actions"] = {
    openTab({ view, tab, activate }) {
      const current = snapshot.views.get(view) ?? DEFAULT_VIEW;
      const existing = current.tabs.find((candidate) => sameTab(candidate, tab));
      if (existing !== undefined) {
        if (activate && (current.active !== existing.id || !current.expanded)) {
          publish(view, { ...current, active: existing.id, expanded: true });
        }
        return existing.id;
      }
      const id = crypto.randomUUID();
      const next = { id, ...tab } satisfies WorkbenchTab;
      publish(view, {
        ...current,
        tabs: [...current.tabs, next],
        active: activate ? id : current.active,
        expanded: activate ? true : current.expanded,
      });
      return id;
    },
    activateTab({ view, id }) {
      update(view, (current) =>
        current.tabs.some((tab) => tab.id === id) && (current.active !== id || !current.expanded)
          ? { ...current, active: id, expanded: true }
          : current,
      );
    },
    closeTab({ view, id }) {
      update(view, (current) => {
        const index = current.tabs.findIndex((tab) => tab.id === id);
        if (index === -1) return current;
        const tabs = current.tabs.filter((tab) => tab.id !== id);
        const active =
          current.active === id ? (tabs[index]?.id ?? tabs[index - 1]?.id ?? null) : current.active;
        return {
          ...current,
          tabs,
          active,
          expanded: current.expanded && active !== null,
        };
      });
    },
    moveTab({ view, id, index }) {
      update(view, (current) => {
        const from = current.tabs.findIndex((tab) => tab.id === id);
        if (from === -1) return current;
        const target = Math.max(0, Math.min(current.tabs.length - 1, Math.round(index)));
        if (from === target) return current;
        const tabs = [...current.tabs];
        const [tab] = tabs.splice(from, 1);
        if (tab === undefined) return current;
        tabs.splice(target, 0, tab);
        return { ...current, tabs };
      });
    },
    updateTab(input) {
      update(input.view, (current) => {
        const tab = current.tabs.find((candidate) => candidate.id === input.id);
        if (tab === undefined || tab.kind !== input.kind || sameTabUpdate(tab, input))
          return current;
        const tabs = current.tabs.map((candidate): WorkbenchTab => {
          if (candidate !== tab) return candidate;
          switch (input.kind) {
            case "changes":
              return candidate.kind === "changes"
                ? { id: candidate.id, kind: "changes", ...input.patch }
                : candidate;
            case "file":
              return candidate.kind === "file"
                ? { ...candidate, preview: input.patch.preview }
                : candidate;
            case "browser":
              return candidate.kind === "browser"
                ? { id: candidate.id, kind: "browser", ...input.patch }
                : candidate;
            default: {
              const _exhaustive: never = input;
              return _exhaustive;
            }
          }
        });
        return { ...current, tabs };
      });
    },
    toggle({ view }) {
      const current = snapshot.views.get(view) ?? DEFAULT_VIEW;
      if (current.expanded) {
        publish(view, { ...current, expanded: false });
        return;
      }
      if (current.active !== null && current.tabs.some((tab) => tab.id === current.active)) {
        publish(view, { ...current, expanded: true });
        return;
      }
      const first = current.tabs[0];
      if (first !== undefined) {
        publish(view, { ...current, active: first.id, expanded: true });
        return;
      }
      actions.openTab({ view, tab: defaultWorkbenchTab("browser"), activate: true });
    },
    toggleCollapsed({ view }) {
      update(view, (current) => ({
        ...current,
        collapsed: current.collapsed === "floating" ? "compact" : "floating",
      }));
    },
    toggleMaximized({ view }) {
      update(view, (current) => ({ ...current, maximized: !current.maximized }));
    },
    toggleWorkbench({ view, scope }) {
      const current = snapshot.views.get(view) ?? DEFAULT_VIEW;
      if (current.expanded && activeWorkbenchTab(current, scope) === null) {
        actions.openTab({ view, tab: defaultWorkbenchTab("browser"), activate: true });
        return;
      }
      actions.toggle({ view });
    },
    setWidth({ view, width }) {
      const nextWidth = clampWorkbenchWidth(width);
      update(view, (current) =>
        current.width === nextWidth ? current : { ...current, width: nextWidth },
      );
    },
  };

  return Object.freeze({
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    getView: (key: WorkbenchViewKey) => snapshot.views.get(key) ?? DEFAULT_VIEW,
    actions: Object.freeze(actions),
  });
}

export const workbenchController = createWorkbenchController(browserPersistence());

export function useWorkbenchSnapshot(): WorkbenchSnapshot {
  return useSyncExternalStore(
    workbenchController.subscribe,
    workbenchController.getSnapshot,
    workbenchController.getSnapshot,
  );
}
