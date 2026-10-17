import type { Connection, SessionInfo } from "@nyte-ai/sdk";
import { useMemo, useState } from "react";
import { sessionMark } from "@nyte-ai/plugin/client/presentation";
import type { SessionMark } from "@nyte-ai/plugin/client/presentation";
import { describeHostError } from "../connection/connection.ts";
import { useWatch } from "../connection/use-watch.ts";
import type { Theme } from "../theme.ts";
import { hasRun } from "../view-helpers.ts";

const PAGE = 50;

type SessionListState =
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | {
      kind: "ready";
      sessions: readonly SessionInfo[];
      next: number | undefined;
    };

export const statusLabels: Record<SessionMark, string> = {
  waiting: "Needs input",
  retry: "Retrying",
  working: "Working",
  failed: "Failed",
  idle: "Ready",
};

export function inProgress(session: SessionInfo): boolean {
  const mark = sessionMark(session);

  return mark === "working" || mark === "retry";
}

export function needsAttention(session: SessionInfo): boolean {
  return needsInput(session) || hasFailed(session);
}

export function needsInput(session: SessionInfo): boolean {
  return sessionMark(session) === "waiting";
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

  return hasRun(session) ? "Finished" : "New";
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

export function useSessionList(client: Connection, search = "") {
  const [limit, setLimit] = useState(PAGE);

  const [watched, restart] = useWatch(
    useMemo(
      () => ({ watch: () => client.sessions.watch({ parents: { kind: "roots" }, limit }) }),
      [client, limit],
    ),
  );

  const needle = search.trim().toLocaleLowerCase();

  const current =
    watched.kind === "ready" ? watched.value : watched.kind === "failed" ? watched.last : undefined;

  const [seen, setSeen] = useState(current);

  if (current !== undefined && current !== seen) setSeen(current);
  const rows = current ?? seen;

  const list: SessionListState =
    rows !== undefined
      ? {
          kind: "ready",
          sessions:
            needle === ""
              ? rows
              : rows.filter((session) => (session.name ?? "").toLocaleLowerCase().includes(needle)),
          next: rows.length >= limit ? limit + PAGE : undefined,
        }
      : watched.kind === "failed"
        ? { kind: "failed", message: describeHostError(watched.error) }
        : { kind: "loading" };

  const error =
    watched.kind === "failed" && rows !== undefined ? describeHostError(watched.error) : undefined;

  const refresh = () => {
    setSeen(undefined);
    restart();
  };

  const more = () => setLimit((previous) => previous + PAGE);

  return { list, busy: watched.kind === "loading" && rows !== undefined, error, refresh, more };
}
