import type { SessionInfo } from "@nyte-ai/sdk";
import { sessionMark } from "@nyte-ai/plugin/client/presentation";
import type { SessionMark } from "@nyte-ai/plugin/client/presentation";

export function sessionActivityMark(
  session: Pick<SessionInfo, "heads">,
  working: boolean,
): SessionMark {
  const mark = sessionMark(session);

  return working && (mark === "idle" || mark === "failed") ? "working" : mark;
}
