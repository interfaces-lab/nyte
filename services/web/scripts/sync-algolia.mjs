#!/usr/bin/env node
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

if (!URL.canParse(site)) {
  console.error("Use an absolute site URL, such as https://nyte.sh.");
  process.exit(2);
}

const response = await fetch(new URL("/api/search-records", site)).catch(() => {
  console.error(
    "Couldn’t load search records. Check the site URL and your connection, then rerun sync:algolia.",
  );
  process.exit(1);
});

if (!response.ok) {
  console.error(
    `Couldn’t load search records (HTTP ${response.status}). Check that the site serves /api/search-records, then rerun sync:algolia.`,
  );
  process.exit(1);
}

const documents = await response.json().catch(() => {
  console.error(
    "The site returned invalid search records. Check that /api/search-records serves JSON, then rerun sync:algolia.",
  );
  process.exit(1);
});

try {
  await sync(algoliasearch(appId, writeKey), { indexName, documents });
} catch (cause) {
  console.error(
    `Algolia sync failed: ${cause instanceof Error ? cause.message : String(cause)}. Check ALGOLIA_APP_ID, ALGOLIA_WRITE_KEY write access, and ALGOLIA_INDEX. Inspect the index before running sync:algolia again; the sync may have changed it.`,
  );
  process.exit(1);
}

console.log(`Synced ${documents.length} pages to ${indexName}`);
