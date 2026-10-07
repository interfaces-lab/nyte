import { useSyncExternalStore } from "react";
import type { Oid, SessionId } from "@nyte-ai/protocol";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import { clientCapabilities } from "../client-actions.ts";
import type { ClientCapabilities } from "../client-actions.ts";
import { nyte } from "../nyte.ts";

export const WORKBENCH_WIDTH_DEFAULT = 400;

const WORKBENCH_WIDTH_MIN = 300;

export const WORKBENCH_CENTER_WIDTH_MIN = 424;

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

/**
 * Maximized, the stage shows one surface at a time: the workbench, or the
 * conversation behind it as a tab in the same strip.
 */
export type WorkbenchLayout =
  | { readonly kind: "split" }
  | { readonly kind: "maximized"; readonly showing: "workbench" | "chat" };

const SPLIT_LAYOUT = Object.freeze({ kind: "split" }) satisfies WorkbenchLayout;

const MAXIMIZED_WORKBENCH_LAYOUT = Object.freeze({
  kind: "maximized",
  showing: "workbench",
}) satisfies WorkbenchLayout;

const MAXIMIZED_CHAT_LAYOUT = Object.freeze({
  kind: "maximized",
  showing: "chat",
}) satisfies WorkbenchLayout;

/** The conversation's value in the workbench tab strip; never a workbench tab id. */
export const WORKBENCH_CHAT_TAB = "chat";

export function workbenchShowsChat(layout: WorkbenchLayout): boolean {
  return layout.kind === "maximized" && layout.showing === "chat";
}

function revealWorkbench(layout: WorkbenchLayout): WorkbenchLayout {
  return workbenchShowsChat(layout) ? MAXIMIZED_WORKBENCH_LAYOUT : layout;
}

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

export type WorkbenchScope = { readonly kind: "pathless" } | { readonly kind: "project" };

export const WORKBENCH_HOME_VIEW_KEY: WorkbenchViewKey = "home";

export function workbenchViewKey(workspacePath: string | undefined): WorkbenchViewKey {
  return workspacePath ?? WORKBENCH_HOME_VIEW_KEY;
}

export function workbenchScope(workspacePath: string | undefined): WorkbenchScope {
  return workspacePath === undefined ? { kind: "pathless" } : { kind: "project" };
}

const PATHLESS_TABS = Object.freeze(["browser", "terminal"] satisfies WorkbenchTabKind[]);

const PROJECT_TABS = Object.freeze([
  "files",
  "changes",
  "browser",
  "terminal",
] satisfies WorkbenchTabKind[]);

export function workbenchTabs(
  scope: WorkbenchScope,
  capabilities: ClientCapabilities,
): readonly WorkbenchTabKind[] {
  let tabs: readonly WorkbenchTabKind[];

  switch (scope.kind) {
    case "pathless":
      tabs = PATHLESS_TABS;
      break;
    case "project":
      tabs = PROJECT_TABS;
      break;
    default: {
      const _exhaustive: never = scope;

      return _exhaustive;
    }
  }

  return tabs.filter((kind) => workbenchTabAvailable(scope, kind, capabilities));
}

export function workbenchTabAvailable(
  scope: WorkbenchScope,
  kind: WorkbenchTabKind,
  capabilities: ClientCapabilities,
): boolean {
  switch (kind) {
    case "browser":
      return capabilities.browser;
    case "terminal":
      return capabilities.terminal;
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
  readonly layout: WorkbenchLayout;
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
    /** Records where a changes tab is scrolled; the rest of the tab is untouched, so a late report is harmless. */
    readonly scrollTab: (input: {
      readonly view: WorkbenchViewKey;
      readonly id: WorkbenchTabId;
      readonly scrollTop: number;
    }) => void;
    readonly toggle: (input: { readonly view: WorkbenchViewKey }) => void;
    readonly toggleCollapsed: (input: { readonly view: WorkbenchViewKey }) => void;
    readonly toggleWorkbench: (input: { readonly view: WorkbenchViewKey }) => void;
    readonly toggleMaximized: (input: { readonly view: WorkbenchViewKey }) => void;
    /** Maximized, shows the conversation in place of the workbench; the active tab waits. */
    readonly showChat: (input: { readonly view: WorkbenchViewKey }) => void;
    readonly setWidth: (input: { readonly view: WorkbenchViewKey; readonly width: number }) => void;
  };
}

const STORAGE_KEY = "nyte:desktop:workbench:v7";

const DEFAULT_VIEW = Object.freeze({
  tabs: Object.freeze([]),
  active: null,
  expanded: false,
  collapsed: "floating",
  layout: SPLIT_LAYOUT,
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
  { version: Type.Literal(7), views: Type.Array(persistedWorkbenchView) },
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
  capabilities: ClientCapabilities,
): WorkbenchTab | null {
  const active = view.tabs.find((tab) => tab.id === view.active);

  if (active !== undefined && workbenchTabAvailable(scope, active.kind, capabilities))
    return active;

  return view.tabs.find((tab) => workbenchTabAvailable(scope, tab.kind, capabilities)) ?? null;
}

export function workbenchTabLabel(tab: WorkbenchTab): string {
  if (tab.kind === "file") return tab.path.split(/[\\/]/).at(-1) ?? tab.path;

  return workbenchKindLabel(tab.kind);
}

export function workbenchKindLabel(kind: WorkbenchTabKind): string {
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

/** Cursor's auxiliary bar default: 400px, or two fifths of the stage when that is less. */
export function workbenchDefaultWidth(availableWidth: number): number {
  return Math.min(WORKBENCH_WIDTH_DEFAULT, Math.round(availableWidth / 2.5));
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
        (view.active === null ? view.tabs.length === 0 : ids.has(view.active))
      );
    });

    return valid ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function restoreSnapshot(
  persisted: PersistedWorkbenchSnapshot | undefined,
  capabilities: () => ClientCapabilities,
): WorkbenchSnapshot {
  const views = new Map<WorkbenchViewKey, WorkbenchViewState>();

  if (persisted === undefined) return Object.freeze({ views });
  const available = capabilities();

  for (const stored of persisted.views) {
    const tabs: readonly WorkbenchTab[] = stored.tabs.filter((tab) =>
      workbenchTabAvailable({ kind: "project" }, tab.kind, available),
    );

    const active = tabs.some((tab) => tab.id === stored.active)
      ? stored.active
      : (tabs[0]?.id ?? null);

    views.set(
      stored.key,
      Object.freeze({
        tabs: Object.freeze(tabs.map((tab) => Object.freeze(tab))),
        active,
        expanded: stored.expanded,
        collapsed: "floating",
        layout: stored.maximized ? MAXIMIZED_WORKBENCH_LAYOUT : SPLIT_LAYOUT,
        width: clampWorkbenchWidth(stored.width),
      }),
    );
  }

  return Object.freeze({ views });
}

function persistable(snapshot: WorkbenchSnapshot): PersistedWorkbenchSnapshot {
  return {
    version: 7,
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
        expanded: view.expanded,
        maximized: view.layout.kind === "maximized",
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

export function createWorkbenchController(
  capabilities: () => ClientCapabilities,
  persistence?: WorkbenchPersistence,
): WorkbenchController {
  let snapshot = restoreSnapshot(persistence?.read(), capabilities);
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
        const layout = revealWorkbench(current.layout);

        if (
          activate &&
          (current.active !== existing.id || !current.expanded || layout !== current.layout)
        ) {
          publish(view, { ...current, active: existing.id, expanded: true, layout });
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
        layout: activate ? revealWorkbench(current.layout) : current.layout,
      });

      return id;
    },
    activateTab({ view, id }) {
      update(view, (current) => {
        if (!current.tabs.some((tab) => tab.id === id)) return current;
        const layout = revealWorkbench(current.layout);

        return current.active === id && current.expanded && layout === current.layout
          ? current
          : { ...current, active: id, expanded: true, layout };
      });
    },
    closeTab({ view, id }) {
      update(view, (current) => {
        const index = current.tabs.findIndex((tab) => tab.id === id);

        if (index === -1) return current;
        const tabs = current.tabs.filter((tab) => tab.id !== id);

        const active =
          current.active === id ? (tabs[index]?.id ?? tabs[index - 1]?.id ?? null) : current.active;

        return { ...current, tabs, active, expanded: current.expanded && active !== null };
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
    scrollTab({ view, id, scrollTop }) {
      update(view, (current) => {
        const tab = current.tabs.find((candidate) => candidate.id === id);

        if (tab === undefined || tab.kind !== "changes" || tab.scrollTop === scrollTop)
          return current;

        return {
          ...current,
          tabs: current.tabs.map((candidate) =>
            candidate === tab ? { ...tab, scrollTop } : candidate,
          ),
        };
      });
    },
    toggle({ view }) {
      update(view, (current) => ({
        ...current,
        expanded: !current.expanded,
        layout: current.expanded ? current.layout : revealWorkbench(current.layout),
      }));
    },
    toggleCollapsed({ view }) {
      update(view, (current) => ({
        ...current,
        collapsed: current.collapsed === "floating" ? "compact" : "floating",
      }));
    },
    toggleMaximized({ view }) {
      update(view, (current) => ({
        ...current,
        layout: current.layout.kind === "maximized" ? SPLIT_LAYOUT : MAXIMIZED_WORKBENCH_LAYOUT,
      }));
    },
    showChat({ view }) {
      update(view, (current) =>
        current.layout.kind === "maximized" && !workbenchShowsChat(current.layout)
          ? { ...current, layout: MAXIMIZED_CHAT_LAYOUT }
          : current,
      );
    },
    toggleWorkbench({ view }) {
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

export const workbenchController = createWorkbenchController(
  () => clientCapabilities(nyte.host),
  browserPersistence(),
);

export function useWorkbenchSnapshot(): WorkbenchSnapshot {
  return useSyncExternalStore(
    workbenchController.subscribe,
    workbenchController.getSnapshot,
    workbenchController.getSnapshot,
  );
}
