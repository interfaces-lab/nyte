import { sessionMark, type SessionMark } from "@nyte-ai/core/client";
import type { NyteClient } from "@nyte-ai/client";
import type { SessionInfo } from "@nyte-ai/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { describeHostError } from "../connection/connection.ts";
import type { Theme } from "../theme.ts";

export type SessionListState =
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

export function markOf(session: SessionInfo): SessionMark {
  return sessionMark(session);
}

export function isActive(session: SessionInfo): boolean {
  const mark = sessionMark(session);
  return mark === "working" || mark === "retry";
}

export function needsAttention(session: SessionInfo): boolean {
  const mark = sessionMark(session);
  return mark === "waiting" || mark === "failed" || session.activation.kind === "requires";
}

export function hasFinishedRun(session: SessionInfo): boolean {
  return session.heads.some((head) => head.run?.phase.kind === "done");
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
export function markTone(mark: SessionMark, theme: Theme): { color: string; fill: string } {
  switch (mark) {
    case "working":
      return { color: theme.accent, fill: theme.warningFill };
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
 * The shared sessions read for the root list. The list is only as fresh as its
 * last fetch, so returning to the app rechecks the host; `search` filters
 * server-side. `refresh` resets to loading; `reload` keeps the rows up.
 */
export function useSessionList(client: NyteClient, search = "") {
  const [list, setList] = useState<SessionListState>({ kind: "loading" });
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const activeClient = useRef<NyteClient | undefined>(undefined);
  const listVersion = useRef(0);

  const refresh = useCallback(() => {
    listVersion.current += 1;
    setList({ kind: "loading" });
    setError(undefined);
    setRevision((value) => value + 1);
  }, []);

  const reload = useCallback(() => {
    listVersion.current += 1;
    setError(undefined);
    setRevision((value) => value + 1);
  }, []);

  useEffect(() => {
    let current = true;
    const version = listVersion.current;
    void client.sessions
      .list({
        parent: null,
        limit: 50,
        ...(search === "" ? {} : { search }),
      })
      .then((page) => {
        if (current && listVersion.current === version)
          setList({ kind: "ready", sessions: page.items, next: page.next });
      })
      .catch((cause: unknown) => {
        if (current && listVersion.current === version)
          setList((existing) =>
            existing.kind === "ready"
              ? existing
              : { kind: "failed", message: describeHostError(cause) },
          );
      });
    return () => {
      current = false;
    };
  }, [client, revision, search]);

  useEffect(() => {
    activeClient.current = client;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => {
      activeClient.current = undefined;
      subscription.remove();
    };
  }, [client, refresh]);

  async function more() {
    if (busy || list.kind !== "ready" || list.next === undefined) return;
    const version = listVersion.current;
    setBusy(true);
    try {
      const page = await client.sessions.list({
        parent: null,
        cursor: list.next,
        limit: 50,
        ...(search === "" ? {} : { search }),
      });
      if (activeClient.current !== client || listVersion.current !== version) return;
      setList({
        kind: "ready",
        sessions: [...list.sessions, ...page.items],
        next: page.next,
      });
    } catch (cause) {
      if (activeClient.current === client && listVersion.current === version)
        setError(describeHostError(cause));
    } finally {
      if (activeClient.current === client) setBusy(false);
    }
  }

  return { list, busy, error, refresh, reload, more };
}
