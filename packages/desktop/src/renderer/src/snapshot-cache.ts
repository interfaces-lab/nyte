import type { QueryClient } from "@tanstack/react-query";
import type { SessionId, SessionSnapshot } from "@nyte-ai/protocol";
import { keys } from "./query-keys.ts";

const SNAPSHOT_CACHE_MAX_ENTRIES = 12;
const SNAPSHOT_CACHE_MAX_BYTES = 64 * 1024 * 1024;

function isSnapshotKey(queryKey: readonly unknown[]): boolean {
  return queryKey.length === 2 && queryKey[0] === "snapshot" && typeof queryKey[1] === "string";
}

/**
 * Keeps unobserved transcripts within an entry and byte budget, oldest write
 * first. A transcript a pane still reads is never evicted.
 */
export function installSnapshotCacheBudget(
  client: QueryClient,
  policy = { maxEntries: SNAPSHOT_CACHE_MAX_ENTRIES, maxBytes: SNAPSHOT_CACHE_MAX_BYTES },
): () => void {
  const sizes = new Map<string, { readonly updatedAt: number; readonly bytes: number }>();
  let scheduled = false;
  let installed = true;

  const enforce = (): void => {
    scheduled = false;
    if (!installed) return;
    const cached = client
      .getQueryCache()
      .getAll()
      .filter((query) => isSnapshotKey(query.queryKey) && query.getObserversCount() === 0)
      .flatMap((query) => {
        const snapshot = client.getQueryData<SessionSnapshot>(query.queryKey);
        if (snapshot === undefined) return [];
        const previous = sizes.get(query.queryHash);
        const current =
          previous?.updatedAt === query.state.dataUpdatedAt
            ? previous
            : { updatedAt: query.state.dataUpdatedAt, bytes: JSON.stringify(snapshot).length * 2 };
        sizes.set(query.queryHash, current);
        return [{ query, ...current }];
      })
      .toSorted((left, right) => left.updatedAt - right.updatedAt);

    let bytes = cached.reduce((total, entry) => total + entry.bytes, 0);
    let entries = cached.length;
    for (const entry of cached) {
      if (entries <= policy.maxEntries && bytes <= policy.maxBytes) break;
      client.getQueryCache().remove(entry.query);
      sizes.delete(entry.query.queryHash);
      entries -= 1;
      bytes -= entry.bytes;
    }
  };

  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (event.type === "removed") sizes.delete(event.query.queryHash);
    if (!isSnapshotKey(event.query.queryKey) || scheduled) return;
    scheduled = true;
    queueMicrotask(enforce);
  });
  return () => {
    installed = false;
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
