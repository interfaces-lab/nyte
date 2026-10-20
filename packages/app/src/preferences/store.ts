import { useSyncExternalStore } from "react";
import { Type } from "typebox";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";

interface PreferenceSlot {
  readonly key: string;
  readonly field?: string;
}

export interface Setting<T> {
  readonly get: () => T | undefined;
  readonly set: (value: T) => void;
  readonly subscribe: (listener: () => void) => () => void;
  readonly available: () => boolean;
}

export interface Preference<T> extends Setting<T> {
  readonly get: () => T;
}

export function useSetting<T>(setting: Preference<T>): T;
export function useSetting<T>(setting: Setting<T>): T | undefined;
export function useSetting<T>(setting: Setting<T>): T | undefined {
  return useSyncExternalStore(setting.subscribe, setting.get, setting.get);
}

interface Reloadable {
  readonly key: string;
  reload(): void;
}

const reloadable: Reloadable[] = [];

const StoredRecord = Type.Record(Type.String(), Type.Unknown());

function storage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

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

function read<S extends TSchema>(slot: PreferenceSlot, schema: S, fallback: Static<S>): Static<S> {
  const raw = storage()?.getItem(slot.key) ?? null;

  if (raw === null) return fallback;
  const stored = slot.field === undefined ? storedValue(raw) : recordAt(raw)[slot.field];

  return Value.Check(schema, stored) ? stored : fallback;
}

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

    const cleared = event.key === null;

    for (const preference of reloadable) {
      if (cleared || event.key === preference.key) preference.reload();
    }
  });
}
