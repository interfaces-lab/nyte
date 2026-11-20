import type { CatalogId, SessionCatalogView } from "@nyte-ai/schema";

export interface Catalogs {
  known(id: CatalogId): SessionCatalogView | undefined;
  read(id: CatalogId): Promise<SessionCatalogView>;
}

export function catalogCache(read: (id: CatalogId) => Promise<SessionCatalogView>): Catalogs {
  const known = new Map<CatalogId, SessionCatalogView>();
  const reading = new Map<CatalogId, Promise<SessionCatalogView>>();

  return {
    known: (id) => known.get(id),
    read(id) {
      const pending = reading.get(id);

      if (pending !== undefined) return pending;

      const made = read(id).then((catalog) => {
        known.set(id, catalog);

        return catalog;
      });

      reading.set(id, made);
      made.then(
        () => reading.delete(id),
        () => reading.delete(id),
      );

      return made;
    },
  };
}
