import { sessionMark, type SessionMark } from "@nyte-ai/client";
import type { NyteClient } from "@nyte-ai/client";
import type { SessionInfo } from "@nyte-ai/protocol";
import { useCallback } from "react";
import { keepPreviousData, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { describeHostError } from "../connection/connection.ts";
import type { Theme } from "../theme.ts";

type SessionListState =
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | {
      kind: "ready";
      sessions: readonly SessionInfo[];
      next: string | undefined;
    };

export const statusLabels: Record<SessionMark, string> = {
  waiting: "Needs input",
  retry: "Retrying",
  working: "Working",
  failed: "Failed",
  idle: "Ready",
};

export function isActive(session: SessionInfo): boolean {
  const mark = sessionMark(session);

  return mark === "working" || mark === "retry";
}

export function needsAttention(session: SessionInfo): boolean {
  return needsInput(session) || hasFailed(session);
}

/** A question or an activation the user has to answer. */
export function needsInput(session: SessionInfo): boolean {
  return sessionMark(session) === "waiting" || session.activation.kind === "requires";
}

export function hasFailed(session: SessionInfo): boolean {
  return sessionMark(session) === "failed";
}

/**
 * The status word a row prints. Rows say "Finished" and "New" where the mark
 * says "Ready", so labels and speech read the same text.
 */
export function rowStatus(session: SessionInfo): string {
  const mark = sessionMark(session);

  if (mark !== "idle") return statusLabels[mark];

  return latestRun(session) === undefined ? "New" : "Finished";
}

/** The run a list row reports on: the newest head's run, when it exists. */
export function latestRun(session: SessionInfo) {
  return session.heads[0]?.run;
}

/** One relative clock for list rows: Now, minutes, hours, days, then a date. */
export function formatActivity(at: number, now: number): string {
  const minutes = Math.round((now - at) / 60_000);

  if (minutes < 1) return "Now";

  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.round(minutes / 60);

  if (hours < 24) return `${String(hours)}h`;
  const days = Math.round(hours / 24);

  if (days < 7) return `${String(days)}d`;

  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Elapsed run time: 42s, 5m, 1h 12m. */
export function elapsed(at: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - at) / 1000));

  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);

  return `${String(hours)}h ${String(minutes % 60)}m`;
}

/** The color and fill pair a session mark paints with. */
export function markTone(mark: SessionMark, theme: Theme) {
  switch (mark) {
    case "working":
      return { color: theme.accent, fill: theme.fill };
    case "retry":
      return { color: theme.warning, fill: theme.warningFill };
    case "waiting":
      return { color: theme.accent, fill: theme.fill };
    case "failed":
      return { color: theme.danger, fill: theme.dangerFill };
    case "idle":
      return { color: theme.success, fill: theme.successFill };
  }
}

/**
 * The shared sessions read for the root list. The query polls quietly while a
 * run is live so rows move from Working to Finished on their own, and the app
 * foreground wiring refetches after a share moves underneath. `refresh` resets
 * to loading for a pull; `reload` keeps the rows up.
 */
export function useSessionList(client: NyteClient, search = "") {
  const queryClient = useQueryClient();
  const key = ["sessions", search] as const;

  const query = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => {
      const request = { parent: null, limit: 50 };
      const paged = pageParam === undefined ? request : { ...request, cursor: pageParam };

      return client.sessions.list(search === "" ? paged : { ...paged, search });
    },
    // SAFETY: widens the first page's absent cursor to the cursor type later pages carry.
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.next,
    // A debounced search change shows the last list while the new one lands.
    placeholderData: keepPreviousData,
    refetchInterval: (entry) =>
      entry.state.data?.pages.some((page) => page.items.some(isActive)) === true ? 10_000 : false,
  });

  const list: SessionListState = query.isPending
    ? { kind: "loading" }
    : query.data === undefined
      ? { kind: "failed", message: describeHostError(query.error) }
      : {
          kind: "ready",
          sessions: query.data.pages.flatMap((page) => page.items),
          next: query.data.pages.at(-1)?.next,
        };

  // A next-page failure keeps the loaded rows; only the banner knows.
  const error =
    query.error !== null && query.data !== undefined ? describeHostError(query.error) : undefined;

  const refresh = useCallback(() => {
    void queryClient.resetQueries({ queryKey: ["sessions", search] });
  }, [queryClient, search]);

  const { refetch, fetchNextPage } = query;

  const reload = useCallback(() => {
    void refetch();
  }, [refetch]);

  const more = useCallback(() => {
    void fetchNextPage();
  }, [fetchNextPage]);

  return {
    list,
    // A placeholder page set still answers to the previous key's cursor, so
    // "Show more" waits for the real page to land.
    busy: query.isFetchingNextPage || query.isPlaceholderData,
    error,
    refresh,
    reload,
    more,
  };
}
