import { useSyncExternalStore } from "react";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

const schema = Type.Object({
  visible: Type.Boolean(),
  items: Type.Array(
    Type.Object({ url: Type.String({ pattern: "^https?://" }), title: Type.String() }),
  ),
});
type Bookmarks = Static<typeof schema>;
const KEY = "nyte:browser:bookmarks:v1";
const EMPTY: Bookmarks = { visible: false, items: [] };
let current: Bookmarks | undefined;
const listeners = new Set<() => void>();

function decodeBookmarks(serialized: string): Bookmarks | undefined {
  try {
    const value: unknown = JSON.parse(serialized);
    return Value.Check(schema, value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function snapshot(): Bookmarks {
  if (current !== undefined) return current;
  try {
    current = decodeBookmarks(window.localStorage.getItem(KEY) ?? "") ?? EMPTY;
  } catch {
    current = EMPTY;
  }
  return current;
}

function save(next: Bookmarks): void {
  current = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Keep bookmarks usable for this window when storage is unavailable.
  }
  for (const listener of listeners) listener();
}

export function toggleBookmarkBar(): void {
  const value = snapshot();
  save({ ...value, visible: !value.visible });
}

export function toggleBookmark(page: Bookmarks["items"][number]): void {
  const value = snapshot();
  const exists = value.items.some((item) => item.url === page.url);
  save({
    ...value,
    items: exists ? value.items.filter((item) => item.url !== page.url) : [...value.items, page],
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useBookmarks(): Bookmarks {
  return useSyncExternalStore(subscribe, snapshot, () => EMPTY);
}
