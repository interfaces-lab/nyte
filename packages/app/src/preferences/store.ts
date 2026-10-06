/**
 * The one client preference store. A preference owns a slot in localStorage
 * and keeps its decoded value in memory, so reads are synchronous and work
 * before first paint. Another window's write arrives through the `storage`
 * event; a write here touches only this preference's slot.
 */
import { useSyncExternalStore } from "react";
import { Type } from "typebox";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";

/** A localStorage key, or one field of the JSON object stored at that key. */
export interface PreferenceSlot {
  readonly key: string;
  readonly field?: string;
}

/**
 * What a component reads and a Settings row changes. Client preferences
 * implement it here; host settings implement it in `host.ts`.
 */
export interface Setting<T> {
  /** Undefined only for a host setting that has not loaded. */
  readonly get: () => T | undefined;
  readonly set: (value: T) => void;
  readonly subscribe: (listener: () => void) => () => void;
  /** False where this host can't back the value: host settings on the web app. */
  readonly available: () => boolean;
}

/** A client preference always has a value: what was stored, or its default. */
export interface Preference<T> extends Setting<T> {
  readonly get: () => T;
}

/** The setting's value, re-rendering only when that one setting changes. */
export function useSetting<T>(setting: Preference<T>): T;
export function useSetting<T>(setting: Setting<T>): T | undefined;
export function useSetting<T>(setting: Setting<T>): T | undefined {
  return useSyncExternalStore(setting.subscribe, setting.get, setting.get);
}

interface Reloadable {
  readonly key: string;
  reload(): void;
}

/** Every defined preference, by the localStorage key it reads, for `storage` events. */
const reloadable: Reloadable[] = [];

const StoredRecord = Type.Record(Type.String(), Type.Unknown());

function storage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/** JSON, except that builds before this store wrote enum values bare (`steer`, `last-session`). */
function storedValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function recordAt(raw: string | null): Readonly<Record<string, unknown>> {
  if (raw === null) return {};
  const parsed = storedValue(raw);

  return Value.Check(StoredRecord, parsed) ? parsed : {};
}

/** Missing, unparseable, or invalid reads as the default, for this preference alone. */
function read<S extends TSchema>(slot: PreferenceSlot, schema: S, fallback: Static<S>): Static<S> {
  const raw = storage()?.getItem(slot.key) ?? null;

  if (raw === null) return fallback;
  const stored = slot.field === undefined ? storedValue(raw) : recordAt(raw)[slot.field];

  return Value.Check(schema, stored) ? stored : fallback;
}

/**
 * Writes this slot only. A field is merged into the record as storage holds it
 * now, not as this window last read it, so a sibling another window just wrote
 * survives. Persistence is best-effort: the in-memory value stands.
 */
function write(slot: PreferenceSlot, value: unknown): void {
  const store = storage();

  if (store === undefined) return;

  try {
    if (slot.field === undefined) {
      store.setItem(slot.key, JSON.stringify(value));

      return;
    }

    store.setItem(
      slot.key,
      JSON.stringify({ ...recordAt(store.getItem(slot.key)), [slot.field]: value }),
    );
  } catch {
    return;
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  return Object.is(left, right) || JSON.stringify(left) === JSON.stringify(right);
}

export function definePreference<S extends TSchema>(
  slot: PreferenceSlot,
  schema: S,
  fallback: Static<S>,
): Preference<Static<S>> {
  let value = read(slot, schema, fallback);
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  reloadable.push({
    key: slot.key,
    reload: () => {
      const next = read(slot, schema, fallback);

      if (sameValue(next, value)) return;
      value = next;
      notify();
    },
  });

  return {
    get: () => value,
    set: (next) => {
      if (sameValue(next, value) || !Value.Check(schema, next)) return;
      value = next;
      write(slot, next);
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    available: () => true,
  };
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.storageArea !== storage()) return;

    for (const preference of reloadable) {
      // A null key is `storage.clear()`.
      if (event.key === null || event.key === preference.key) preference.reload();
    }
  });
}
