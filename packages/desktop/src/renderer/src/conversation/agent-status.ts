import { sessionMark } from "@nyte-ai/client";
import type { SessionInfo } from "@nyte-ai/protocol";
import type { ProvisionalSubagentSession } from "./subagent-sessions.ts";

export type AgentState = "idle" | "working" | "completed" | "failed" | "stopped";

type AgentStatusSource = Pick<SessionInfo, "heads"> | ProvisionalSubagentSession;

export function agentState(session: AgentStatusSource): AgentState {
  if ("kind" in session) return "working";
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

export type SubagentTrayState = "working" | "attention" | "inactive";

export function subagentTrayState(session: AgentStatusSource): SubagentTrayState {
  if ("kind" in session) return "working";
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
