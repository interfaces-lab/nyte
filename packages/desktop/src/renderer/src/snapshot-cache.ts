import type { QueryClient } from "@tanstack/react-query";
import type { SessionId, SessionSnapshot } from "@nyte-ai/protocol";
import { keys } from "./query-keys.ts";

const SNAPSHOT_CACHE_MAX_ENTRIES = 12;
const SNAPSHOT_CACHE_MAX_BYTES = 64 * 1024 * 1024;

/**
 * Keeps unobserved transcripts within an entry and byte budget, oldest write
 * first. A transcript a pane still reads is never evicted.
 */
export function installSnapshotCacheBudget(
  client: QueryClient,
  policy = { maxEntries: SNAPSHOT_CACHE_MAX_ENTRIES, maxBytes: SNAPSHOT_CACHE_MAX_BYTES },
): () => void {
  const sizes = new Map<string, number>();
  let cancelEnforcement: (() => void) | undefined;

  const enforce = (): void => {
    cancelEnforcement = undefined;
    const cached = client
      .getQueryCache()
      .findAll({
        queryKey: ["snapshot"],
        predicate: (query) => query.queryKey.length === 2 && query.getObserversCount() === 0,
      })
      .toSorted((left, right) => left.state.dataUpdatedAt - right.state.dataUpdatedAt);

    let bytes = 0;
    let entries = 0;

    for (const query of cached.toReversed()) {
      const snapshot = client.getQueryData<SessionSnapshot>(query.queryKey);

      if (snapshot === undefined) continue;

      if (entries + 1 > policy.maxEntries || bytes > policy.maxBytes) {
        client.getQueryCache().remove(query);
        continue;
      }

      const size = sizes.get(query.queryHash) ?? JSON.stringify(snapshot).length * 2;
      sizes.set(query.queryHash, size);
      entries += 1;
      bytes += size;

      if (bytes > policy.maxBytes) client.getQueryCache().remove(query);
    }
  };

  const scheduleEnforcement = (): void => {
    if (cancelEnforcement !== undefined) return;
    if (typeof requestIdleCallback === "function") {
      const idle = requestIdleCallback(enforce, { timeout: 1_000 });
      cancelEnforcement = () => cancelIdleCallback(idle);
      return;
    }
    const timeout = setTimeout(enforce);
    cancelEnforcement = () => clearTimeout(timeout);
  };

  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (event.type === "removed") {
      sizes.delete(event.query.queryHash);
      return;
    }

    if (event.query.queryKey.length !== 2 || event.query.queryKey[0] !== "snapshot") return;
    const dataChanged =
      event.type === "added" ||
      (event.type === "updated" &&
        (event.action.type === "success" ||
          (event.action.type === "setState" && "data" in event.action.state)));
    if (dataChanged) sizes.delete(event.query.queryHash);
    if (event.query.getObserversCount() !== 0) return;
    if ((event.type !== "observerRemoved" && !dataChanged) || event.query.state.data === undefined)
      return;
    scheduleEnforcement();
  });
  return () => {
    cancelEnforcement?.();
    cancelEnforcement = undefined;
    sizes.clear();
    unsubscribe();
  };
}

/** Drop what the cache holds for a session nobody reads anymore; an open pane keeps its own. */
export function releaseSessionQueries(client: QueryClient, sessionId: SessionId): void {
  const cache = client.getQueryCache();
  const owned = [
    ...[
      keys.snapshot(sessionId),
      keys.session(sessionId),
      keys.jobs(sessionId),
      keys.children(sessionId),
      keys.childSessions(sessionId),
      keys.pluginSettings(sessionId),
      keys.sessionCatalog(sessionId),
      ["customize", sessionId] as const,
    ].flatMap((queryKey) => cache.findAll({ queryKey, exact: true })),
    ...cache.findAll({ queryKey: ["vcs", "run-diff", sessionId] }),
  ];
  for (const query of owned) {
    if (query.getObserversCount() === 0) cache.remove(query);
  }
}
