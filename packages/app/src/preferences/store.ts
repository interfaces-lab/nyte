import { useSyncExternalStore } from "react";
import { Type } from "typebox";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";
import { localArea, readStored, writeStored } from "../lib/storage.ts";

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

const EMPTY_RECORD: Static<typeof StoredRecord> = {};

function read<S extends TSchema>(slot: PreferenceSlot, schema: S, fallback: Static<S>): Static<S> {
  if (slot.field === undefined)
    return readStored(localArea(), slot.key, schema, fallback, { text: true });
  const stored = readStored(localArea(), slot.key, StoredRecord, EMPTY_RECORD)[slot.field];

  return Value.Check(schema, stored) ? stored : fallback;
}

function write(slot: PreferenceSlot, value: unknown): void {
  writeStored(
    localArea(),
    slot.key,
    slot.field === undefined
      ? value
      : { ...readStored(localArea(), slot.key, StoredRecord, EMPTY_RECORD), [slot.field]: value },
  );
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
      write(slot, next);
      value = next;
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
    if (event.storageArea !== localArea()) return;

    const cleared = event.key === null;

    for (const preference of reloadable) {
      if (cleared || event.key === preference.key) preference.reload();
    }
  });
}
