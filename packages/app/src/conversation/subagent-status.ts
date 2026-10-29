import { toolDetail, toolVerbs } from "@nyte-ai/plugin/client/presentation";
import type { RunStatus, ToolStatus } from "@nyte-ai/plugin/client/presentation";
import { countWork } from "../work-counts.ts";
import type { SessionActivity } from "./session-activity.ts";

export interface SubagentStatus {
  readonly indicator: "running" | "attention" | "failed" | "unread" | "done";
  readonly text: string;
}

const PLANNING: SubagentStatus = { indicator: "running", text: "Planning next moves" };

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
    case "subagent-working":
      return PLANNING;
    case "waiting-for-approval":
      return { indicator: "attention", text: "Needs attention" };
    case "retrying":
      return { indicator: "running", text: "Retrying" };
    case "idle":
      return { indicator: "done", text: "" };
    case "completed":
      return { indicator: unread ? "unread" : "done", text: "Completed" };
    case "stopped":
      return { indicator: "done", text: "Stopped" };
    case "failed":
      return { indicator: "failed", text: "Stopped with error" };
    default: {
      const _exhaustive: never = status;

      return _exhaustive;
    }
  }
}

export function subagentActivity(
  activity: SessionActivity | undefined,
  cwd: string | undefined,
): string | undefined {
  countWork("select:activity");
  switch (activity?.kind) {
    case "tool": {
      const verb = toolVerbs(activity.toolClass).running;
      const detail = toolDetail(activity.toolClass, cwd)?.text;

      return detail === undefined ? verb : `${verb} ${detail}`;
    }
    case "thinking":
      return "Thinking";
    case "writing":
      return "Writing a response";
    case "idle":
    case undefined:
      return undefined;
    default: {
      const exhaustive: never = activity;

      return exhaustive;
    }
  }
}
