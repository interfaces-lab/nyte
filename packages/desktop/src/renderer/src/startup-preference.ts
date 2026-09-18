import { useSyncExternalStore } from "react";
import type { SessionId, SessionInfo } from "@nyte-ai/protocol";

const STARTUP_DESTINATION_KEY = "nyte:startup-destination:v1";

export type StartupDestination = "new-chat" | "last-session";

const DEFAULT_STARTUP_DESTINATION: StartupDestination = "new-chat";

interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const listeners = new Set<() => void>();

function localPreferenceStorage(): PreferenceStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function parseStartupDestination(value: string | null): StartupDestination {
  return value === "last-session" ? "last-session" : DEFAULT_STARTUP_DESTINATION;
}

function readStartupDestination(storage?: PreferenceStorage): StartupDestination {
  try {
    return parseStartupDestination(storage?.getItem(STARTUP_DESTINATION_KEY) ?? null);
  } catch {
    return DEFAULT_STARTUP_DESTINATION;
  }
}

function persistStartupDestination(
  storage: PreferenceStorage,
  destination: StartupDestination,
): void {
  storage.setItem(STARTUP_DESTINATION_KEY, destination);
}

let startupDestination = readStartupDestination(localPreferenceStorage());

export function getStartupDestination(): StartupDestination {
  return startupDestination;
}

export function setStartupDestination(destination: StartupDestination): void {
  startupDestination = destination;
  const storage = localPreferenceStorage();
  if (storage !== undefined) {
    try {
      persistStartupDestination(storage, destination);
    } catch {
      // The in-memory choice remains useful when persistence is unavailable.
    }
  }
  for (const listener of listeners) listener();
}

function subscribeStartupDestination(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useStartupDestination(): StartupDestination {
  return useSyncExternalStore(
    subscribeStartupDestination,
    getStartupDestination,
    getStartupDestination,
  );
}

/** The directory is newest-first, so its first item is the supported alternate destination. */
export function startupSession(
  destination: StartupDestination,
  sessions: readonly Pick<SessionInfo, "sessionId">[],
): SessionId | undefined {
  return destination === "last-session" ? sessions[0]?.sessionId : undefined;
}
