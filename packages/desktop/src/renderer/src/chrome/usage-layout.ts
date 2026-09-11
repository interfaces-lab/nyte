/**
 * Which usage cards sit where, and what the page can label before it has read
 * anything. The order is the reader's, so it survives a restart, and a build
 * that adds or retires a card still opens: unknown ids are dropped and new ones
 * join at their default position.
 */
import { useSyncExternalStore } from "react";

export const USAGE_CARDS = ["spend", "tokens", "models", "activity", "folders", "chats"] as const;
export type UsageCard = (typeof USAGE_CARDS)[number];

export const CARD_TITLES: Readonly<Record<UsageCard, string>> = {
  spend: "API estimate",
  tokens: "Tokens",
  models: "By model",
  activity: "Activity",
  folders: "By folder",
  chats: "By chat",
};

/** The two cards whose bodies are ranked rows rather than a chart. */
export const LIST_CARDS: readonly UsageCard[] = ["folders", "chats"];

export const USAGE_TILES = ["spend", "tokens", "requests", "busiest"] as const;
export type UsageTile = (typeof USAGE_TILES)[number];

export const TILE_LABELS: Readonly<Record<UsageTile, string>> = {
  spend: "API estimate",
  tokens: "Tokens",
  requests: "Requests",
  busiest: "Busiest chat",
};

const STORAGE_KEY = "nyte:usage-layout:v1";

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

function isUsageCard(value: unknown): value is UsageCard {
  return USAGE_CARDS.some((card) => card === value);
}

/** Stored ids first, in their stored order, then whatever this build added. */
export function parseUsageOrder(value: string | null): readonly UsageCard[] {
  if (value === null) return USAGE_CARDS;
  try {
    const stored: unknown = JSON.parse(value);
    if (!Array.isArray(stored)) return USAGE_CARDS;
    const kept: UsageCard[] = [];
    for (const card of stored) {
      if (isUsageCard(card) && !kept.includes(card)) kept.push(card);
    }
    return [...kept, ...USAGE_CARDS.filter((card) => !kept.includes(card))];
  } catch {
    return USAGE_CARDS;
  }
}

export function readUsageOrder(storage?: PreferenceStorage): readonly UsageCard[] {
  try {
    return parseUsageOrder(storage?.getItem(STORAGE_KEY) ?? null);
  } catch {
    return USAGE_CARDS;
  }
}

export function isDefaultUsageOrder(order: readonly UsageCard[]): boolean {
  return order.every((card, index) => card === USAGE_CARDS[index]);
}

let order = readUsageOrder(localPreferenceStorage());

export function getUsageOrder(): readonly UsageCard[] {
  return order;
}

export function setUsageOrder(next: readonly UsageCard[]): void {
  order = next;
  const storage = localPreferenceStorage();
  if (storage !== undefined) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // The arrangement still holds for this session when persistence is unavailable.
    }
  }
  for (const listener of listeners) listener();
}

export function subscribeUsageOrder(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useUsageOrder(): readonly UsageCard[] {
  return useSyncExternalStore(subscribeUsageOrder, getUsageOrder, getUsageOrder);
}
