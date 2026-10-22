import type { SessionInfo } from "@nyte-ai/sdk";
import { mainHead, toolDetail, toolVerbs } from "@nyte-ai/plugin/client/presentation";
import type { ToolStatus } from "@nyte-ai/plugin/client/presentation";
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

export function sessionStatus(session: SessionInfo, unread: boolean): SubagentStatus {
  const execution = mainHead(session)?.execution;

  if (execution === undefined) return { indicator: "done", text: "" };

  switch (execution.kind) {
    case "live":
      return PLANNING;
    case "waiting":
      return execution.on.kind === "part"
        ? { indicator: "attention", text: "Needs attention" }
        : PLANNING;
    case "retrying":
      return { indicator: "running", text: "Retrying" };
    case "idle": {
      const end = execution.lastRun?.end;

      if (end === undefined || end.kind === "completed")
        return {
          indicator: unread ? "unread" : "done",
          text: end === undefined ? "" : "Completed",
        };

      return end.kind === "failed"
        ? { indicator: "failed", text: "Stopped with error" }
        : { indicator: "failed", text: "Stopped" };
    }

    default: {
      const _exhaustive: never = execution;

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
