import { sessionMark, type OutboxRow, type SessionMark } from "@nyte-ai/client";
import type { SessionId, SessionInfo } from "@nyte-ai/protocol";

/** A local submission supersedes terminal history while it remains in the outbox. */
export function sessionActivityMark(
  session: Pick<SessionInfo, "heads">,
  optimistic: boolean,
): SessionMark {
  const mark = sessionMark(session);

  return optimistic && (mark === "idle" || mark === "failed") ? "working" : mark;
}

export function optimisticSessionIds(rows: readonly OutboxRow[]): ReadonlySet<SessionId> {
  return new Set(
    rows
      .values()
      .filter((row) => row.state.kind !== "retrying")
      .map((row) => row.input.sessionId),
  );
}
