import type { Message, SessionInfo, SessionView } from "@nyte-ai/sdk";
import {
  mainHead,
  showsTool,
  toolDetail,
  toolStatus,
  toolVerbs,
} from "@nyte-ai/plugin/client/presentation";
import type { ToolMessage, ToolStatus } from "@nyte-ai/plugin/client/presentation";
import { countWork } from "../work-counts.ts";

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

const runningTools = new WeakMap<Message, ToolMessage | null>();

/** The message as a running tool call, decided once per message: a view delta keeps the messages it did not change. */
function runningTool(message: Message): ToolMessage | null {
  const known = runningTools.get(message);

  if (known !== undefined) return known;
  const tool = showsTool(message) && toolStatus(message).tense === "running" ? message : null;
  runningTools.set(message, tool);

  return tool;
}

export function subagentActivity(
  view: SessionView | undefined,
  cwd: string | undefined,
): string | undefined {
  countWork("select:activity");
  const call = view?.messages.findLast((message) => runningTool(message) !== null);

  if (call !== undefined && showsTool(call)) {
    const toolClass = call.state.class;
    const verb = toolVerbs(toolClass).running;
    const detail = toolDetail(toolClass, cwd)?.text;

    return detail === undefined ? verb : `${verb} ${detail}`;
  }

  const streaming = view?.messages.findLast(
    (message) => message.kind === "part" && message.status.kind === "live",
  );

  if (streaming?.kind !== "part") return undefined;

  if (streaming.partKind === "thinking") return "Thinking";

  return streaming.partKind === "text" ? "Writing a response" : undefined;
}
