Nyte's customer-facing documentation (nyte.sh) and design-system reference (design.nyte.sh), one TanStack Start app. `src/lib/hosts.ts` maps the design host onto the `/design` routes.
Product guides here describe what ships. Experiments belong in `packages/lab`.
Page order lives in each content folder's `meta.json`: the root one lists pages, `---Label---` starts a sidebar section, and `...folder` inlines a folder in its own `meta.json` order. A page no `meta.json` lists fails the server at startup.
Search uses Algolia when `VITE_ALGOLIA_APP_ID` and `VITE_ALGOLIA_SEARCH_KEY` are set at build, and the local `/api/search` index otherwise. After each deploy, run `ALGOLIA_APP_ID=… ALGOLIA_WRITE_KEY=… pnpm sync:algolia https://nyte.sh` to replace the index with the deployed pages.
