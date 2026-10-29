import { useSyncExternalStore } from "react";
import { Type, type Static } from "typebox";
import { persisted } from "../persistence.ts";

const schema = Type.Object({
  visible: Type.Boolean(),
  items: Type.Array(
    Type.Object({ url: Type.String({ pattern: "^https?://" }), title: Type.String() }),
  ),
});

type Bookmarks = Static<typeof schema>;

const EMPTY: Bookmarks = { visible: false, items: [] };

const bookmarks = persisted("nyte:browser:bookmarks:v1", schema, EMPTY);

export function toggleBookmarkBar(): void {
  const value = bookmarks.get();
  bookmarks.set({ ...value, visible: !value.visible });
}

export function toggleBookmark(page: Bookmarks["items"][number]): void {
  const value = bookmarks.get();
  const exists = value.items.some((item) => item.url === page.url);
  bookmarks.set({
    ...value,
    items: exists ? value.items.filter((item) => item.url !== page.url) : [...value.items, page],
  });
}

export function useBookmarks(): Bookmarks {
  return useSyncExternalStore(bookmarks.subscribe, bookmarks.get, () => EMPTY);
}
