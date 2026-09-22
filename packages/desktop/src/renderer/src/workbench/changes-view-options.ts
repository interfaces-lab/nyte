import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

const STORAGE_KEY = "nyte.desktop.changes-view-options.v1";

/** Options follow the repositories a person actually reviews, not every one ever opened. */
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
  { options: changesViewOptionsSchema, updatedAt: Type.Number() },
  { additionalProperties: false },
);

const storedOptionsSchema = Type.Record(Type.String(), scopedOptionsSchema);

export type ChangesLayout = Static<typeof changesViewOptionsSchema>["layout"];

export type ChangesViewOptions = Static<typeof changesViewOptionsSchema>;

export type StoredChangesViewOptions = Static<typeof storedOptionsSchema>;

/** Today's Changes tab: one unified column, whitespace shown, stacked diffs wrapped. */
export const defaultChangesViewOptions: ChangesViewOptions = {
  layout: "unified",
  ignoreWhitespace: false,
  wordWrap: true,
};

export const EMPTY_CHANGES_VIEW_OPTIONS: StoredChangesViewOptions = {};

type OptionsStorage = Pick<Storage, "getItem" | "setItem">;

export interface ChangesViewOptionsStoreOptions {
  readonly storage?: OptionsStorage;
  readonly now?: () => number;
  readonly maxScopes?: number;
}

export function decodeChangesViewOptions(serialized: string | null): StoredChangesViewOptions {
  if (serialized === null) return EMPTY_CHANGES_VIEW_OPTIONS;

  try {
    const parsed: unknown = JSON.parse(serialized);

    return Value.Check(storedOptionsSchema, parsed) ? parsed : EMPTY_CHANGES_VIEW_OPTIONS;
  } catch {
    return EMPTY_CHANGES_VIEW_OPTIONS;
  }
}

/**
 * Changes overflow-menu options per workspace or repository. A repository reviewed in
 * split mode keeps that view without forcing it on every other workspace.
 */
export class ChangesViewOptionsStore {
  readonly #storage: OptionsStorage | undefined;
  readonly #now: () => number;
  readonly #maxScopes: number;
  readonly #listeners = new Set<() => void>();
  #stored: StoredChangesViewOptions = EMPTY_CHANGES_VIEW_OPTIONS;

  constructor(options: ChangesViewOptionsStoreOptions = {}) {
    this.#storage = options.storage;
    this.#now = options.now ?? Date.now;
    this.#maxScopes = options.maxScopes ?? MAX_SCOPES;

    try {
      this.#stored = decodeChangesViewOptions(this.#storage?.getItem(STORAGE_KEY) ?? null);
    } catch {
      // A corrupt preference must not prevent opening the Changes tab.
    }
  }

  getSnapshot = (): StoredChangesViewOptions => this.#stored;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);

    return () => this.#listeners.delete(listener);
  };

  options(scopeId: string): ChangesViewOptions {
    return this.#stored[scopeId]?.options ?? defaultChangesViewOptions;
  }

  setOptions(scopeId: string, changes: Partial<ChangesViewOptions>): void {
    const current = this.options(scopeId);
    const next = { ...current, ...changes };

    if (
      next.layout === current.layout &&
      next.ignoreWhitespace === current.ignoreWhitespace &&
      next.wordWrap === current.wordWrap &&
      this.#stored[scopeId] !== undefined
    ) {
      return;
    }

    this.#commit({ ...this.#stored, [scopeId]: { options: next, updatedAt: this.#now() } });
  }

  reset(scopeId: string): void {
    if (this.#stored[scopeId] === undefined) return;
    const next = { ...this.#stored };
    delete next[scopeId];
    this.#commit(next);
  }

  #commit(stored: StoredChangesViewOptions): void {
    this.#stored = this.#evictOldest(stored);

    try {
      this.#storage?.setItem(STORAGE_KEY, JSON.stringify(this.#stored));
    } catch {
      // Keep the chosen view for this window even when persistence is unavailable.
    }

    for (const listener of this.#listeners) listener();
  }

  #evictOldest(stored: StoredChangesViewOptions): StoredChangesViewOptions {
    const entries = Object.entries(stored);

    if (entries.length <= this.#maxScopes) return stored;

    const kept = entries
      .toSorted(([, left], [, right]) => right.updatedAt - left.updatedAt)
      .slice(0, this.#maxScopes);

    return Object.fromEntries(kept);
  }
}

function browserStorage(): OptionsStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export const changesViewOptions = new ChangesViewOptionsStore({ storage: browserStorage() });
