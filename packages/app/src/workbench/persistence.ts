import { idSchema } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import type { ClientCapabilities } from "../contract/client-actions.ts";
import {
  MAXIMIZED_WORKBENCH_LAYOUT,
  SPLIT_LAYOUT,
  type WorkbenchSnapshot,
  type WorkbenchTab,
  type WorkbenchViewKey,
  type WorkbenchViewState,
  workbenchTabAvailable,
} from "./model.ts";
import { DEFAULT_WIDTH, type WorkbenchWidth, shareWidth } from "./width.ts";

/** What every panel was stored with before panels stored a share: the old default, not a width anyone chose. */
const LEGACY_DEFAULT_PIXELS = 400;

export interface WorkbenchPersistence {
  read(): PersistedWorkbenchSnapshot | undefined;
  write(value: PersistedWorkbenchSnapshot): void;
}

const STORAGE_KEY = "nyte:desktop:workbench:v7";

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
    case "browser":
    case "canvas":
    case "files":
    case "changes":
      return tab;
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

function restoreWidth(stored: Static<typeof persistedWorkbenchView>): WorkbenchWidth {
  if (stored.share !== undefined) return shareWidth(stored.share);

  return stored.width === undefined || stored.width === LEGACY_DEFAULT_PIXELS
    ? DEFAULT_WIDTH
    : { kind: "pixels", pixels: stored.width };
}

function decodePersistedWorkbenchSnapshot(
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

export function restoreSnapshot(
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
        width: restoreWidth(stored),
      }),
    );
  }

  return Object.freeze({ views });
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

export function browserPersistence(): WorkbenchPersistence | undefined {
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
