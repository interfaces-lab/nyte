import { useSyncExternalStore } from "react";
import { Type } from "typebox";
import type { Static } from "typebox";
import { preferences, useSetting } from "../../preferences/index.ts";
import { persisted } from "../persistence.ts";

const MAX_SCOPES = 32;

const changesViewOptionsSchema = Type.Object(
  {
    layout: Type.Union([Type.Literal("unified"), Type.Literal("split")]),
    ignoreWhitespace: Type.Boolean(),
    wordWrap: Type.Boolean(),
  },
  { additionalProperties: false },
);

const scopedOptionsSchema = Type.Object(
  {
    options: Type.Partial(changesViewOptionsSchema, { additionalProperties: false }),
    updatedAt: Type.Number(),
  },
  { additionalProperties: false },
);

export type ChangesLayout = Static<typeof changesViewOptionsSchema>["layout"];

export type ChangesViewOptions = Static<typeof changesViewOptionsSchema>;

type StoredChangesViewOptions = Static<typeof scopedOptionsSchema>["options"];

const EMPTY_CHANGES_VIEW_OPTIONS: Readonly<Record<string, Static<typeof scopedOptionsSchema>>> = {};

const stored = persisted(
  "nyte.desktop.changes-view-options.v1",
  Type.Record(Type.String(), scopedOptionsSchema),
  EMPTY_CHANGES_VIEW_OPTIONS,
);

/** Keeps the scopes changed most recently, so the record stays small. */
function evictOldest(
  scopes: Readonly<Record<string, Static<typeof scopedOptionsSchema>>>,
): Readonly<Record<string, Static<typeof scopedOptionsSchema>>> {
  const entries = Object.entries(scopes);

  if (entries.length <= MAX_SCOPES) return scopes;

  return Object.fromEntries(
    entries
      .toSorted(([, left], [, right]) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_SCOPES),
  );
}

export function setChangesViewOptions(scopeId: string, changes: StoredChangesViewOptions): void {
  const scopes = stored.get();
  const current = scopes[scopeId]?.options ?? {};
  const next = { ...current, ...changes };

  if (
    next.layout === current.layout &&
    next.ignoreWhitespace === current.ignoreWhitespace &&
    next.wordWrap === current.wordWrap &&
    scopes[scopeId] !== undefined
  ) {
    return;
  }

  stored.set(evictOldest({ ...scopes, [scopeId]: { options: next, updatedAt: Date.now() } }));
}

export function useChangesViewOptions(scopeId: string): ChangesViewOptions {
  const scopes = useSyncExternalStore(stored.subscribe, stored.get, stored.get);
  const layout = useSetting(preferences.changesLayout);
  const ignoreWhitespace = useSetting(preferences.changesIgnoreWhitespace);
  const wordWrap = useSetting(preferences.changesWordWrap);

  return { layout, ignoreWhitespace, wordWrap, ...scopes[scopeId]?.options };
}

export const COMMIT_ACTIONS = [
  "branch-commit",
  "branch-commit-push",
  "branch",
  "commit",
  "commit-push",
  "commit-pull-request",
  "push",
  "pull-request",
] as const;

export type CommitAction = (typeof COMMIT_ACTIONS)[number];

export const DEFAULT_COMMIT_ACTION: CommitAction = "commit-push";

/** The commit bar's last chosen action. */
export const storedCommitAction = persisted(
  "nyte.desktop.changes-commit-action.v2",
  Type.Enum(COMMIT_ACTIONS),
  DEFAULT_COMMIT_ACTION,
);
