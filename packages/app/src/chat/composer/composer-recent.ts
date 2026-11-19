import { useSyncExternalStore } from "react";
import { Type } from "typebox";
import { persisted } from "../../lib/storage.ts";

const MAX_RECENT = 100;

const NO_RECENT: readonly string[] = [];

const recent = persisted("nyte:composer:recent:v1", Type.Array(Type.String()), NO_RECENT);

export function useRecentSuggestions(): readonly string[] {
  return useSyncExternalStore(recent.subscribe, recent.get, () => NO_RECENT);
}

export function rememberSuggestion(id: string): void {
  const current = recent.get();

  if (current[0] === id) return;
  recent.set([id, ...current.filter((held) => held !== id)].slice(0, MAX_RECENT));
}
