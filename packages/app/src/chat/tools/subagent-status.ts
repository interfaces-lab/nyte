import { runMark, taskLabel } from "@nyte-ai/plugin/client/presentation";
import type { RunStatus, ToolStatus } from "@nyte-ai/plugin/client/presentation";

export interface SubagentStatus {
  readonly indicator: "running" | "attention" | "failed" | "unread" | "done";
  readonly text: string;
}

export function callStatus(status: ToolStatus): SubagentStatus {
  switch (status.tone) {
    case "running":
      return { indicator: "running", text: "Starting up" };
    case "attention":
      return { indicator: "attention", text: status.word ?? "" };
    case "success":
      return { indicator: "done", text: "" };
    case "failure":
      return { indicator: "failed", text: status.word ?? "" };
    case "stopped":
      return { indicator: "done", text: status.word ?? "" };
    default: {
      const _exhaustive: never = status.tone;

      return _exhaustive;
    }
  }
}

/** A subagent row's indicator and line for its chat's status. A stopped agent is done, never failed. */
export function subagentStatus(status: RunStatus, unread: boolean): SubagentStatus {
  switch (status.kind) {
    case "working":
      return { indicator: "running", text: taskLabel(runMark(status)) };
    case "waiting-for-approval":
      return { indicator: "attention", text: taskLabel(runMark(status)) };
    case "retrying":
      return { indicator: "running", text: taskLabel(runMark(status)) };
    case "idle":
      return { indicator: "done", text: "" };
    case "completed":
      return { indicator: unread ? "unread" : "done", text: taskLabel(runMark(status)) };
    case "stopped":
      return { indicator: "done", text: taskLabel(runMark(status)) };
    case "failed":
      return { indicator: "failed", text: taskLabel(runMark(status)) };
    default: {
      const _exhaustive: never = status;

      return _exhaustive;
    }
  }
}
