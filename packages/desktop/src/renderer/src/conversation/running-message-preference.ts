import { useSyncExternalStore } from "react";

export type RunningMessagePreference = "queue" | "steer";

const STORAGE_KEY = "nyte:running-message:v1";
const listeners = new Set<() => void>();

function readPreference(): RunningMessagePreference {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "steer" ? "steer" : "queue";
  } catch {
    return "queue";
  }
}

let preference = readPreference();

function getPreference(): RunningMessagePreference {
  return preference;
}

export function setRunningMessagePreference(value: RunningMessagePreference): void {
  preference = value;
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    return;
  } finally {
    for (const listener of listeners) listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRunningMessagePreference(): RunningMessagePreference {
  return useSyncExternalStore(subscribe, getPreference, getPreference);
}
