import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";

/** What a store reads and writes; the window's local or session storage, or a test's map. */
export type StorageArea = Pick<Storage, "getItem" | "setItem" | "removeItem">;

interface ReadOptions {
  /** Earlier builds stored some strings bare; text that isn't JSON is checked as itself. */
  readonly text?: boolean;
}

/** The window's local storage; none outside a browser. */
export function localArea(): Storage | undefined {
  return globalThis.window === undefined ? undefined : window.localStorage;
}

/** The value at `key`; one missing, unreadable, or failing `schema` reads as `fallback`. */
export function readStored<S extends TSchema, Fallback>(
  area: StorageArea | undefined,
  key: string,
  schema: S,
  fallback: Fallback,
  options: ReadOptions = {},
): Static<S> | Fallback {
  const raw = area?.getItem(key) ?? null;

  if (raw === null) return fallback;
  const parsed = parseJson(raw);
  const value = parsed === UNREADABLE && options.text === true ? raw : parsed;

  return Value.Check(schema, value) ? value : fallback;
}

/** Stores `value` as JSON; a write the storage refuses throws. */
export function writeStored(area: StorageArea | undefined, key: string, value: unknown): void {
  area?.setItem(key, JSON.stringify(value));
}

export function removeStored(area: StorageArea | undefined, key: string): void {
  area?.removeItem(key);
}

const UNREADABLE = Symbol("unreadable");

/** The storage boundary, and the one guarded parse: anything may have written this text. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return UNREADABLE;
  }
}

/** A stored value with listeners, read once on first use. */
export interface Persisted<T> {
  readonly get: () => T;
  readonly set: (value: T) => void;
  readonly remove: () => void;
  readonly subscribe: (listener: () => void) => () => void;
}

/** Writes before it publishes, so a write the storage refuses changes nothing and throws. */
export function persisted<S extends TSchema, Fallback>(
  key: string,
  schema: S,
  fallback: Fallback,
  area: StorageArea | undefined = localArea(),
): Persisted<Static<S> | Fallback> {
  const listeners = new Set<() => void>();
  let loaded: { readonly value: Static<S> | Fallback } | undefined;

  const publish = (value: Static<S> | Fallback): void => {
    loaded = { value };

    for (const listener of listeners) listener();
  };

  return {
    get: () => (loaded ??= { value: readStored(area, key, schema, fallback) }).value,
    set(value) {
      writeStored(area, key, value);
      publish(value);
    },
    remove() {
      removeStored(area, key);
      publish(fallback);
    },
    subscribe(listener) {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
  };
}
