import { sessionMark, type OutboxRow, type SessionMark } from "@nyte-ai/client";
import type { SessionId, SessionInfo } from "@nyte-ai/protocol";

/** A local submission still in the outbox, or a subagent still working, supersedes terminal history. */
export function sessionActivityMark(
  session: Pick<SessionInfo, "heads">,
  working: boolean,
): SessionMark {
  const mark = sessionMark(session);

  return working && (mark === "idle" || mark === "failed") ? "working" : mark;
}

export function optimisticSessionIds(rows: readonly OutboxRow[]): ReadonlySet<SessionId> {
  return new Set(
    rows
      .values()
      .filter((row) => row.state.kind !== "retrying")
      .map((row) => row.input.sessionId),
  );
}
