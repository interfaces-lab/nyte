import type { SessionInfo } from "@nyte-ai/sdk";
import { sessionMark } from "./view-helpers.ts";
import type { SessionMark } from "./view-helpers.ts";

export function sessionActivityMark(
  session: Pick<SessionInfo, "heads">,
  working: boolean,
): SessionMark {
  const mark = sessionMark(session);

  return working && (mark === "idle" || mark === "failed") ? "working" : mark;
}
