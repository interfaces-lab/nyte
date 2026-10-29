import { idSchema } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";
import type { ClientCapabilities } from "../contract/client-actions.ts";
import {
  MAXIMIZED_WORKBENCH_LAYOUT,
  SPLIT_LAYOUT,
  type WorkbenchSnapshot,
  type WorkbenchTab,
  type WorkbenchViewState,
  workbenchTabAvailable,
} from "./model.ts";
import { workspaceFile } from "./paths.ts";
import { DEFAULT_WIDTH, type WorkbenchWidth, shareWidth } from "./width.ts";

/** What every panel was stored with before panels stored a share: the old default, not a width anyone chose. */
const LEGACY_DEFAULT_PIXELS = 400;

/** A value the workbench keeps in local storage, checked against its schema when read. */
export interface Persisted<T> {
  readonly get: () => T;
  readonly set: (value: T) => void;
  readonly remove: () => void;
  readonly subscribe: (listener: () => void) => () => void;
}

/** Reads `key` once, on first use; a stored value that fails `schema` reads as `fallback`. */
export function persisted<S extends TSchema, Fallback>(
  key: string,
  schema: S,
  fallback: Fallback,
): Persisted<Static<S> | Fallback> {
  const storage = globalThis.window === undefined ? undefined : window.localStorage;
  const listeners = new Set<() => void>();
  let loaded: { readonly value: Static<S> | Fallback } | undefined;

  const read = (): Static<S> | Fallback => {
    const raw = storage?.getItem(key) ?? null;

    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);

    return Value.Check(schema, parsed) ? parsed : fallback;
  };

  const publish = (value: Static<S> | Fallback): void => {
    loaded = { value };

    for (const listener of listeners) listener();
  };

  return {
    get: () => (loaded ??= { value: read() }).value,
    set(value) {
      storage?.setItem(key, JSON.stringify(value));
      publish(value);
    },
    remove() {
      storage?.removeItem(key);
      publish(fallback);
    },
    subscribe(listener) {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
  };
}

export type WorkbenchPersistence = Pick<
  Persisted<PersistedWorkbenchSnapshot | undefined>,
  "get" | "set"
>;

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
      Type.Object({ kind: Type.Literal("thread") }, strict),
      Type.Object({ kind: Type.Literal("turn"), turnId: idSchema<"turn">() }, strict),
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

const persistedCanvasTab = Type.Object(
  {
    id: nonEmpty,
    kind: Type.Literal("canvas"),
    sessionId: idSchema<"session">(),
    part: idSchema<"part">(),
    title: nonEmpty,
    pinned: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  },
  strict,
);

const persistedFilesTab = Type.Object({ id: nonEmpty, kind: Type.Literal("files") }, strict);

const persistedTerminalTab = Type.Object(
  {
    id: nonEmpty,
    kind: Type.Literal("terminal"),
    owner: Type.Object({ kind: Type.Literal("user") }, strict),
  },
  strict,
);

const persistedTab = Type.Union([
  persistedFileTab,
  persistedChangesTab,
  persistedBrowserTab,
  persistedCanvasTab,
  persistedFilesTab,
  persistedTerminalTab,
]);

const persistedWorkbenchView = Type.Object(
  {
    key: nonEmpty,
    tabs: Type.Array(persistedTab),
    active: Type.Union([nonEmpty, Type.Null()]),
    expanded: Type.Boolean(),
    maximized: Type.Boolean(),
    /** Pixels, stored before panels stored a share. */
    width: Type.Optional(Type.Number()),
    share: Type.Optional(Type.Number()),
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
    case "canvas":
    case "files":
    case "changes":
      return tab;
    case "browser":
      return { id: tab.id, kind: "browser", url: tab.url };
    case "terminal":
      return tab.owner.kind === "user"
        ? { id: tab.id, kind: "terminal", owner: { kind: "user" } }
        : undefined;
    default: {
      const _exhaustive: never = tab;

      return _exhaustive;
    }
  }
}

function restoreTab(tab: PersistedTab): WorkbenchTab {
  return tab.kind === "browser" ? { ...tab, surface: null } : tab;
}

function restoreWidth(stored: Static<typeof persistedWorkbenchView>): WorkbenchWidth {
  if (stored.share !== undefined) return shareWidth(stored.share);

  return stored.width === undefined || stored.width === LEGACY_DEFAULT_PIXELS
    ? DEFAULT_WIDTH
    : { kind: "pixels", pixels: stored.width };
}

/** Restores each stored view; a file tab goes to the view whose workspace holds it. */
export function restoreSnapshot(
  persisted: PersistedWorkbenchSnapshot | undefined,
  capabilities: () => ClientCapabilities,
): WorkbenchSnapshot {
  if (persisted === undefined) return Object.freeze({ views: new Map() });
  const available = capabilities();
  const keys = persisted.views.map((stored) => stored.key);

  const placed = persisted.views.flatMap((stored) =>
    stored.tabs.flatMap((tab, index) => {
      if (
        !workbenchTabAvailable({ kind: "project" }, tab.kind, available) ||
        stored.tabs.findIndex((candidate) => candidate.id === tab.id) !== index
      )
        return [];
      const restored = restoreTab(tab);

      const view =
        restored.kind === "file"
          ? (workspaceFile(restored.path, keys)?.view ?? stored.key)
          : stored.key;

      return [{ view, tab: restored }];
    }),
  );

  return Object.freeze({
    views: new Map(
      persisted.views.map((stored): [string, WorkbenchViewState] => {
        const tabs = placed.flatMap((entry) => (entry.view === stored.key ? [entry.tab] : []));

        const active = tabs.some((tab) => tab.id === stored.active)
          ? stored.active
          : (tabs[0]?.id ?? null);

        return [
          stored.key,
          Object.freeze({
            tabs: Object.freeze(tabs.map((tab) => Object.freeze(tab))),
            active,
            expanded: stored.expanded,
            collapsed: "floating",
            layout: stored.maximized ? MAXIMIZED_WORKBENCH_LAYOUT : SPLIT_LAYOUT,
            width: restoreWidth(stored),
            sidebars: [],
          }),
        ];
      }),
    ),
  });
}

export function persistable(snapshot: WorkbenchSnapshot): PersistedWorkbenchSnapshot {
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
        ...(view.width.kind === "share"
          ? { share: view.width.share }
          : { width: view.width.pixels }),
      };
    }),
  };
}

export function workbenchPersistence(): WorkbenchPersistence {
  return persisted("nyte:desktop:workbench:v7", persistedWorkbenchSnapshot, undefined);
}
