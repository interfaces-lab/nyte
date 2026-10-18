#!/usr/bin/env node
/**
 * Replaces the Algolia index with the site's pages, read from a running copy
 * of the site, after each deploy:
 *
 *   ALGOLIA_APP_ID=… ALGOLIA_WRITE_KEY=… pnpm sync:algolia https://nyte.sh
 *
 * ALGOLIA_INDEX names the index; default `docs`, matching VITE_ALGOLIA_INDEX.
 */
import process from "node:process";
import { algoliasearch } from "algoliasearch";
import { sync } from "fumadocs-core/search/algolia";

const [site] = process.argv.slice(2);

const {
  ALGOLIA_APP_ID: appId,
  ALGOLIA_WRITE_KEY: writeKey,
  ALGOLIA_INDEX: indexName = "docs",
} = process.env;

if (site === undefined || appId === undefined || writeKey === undefined) {
  console.error("usage: ALGOLIA_APP_ID=… ALGOLIA_WRITE_KEY=… pnpm sync:algolia <site url>");
  process.exit(2);
}

const response = await fetch(new URL("/api/search-records", site));

if (!response.ok) {
  console.error(`${response.url} answered ${response.status}`);
  process.exit(1);
}

const documents = await response.json();

try {
  await sync(algoliasearch(appId, writeKey), { indexName, documents });
} catch (cause) {
  console.error(
    `Algolia refused the sync: ${cause instanceof Error ? cause.message : String(cause)}`,
  );
  process.exit(1);
}

console.log(`Synced ${documents.length} pages to ${indexName}`);
