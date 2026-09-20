import type { SessionInfo } from "@nyte-ai/protocol";

export type AgentState = "idle" | "working" | "completed" | "failed" | "stopped";

export function agentState(session: Pick<SessionInfo, "heads">): AgentState {
  const run = session.heads[0]?.run;
  if (run === undefined) return "idle";
  switch (run.phase.kind) {
    case "respond":
    case "tools":
    case "waiting":
    case "retry":
      return "working";
    case "done":
      return "completed";
    case "failed":
      return "failed";
    case "aborted":
      return "stopped";
    default: {
      const _exhaustive: never = run.phase;
      return _exhaustive;
    }
  }
}

export const AGENT_STATE_LABEL = {
  idle: "Idle",
  working: "Working",
  completed: "Completed",
  failed: "Failed",
  stopped: "Stopped",
} satisfies Readonly<Record<AgentState, string>>;
