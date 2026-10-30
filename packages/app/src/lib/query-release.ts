import { hashKey } from "@tanstack/react-query";
import type { QueryCache, QueryKey } from "@tanstack/react-query";

const held = new WeakMap<QueryCache, Map<string, () => void>>();

/** Runs `release` when `cache` drops `key`, or when `key` is held again and this release is replaced. */
export function releaseWithQuery(cache: QueryCache, key: QueryKey, release: () => void): void {
  const releases = cacheReleases(cache);
  const hash = hashKey(key);
  releases.get(hash)?.();
  releases.set(hash, release);
}

function cacheReleases(cache: QueryCache): Map<string, () => void> {
  const known = held.get(cache);

  if (known !== undefined) return known;
  const releases = new Map<string, () => void>();
  held.set(cache, releases);
  cache.subscribe((event) => {
    if (event.type !== "removed") return;
    const release = releases.get(event.query.queryHash);

    if (release === undefined) return;
    releases.delete(event.query.queryHash);
    release();
  });

  return releases;
}
