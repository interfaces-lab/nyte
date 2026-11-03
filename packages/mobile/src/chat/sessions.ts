import type { SessionInfo } from "@nyte-ai/sdk";
import { useState } from "react";
import { sessionMark } from "@nyte-ai/plugin/client/presentation";
import type { TaskState } from "@nyte-ai/plugin/client/presentation";
import { healthMessage, updatedLabel, useHealth, useSessions } from "../connection/live.ts";
import type { LiveHost } from "../connection/live.ts";
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

export const statusLabels: Record<TaskState, string> = {
  waiting: "Needs input",
  retrying: "Retrying",
  working: "Working",
  background: "Working in the background",
  failed: "Failed",
  done: "Ready",
};

export function inProgress(session: SessionInfo): boolean {
  const mark = sessionMark(session);

  return mark === "working" || mark === "retrying";
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

  if (mark !== "done") return statusLabels[mark];

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
export function markTone(mark: TaskState, theme: Theme) {
  switch (mark) {
    case "working":
    case "background":
      return { color: theme.accent, fill: theme.fill };
    case "retrying":
      return { color: theme.warning, fill: theme.warningFill };
    case "waiting":
      return { color: theme.accent, fill: theme.fill };
    case "failed":
      return { color: theme.danger, fill: theme.dangerFill };
    case "done":
      return { color: theme.success, fill: theme.successFill };
  }
}

export function useSessionList(live: LiveHost, search = "") {
  const [limit, setLimit] = useState(PAGE);
  const listed = useSessions(live, { parents: { kind: "roots" }, limit });
  const health = healthMessage(useHealth(live));
  const needle = search.trim().toLocaleLowerCase();
  const current = listed?.sessions;
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
      : health !== undefined
        ? { kind: "failed", message: health }
        : { kind: "loading" };

  const more = () => setLimit((previous) => previous + PAGE);

  return {
    list,
    busy: current === undefined && rows !== undefined,
    error: rows === undefined ? undefined : health,
    updated: updatedLabel(listed?.freshness),
    refresh: () => live.retry(),
    more,
  };
}
