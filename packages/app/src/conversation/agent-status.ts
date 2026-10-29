import type { SessionInfo } from "@nyte-ai/sdk";
import { sessionMark } from "@nyte-ai/plugin/client/presentation";

export type SubagentTrayState = "working" | "attention" | "completed" | "failed";

export function subagentTrayState(session: Pick<SessionInfo, "heads">): SubagentTrayState {
  const mark = sessionMark(session);

  switch (mark) {
    case "waiting":
      return "attention";
    case "working":
    case "retry":
      return "working";
    case "failed":
      return "failed";
    case "idle":
      return "completed";
    default: {
      const _exhaustive: never = mark;

      return _exhaustive;
    }
  }
}

/** Whether the tray lists an agent as active: running, or waiting on the user. */
export function subagentTrayActive(state: SubagentTrayState): boolean {
  return state === "working" || state === "attention";
}
