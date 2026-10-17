import type { SessionInfo } from "@nyte-ai/sdk";

export function sessionHasUnreadCompletion(session: Pick<SessionInfo, "heads">): boolean {
  const head = session.heads[0];

  return (
    head !== undefined &&
    head.unread &&
    head.execution.kind === "idle" &&
    head.execution.lastRun?.end.kind === "completed"
  );
}
