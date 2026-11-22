import { useSyncExternalStore } from "react";
import { Type } from "typebox";
import { persisted } from "../../lib/storage.ts";

const MAX_RECENT = 100;

const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

const NO_RECENT: readonly string[] = [];

export type SuggestionFrecency = Readonly<Record<string, number>>;

const NO_FRECENCY: SuggestionFrecency = {};

const recent = persisted("nyte:composer:recent:v1", Type.Array(Type.String()), NO_RECENT);

const frecency = persisted(
  "nyte:composer:frecency:v1",
  Type.Record(Type.String(), Type.Number()),
  NO_FRECENCY,
);

export function useRecentSuggestions(): readonly string[] {
  return useSyncExternalStore(recent.subscribe, recent.get, () => NO_RECENT);
}

export function useSuggestionFrecency(): SuggestionFrecency {
  return useSyncExternalStore(frecency.subscribe, frecency.get, () => NO_FRECENCY);
}

export function rememberSuggestion(id: string): void {
  const current = recent.get();

  if (current[0] !== id) {
    recent.set([id, ...current.filter((held) => held !== id)].slice(0, MAX_RECENT));
  }
  const halfLives = Date.now() / HALF_LIFE_MS;
  const weights = frecency.get();
  const held = weights[id];
  const weight =
    held === undefined ? halfLives : halfLives + Math.log2(1 + 2 ** (held - halfLives));

  frecency.set(
    Object.fromEntries(
      Object.entries({ ...weights, [id]: weight })
        .sort((left, right) => right[1] - left[1])
        .slice(0, MAX_RECENT),
    ),
  );
}
