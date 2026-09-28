import { sessionMark } from "@nyte-ai/client";
import type { SessionInfo } from "@nyte-ai/protocol";

export type SubagentTrayState = "working" | "attention" | "inactive";

export function subagentTrayState(session: Pick<SessionInfo, "heads">): SubagentTrayState {
  const mark = sessionMark(session);

  switch (mark) {
    case "waiting":
      return "attention";
    case "working":
    case "retry":
      return "working";
    case "failed":
    case "idle":
      return "inactive";
    default: {
      const _exhaustive: never = mark;

      return _exhaustive;
    }
  }
}
