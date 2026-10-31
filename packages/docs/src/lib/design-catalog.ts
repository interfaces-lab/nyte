import { allDesignPages, type DocPage } from "./docs";

/** A page's place in the design catalogue. Each labelled section counts its own pages from 01. */
export interface CatalogEntry {
  readonly page: DocPage;
  readonly number: string;
  readonly total: number;
}

export interface CatalogSection {
  readonly label: string;
  readonly entries: readonly CatalogEntry[];
}

/** The sections in `meta.json` order, without the overview page that opens a folder. */
export const catalog: readonly CatalogSection[] = [
  ...new Set(allDesignPages().flatMap((page) => (page.section ? [page.section] : []))),
].map((label) => {
  const pages = allDesignPages().filter((page) => page.section === label && !page.overview);

  return {
    label,
    entries: pages.map((page, index) => ({
      page,
      number: String(index + 1).padStart(2, "0"),
      total: pages.length,
    })),
  };
});

const entriesByUrl = new Map(
  catalog.flatMap((section) => section.entries.map((entry) => [entry.page.url, entry] as const)),
);

export function findEntry(url: string): CatalogEntry | undefined {
  return entriesByUrl.get(url);
}

/** The last path segment, which names the component or foundation: `/design/button` is `button`. */
export function pageSlug(page: DocPage): string {
  return page.slugs.at(-1) ?? "";
}
