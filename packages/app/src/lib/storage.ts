import { toast } from "@nyte-ai/ui/toast";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";

export type StorageArea = Pick<Storage, "getItem" | "setItem" | "removeItem">;

interface ReadOptions {
  /** Earlier builds stored some strings bare; text that isn't JSON is checked as itself. */
  readonly text?: boolean;
}

export function localArea(): Storage | undefined {
  return globalThis.window === undefined ? undefined : window.localStorage;
}

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

export function writeStored(area: StorageArea | undefined, key: string, value: unknown): void {
  if (area === undefined) return;
  const text = JSON.stringify(value);

  guardWrite(() => area.setItem(key, text));
}

export function removeStored(area: StorageArea | undefined, key: string): void {
  if (area === undefined) return;

  guardWrite(() => area.removeItem(key));
}

/** One of the two guarded calls at the storage boundary: a refused write keeps the stored value and is reported, not thrown. */
function guardWrite(write: () => void): void {
  try {
    write();
  } catch {
    toast.add({
      type: "error",
      id: "storage-full",
      title: "Storage is full",
      description: "Some changes won't be kept after a reload.",
    });
  }
}

const UNREADABLE = Symbol("unreadable");

/** The other guarded call at the storage boundary: anything may have written this text. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return UNREADABLE;
  }
}

export interface Persisted<T> {
  readonly get: () => T;
  readonly set: (value: T) => void;
  readonly remove: () => void;
  readonly subscribe: (listener: () => void) => () => void;
}

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
      publish(value);
      writeStored(area, key, value);
    },
    remove() {
      publish(fallback);
      removeStored(area, key);
    },
    subscribe(listener) {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
  };
}
