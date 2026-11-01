import { hashKey } from "@tanstack/react-query";
import type { QueryCache, QueryFunctionContext } from "@tanstack/react-query";

const held = new WeakMap<QueryCache, Map<string, () => void>>();

/**
 * Gives `release` to the fetch `context` belongs to. A cancelled fetch runs it at once; one that
 * lands runs it when the cache drops the query or a later fetch of the query lands.
 */
export function releaseWithQuery(
  context: Pick<QueryFunctionContext, "client" | "queryKey" | "signal">,
  release: () => void,
): void {
  if (context.signal.aborted) {
    release();

    return;
  }

  const releases = cacheReleases(context.client.getQueryCache());
  const hash = hashKey(context.queryKey);
  const holder = () => release();
  releases.get(hash)?.();
  releases.set(hash, holder);
  context.signal.addEventListener(
    "abort",
    () => {
      if (releases.get(hash) !== holder) return;
      releases.delete(hash);
      holder();
    },
    { once: true },
  );
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
