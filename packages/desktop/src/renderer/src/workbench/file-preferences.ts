import { useSyncExternalStore } from "react";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

const filePreferencesSchema = Type.Object(
  {
    lineNumbers: Type.Boolean(),
    wordWrap: Type.Boolean(),
    gitBlame: Type.Boolean(),
    autoSave: Type.Boolean(),
    formatOnSave: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type FilePreferences = Static<typeof filePreferencesSchema>;

export const defaultFilePreferences: FilePreferences = {
  lineNumbers: true,
  wordWrap: true,
  gitBlame: false,
  // Opening a file must not opt a workspace into writes or formatter execution.
  autoSave: false,
  formatOnSave: false,
};

const STORAGE_KEY = "nyte:desktop:file-preferences:v1";

export function decodeFilePreferences(serialized: string | null): FilePreferences {
  if (serialized === null) return defaultFilePreferences;
  try {
    const value: unknown = JSON.parse(serialized);
    return Value.Check(filePreferencesSchema, value) ? value : defaultFilePreferences;
  } catch {
    return defaultFilePreferences;
  }
}

function readPreferences(): FilePreferences {
  try {
    return decodeFilePreferences(globalThis.window?.localStorage?.getItem(STORAGE_KEY) ?? null);
  } catch {
    return defaultFilePreferences;
  }
}

let snapshot = readPreferences();
const listeners = new Set<() => void>();

export function setFilePreference(key: keyof FilePreferences, value: boolean): void {
  if (snapshot[key] === value) return;
  snapshot = { ...snapshot, [key]: value };
  try {
    globalThis.window?.localStorage?.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Disabled storage must not prevent changing editor preferences in this window.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): FilePreferences {
  return snapshot;
}

export function useFilePreferences(): FilePreferences {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
