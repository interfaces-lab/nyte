/**
 * Window-lifetime workbench state. The controller lives outside route leaves,
 * so a pane can change sessions without throwing away loaded panel state.
 *
 * Based on https://github.com/interfaces-lab/honk/blob/main/packages/app/src/workbench-controller.ts
 */
import { useSyncExternalStore } from "react";
import type { Oid, SessionId } from "@nyte-ai/core";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

export const WORKBENCH_WIDTH_DEFAULT = 500;
const WORKBENCH_WIDTH_MIN = 384;
export const WORKBENCH_CENTER_WIDTH_MIN = 424;
export const WORKBENCH_STAGE_PANE_KEY = "stage";
/** Read by the title bar to draw the column seam above the open panel. */
export const WORKBENCH_ACTIVE_WIDTH_VARIABLE = "--nyte-active-workbench-width";

export type WorkbenchTabId = "files" | "changes" | "browser" | "terminal" | "agents";
type WorkbenchScrollableTabId = "changes";
export type WorkbenchViewKey = string & { readonly __brand: "WorkbenchViewKey" };
/**
 * Which set of changes the Changes panel shows. `uncommitted` is the whole
 * working tree; `staged` and `unstaged` are the two sides of the index;
 * `turn` is one conversation turn's declared edits; `commit` is one commit
 * against its parent. Only `uncommitted` survives a restart: the others name
 * a turn, a commit or an index state that a later window may not hold.
 */
export type WorkbenchChangesScope =
  | { readonly kind: "uncommitted" }
  | { readonly kind: "staged" }
  | { readonly kind: "unstaged" }
  | { readonly kind: "turn"; readonly turnId: Oid }
  | { readonly kind: "commit"; readonly oid: string };

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

const PATHLESS_TABS = Object.freeze(["browser", "terminal", "agents"] satisfies WorkbenchTabId[]);
const PROJECT_TABS = Object.freeze([
  "files",
  "changes",
  "browser",
  "terminal",
  "agents",
] satisfies WorkbenchTabId[]);
/** Tabs that survive a restart. Terminals and agents belong to this window's live processes and sessions. */
type PersistedTab = Exclude<WorkbenchTabId, "terminal" | "agents">;
const PERSISTED_TABS: ReadonlySet<WorkbenchTabId> = new Set<PersistedTab>([
  "files",
  "changes",
  "browser",
]);

function isPersistedTab(tab: WorkbenchTabId): tab is PersistedTab {
  return PERSISTED_TABS.has(tab);
}

export function workbenchTabs(scope: WorkbenchScope): readonly WorkbenchTabId[] {
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

export function workbenchTabAvailable(scope: WorkbenchScope, tab: WorkbenchTabId): boolean {
  switch (tab) {
    case "browser":
    case "terminal":
    case "agents":
      return true;
    case "files":
    case "changes":
      return scope.kind === "project";
    default: {
      const _exhaustive: never = tab;
      return _exhaustive;
    }
  }
}

interface WorkbenchScrollState {
  readonly changes: number;
}

type WorkbenchWidthBounds =
  | { readonly kind: "docked"; readonly min: number; readonly max: number }
  | { readonly kind: "overlay"; readonly min: number; readonly max: number };

export interface WorkbenchViewState {
  readonly expanded: boolean;
  readonly activeTab: WorkbenchTabId | null;
  readonly maximized: boolean;
  readonly openTabs: readonly WorkbenchTabId[];
  readonly changesScope: WorkbenchChangesScope;
  readonly selectedPath: string | undefined;
  readonly pathRevealRevision: number;
  readonly width: number;
  readonly scrollTop: WorkbenchScrollState;
  readonly browserUrl: string | undefined;
}

interface WorkbenchSnapshot {
  readonly views: ReadonlyMap<WorkbenchViewKey, WorkbenchViewState>;
}

export interface WorkbenchPersistence {
  read(): PersistedWorkbenchSnapshot | undefined;
  write(value: PersistedWorkbenchSnapshot): void;
}

export interface WorkbenchController {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => WorkbenchSnapshot;
  readonly getView: (key: WorkbenchViewKey) => WorkbenchViewState;
  readonly actions: {
    readonly openTab: (key: WorkbenchViewKey, tab: WorkbenchTabId) => void;
    readonly closeTab: (key: WorkbenchViewKey, tab: WorkbenchTabId) => void;
    readonly toggle: (key: WorkbenchViewKey) => void;
    readonly toggleWorkbench: (key: WorkbenchViewKey, scope: WorkbenchScope) => void;
    readonly toggleMaximized: (key: WorkbenchViewKey) => void;
    readonly selectChangesScope: (key: WorkbenchViewKey, scope: WorkbenchChangesScope) => void;
    readonly selectPath: (key: WorkbenchViewKey, path: string | undefined) => void;
    readonly revealPath: (key: WorkbenchViewKey, path: string) => void;
    readonly setWidth: (key: WorkbenchViewKey, width: number) => void;
    readonly setScrollTop: (
      key: WorkbenchViewKey,
      tab: WorkbenchScrollableTabId,
      scrollTop: number,
    ) => void;
    readonly setBrowserUrl: (key: WorkbenchViewKey, url: string | undefined) => void;
  };
}

const STORAGE_KEY = "nyte:desktop:workbench:v5";
const LEGACY_STORAGE_KEY = "nyte:desktop:workbench:v4";
const VIEW_IDENTITIES = new Map<WorkbenchViewKey, WorkbenchViewIdentity>();
const EMPTY_SCROLL = Object.freeze({ changes: 0 });
const DEFAULT_VIEW = Object.freeze({
  expanded: false,
  activeTab: null,
  maximized: false,
  openTabs: Object.freeze([]),
  changesScope: Object.freeze({ kind: "uncommitted" }),
  selectedPath: undefined,
  pathRevealRevision: 0,
  width: WORKBENCH_WIDTH_DEFAULT,
  scrollTop: EMPTY_SCROLL,
  browserUrl: undefined,
}) satisfies WorkbenchViewState;

const strict = { additionalProperties: false };
const nonEmpty = Type.String({ minLength: 1 });
const legacyWorkbenchView = Type.Object(
  {
    key: nonEmpty,
    visible: Type.Optional(Type.Boolean()),
    expanded: Type.Boolean(),
    activeTab: Type.Enum(["changes", "browser"]),
    selectedPath: Type.Optional(nonEmpty),
    width: Type.Number(),
    scrollTop: Type.Object({ changes: Type.Number({ minimum: 0 }) }, strict),
    browserUrl: Type.Optional(nonEmpty),
  },
  strict,
);

const legacyWorkbenchSnapshot = Type.Object(
  { version: Type.Literal(4), views: Type.Array(legacyWorkbenchView) },
  strict,
);

const persistedTab = Type.Enum(["files", "changes", "browser", "terminal"]);
const persistedWorkbenchView = Type.Object(
  {
    key: nonEmpty,
    expanded: Type.Boolean(),
    maximized: Type.Boolean(),
    activeTab: Type.Union([persistedTab, Type.Null()]),
    openTabs: Type.Array(persistedTab, { uniqueItems: true }),
    selectedPath: Type.Optional(nonEmpty),
    width: Type.Number(),
    scrollTop: Type.Object({ changes: Type.Number({ minimum: 0 }) }, strict),
    browserUrl: Type.Optional(nonEmpty),
  },
  strict,
);
const persistedWorkbenchSnapshot = Type.Object(
  { version: Type.Literal(5), views: Type.Array(persistedWorkbenchView) },
  strict,
);

type PersistedWorkbenchSnapshot = Static<typeof persistedWorkbenchSnapshot>;

export function activeWorkbenchTab(
  view: WorkbenchViewState,
  scope: WorkbenchScope,
): WorkbenchTabId | null {
  const tabs = view.openTabs.filter((tab) => workbenchTabAvailable(scope, tab));
  return tabs.find((tab) => tab === view.activeTab) ?? tabs[0] ?? null;
}

export function workbenchTabLabel(tab: WorkbenchTabId): string {
  switch (tab) {
    case "files":
      return "Files";
    case "changes":
      return "Changes";
    case "browser":
      return "Browser";
    case "terminal":
      return "Terminal";
    case "agents":
      return "Agents";
    default: {
      const _exhaustive: never = tab;
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

/** Decode localStorage once; the controller never receives transport data. */
export function decodePersistedWorkbenchSnapshot(
  serialized: string,
): PersistedWorkbenchSnapshot | undefined {
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (Value.Check(persistedWorkbenchSnapshot, parsed)) {
      return parsed.views.every((view) =>
        view.activeTab === null
          ? view.openTabs.length === 0 && !view.expanded
          : view.openTabs.includes(view.activeTab),
      )
        ? parsed
        : undefined;
    }
    if (Value.Check(legacyWorkbenchSnapshot, parsed)) {
      return {
        version: 5,
        views: parsed.views.map(({ visible: _visible, ...view }) => ({
          ...view,
          maximized: false,
          openTabs: [view.activeTab],
        })),
      };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function restoreSnapshot(persisted: PersistedWorkbenchSnapshot | undefined): WorkbenchSnapshot {
  const views = new Map<WorkbenchViewKey, WorkbenchViewState>();
  for (const stored of persisted?.views ?? []) {
    // SAFETY: the persistence schema proved that this storage key is non-empty.
    const key = stored.key as WorkbenchViewKey;
    const openTabs = Object.freeze(stored.openTabs.filter(isPersistedTab));
    const activeTab = openTabs.find((tab) => tab === stored.activeTab) ?? openTabs[0] ?? null;
    views.set(
      key,
      Object.freeze({
        expanded: stored.expanded && activeTab !== null,
        activeTab,
        maximized: stored.maximized,
        openTabs,
        changesScope: Object.freeze({ kind: "uncommitted" }),
        selectedPath: stored.selectedPath,
        pathRevealRevision: 0,
        width: clampWorkbenchWidth(stored.width),
        scrollTop: Object.freeze(stored.scrollTop),
        browserUrl: stored.browserUrl,
      }),
    );
  }
  return Object.freeze({ views });
}

function persistable(snapshot: WorkbenchSnapshot): PersistedWorkbenchSnapshot {
  return {
    version: 5,
    views: [...snapshot.views].map(([key, view]) => {
      // Shells belong to this window's PTY host and do not survive an app restart.
      const openTabs = view.openTabs.filter(isPersistedTab);
      const activeTab = openTabs.find((tab) => tab === view.activeTab) ?? openTabs[0] ?? null;
      return {
        key,
        expanded: view.expanded && activeTab !== null,
        activeTab,
        maximized: view.maximized,
        openTabs,
        selectedPath: view.selectedPath,
        width: view.width,
        scrollTop: view.scrollTop,
        browserUrl: view.browserUrl,
      };
    }),
  };
}

function browserPersistence(): WorkbenchPersistence | undefined {
  if (globalThis.window === undefined) return undefined;
  return {
    read() {
      try {
        const raw =
          window.localStorage.getItem(STORAGE_KEY) ??
          window.localStorage.getItem(LEGACY_STORAGE_KEY) ??
          window.localStorage.getItem("nyte:desktop:workbench:v3");
        return raw === null ? undefined : decodePersistedWorkbenchSnapshot(raw);
      } catch {
        return undefined;
      }
    },
    write(value) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      } catch {
        // A blocked or full localStorage must not erase the in-memory view.
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
  // SAFETY: the non-empty pane key and discriminated target are encoded into a stable key.
  const key = `${encodeURIComponent(input.paneKey)}:${targetKey}` as WorkbenchViewKey;
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
    openTabs: Object.freeze([...view.openTabs]),
    scrollTop: Object.freeze({ ...view.scrollTop }),
  });
}

export function createWorkbenchController(persistence?: WorkbenchPersistence): WorkbenchController {
  let snapshot = restoreSnapshot(persistence?.read());
  const listeners = new Set<() => void>();

  const publish = (key: WorkbenchViewKey, view: WorkbenchViewState): void => {
    const views = new Map(snapshot.views);
    views.set(key, freezeView(view));
    snapshot = Object.freeze({
      views,
    });
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

  const visit = (current: WorkbenchViewState, tab: WorkbenchTabId): readonly WorkbenchTabId[] =>
    current.openTabs.includes(tab) ? current.openTabs : [...current.openTabs, tab];

  const actions: WorkbenchController["actions"] = {
    openTab(key, tab) {
      update(key, (current) =>
        current.expanded && current.activeTab === tab && current.openTabs.includes(tab)
          ? current
          : {
              ...current,
              expanded: true,
              activeTab: tab,
              openTabs: visit(current, tab),
            },
      );
    },
    closeTab(key, tab) {
      update(key, (current) => {
        const index = current.openTabs.indexOf(tab);
        if (index === -1) return current;
        const openTabs = current.openTabs.filter((candidate) => candidate !== tab);
        const activeTab =
          current.activeTab === tab
            ? (openTabs[index] ?? openTabs[index - 1] ?? null)
            : current.activeTab;
        return {
          ...current,
          openTabs,
          activeTab,
          expanded: current.expanded && activeTab !== null,
        };
      });
    },
    toggle(key) {
      update(key, (current) => {
        const activeTab = current.activeTab ?? "browser";
        return {
          ...current,
          expanded: !current.expanded,
          activeTab,
          openTabs: visit(current, activeTab),
        };
      });
    },
    toggleMaximized(key) {
      update(key, (current) => ({ ...current, maximized: !current.maximized }));
    },
    toggleWorkbench(key, scope) {
      const current = snapshot.views.get(key) ?? DEFAULT_VIEW;
      if (current.expanded && activeWorkbenchTab(current, scope) === null) {
        actions.openTab(key, "browser");
        return;
      }
      actions.toggle(key);
    },
    selectChangesScope(key, scope) {
      update(key, (current) => {
        return sameChangesScope(current.changesScope, scope)
          ? current
          : {
              ...current,
              changesScope: scope,
              selectedPath: undefined,
              scrollTop: { ...current.scrollTop, changes: 0 },
            };
      });
    },
    selectPath(key, path) {
      update(key, (current) =>
        current.selectedPath === path ? current : { ...current, selectedPath: path },
      );
    },
    revealPath(key, path) {
      update(key, (current) => ({
        ...current,
        selectedPath: path,
        pathRevealRevision: current.pathRevealRevision + 1,
      }));
    },
    setWidth(key, width) {
      const nextWidth = clampWorkbenchWidth(width);
      update(key, (current) =>
        current.width === nextWidth ? current : { ...current, width: nextWidth },
      );
    },
    setScrollTop(key, tab, scrollTop) {
      const nextScroll = Math.max(0, scrollTop);
      update(key, (current) =>
        current.scrollTop[tab] === nextScroll
          ? current
          : { ...current, scrollTop: { ...current.scrollTop, [tab]: nextScroll } },
      );
    },
    setBrowserUrl(key, url) {
      const nextUrl = url === "" ? undefined : url;
      update(key, (current) =>
        current.browserUrl === nextUrl ? current : { ...current, browserUrl: nextUrl },
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
