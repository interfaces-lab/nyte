interface ImportMetaEnv {
  /** With `VITE_ALGOLIA_SEARCH_KEY`, sends site search to Algolia instead of `/api/search`. */
  readonly VITE_ALGOLIA_APP_ID?: string;
  /** Algolia's search-only key; it is public by design. */
  readonly VITE_ALGOLIA_SEARCH_KEY?: string;
  /** Default `docs`, the index `pnpm sync:algolia` fills. */
  readonly VITE_ALGOLIA_INDEX?: string;
}
