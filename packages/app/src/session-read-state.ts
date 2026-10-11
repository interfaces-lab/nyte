import type { SessionInfo } from "@nyte-ai/sdk";

/**
 * Whether a session finished a reply nobody has seen: its main head is idle
 * after a completed run and its tip is past this principal's seen mark,
 * which a watch moves as it yields. The host keeps the mark, so every client
 * agrees.
 */
export function sessionHasUnreadCompletion(session: Pick<SessionInfo, "heads">): boolean {
  const head = session.heads[0];

  return (
    head !== undefined &&
    head.unread &&
    head.execution.kind === "idle" &&
    head.execution.lastRun?.end.kind === "completed"
  );
}
