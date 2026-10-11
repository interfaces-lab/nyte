import type { SessionInfo } from "@nyte-ai/sdk";
import { sessionMark } from "./view-helpers.ts";
import type { SessionMark } from "./view-helpers.ts";

/** A row's mark: its main head's execution, or working when a child still works for it. */
export function sessionActivityMark(
  session: Pick<SessionInfo, "heads">,
  working: boolean,
): SessionMark {
  const mark = sessionMark(session);

  return working && (mark === "idle" || mark === "failed") ? "working" : mark;
}
