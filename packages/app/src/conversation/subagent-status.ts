import type { SessionInfo, SessionView, ToolClass } from "@nyte-ai/sdk";
import { isToolMessage, toolStatus } from "../view-helpers.ts";
import type { ToolStatus } from "../view-helpers.ts";
import { toolDetail, toolVerbs } from "./tool-copy.ts";
import type { ToolVerbs } from "./tool-copy.ts";

export interface SubagentStatus {
  readonly indicator: "running" | "attention" | "failed" | "unread" | "done";
  /** Empty when there is nothing to add to the indicator. */
  readonly text: string;
}

const PLANNING: SubagentStatus = { indicator: "running", text: "Planning next moves" };

/** The create call speaks for a child until the parent lists it. */
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
  const execution = session.heads[0]?.execution;

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

export type DelegateClass = Extract<ToolClass, { readonly kind: "delegate" }>;

type DelegateRole = DelegateClass["role"];

export const DELEGATE_VERBS: Readonly<Record<DelegateRole, ToolVerbs>> = {
  task: { running: "Delegating", past: "Delegated" },
  create: { running: "Creating", past: "Created" },
  send: { running: "Messaging", past: "Messaged" },
  await: { running: "Waiting on", past: "Waited on" },
  read: { running: "Reading transcript", past: "Read transcript" },
  stop: { running: "Stopping", past: "Stopped" },
};

/** The noun a verbless line adds after the agent it names: "review agent message · Blocked". */
export const DELEGATE_NOUNS: Readonly<Record<DelegateRole, string>> = {
  task: "agent",
  create: "agent",
  send: "message",
  await: "wait",
  read: "transcript",
  stop: "stop",
};

function delegateDetail(toolClass: DelegateClass): string {
  return toolClass.title ?? "subagent";
}

/** What a running child is doing now: its unsettled call, else what it streams. */
export function subagentActivity(
  view: SessionView | undefined,
  cwd: string | undefined,
): string | undefined {
  const call = view?.messages.findLast(
    (message) => isToolMessage(message) && toolStatus(message).tense === "running",
  );

  if (call !== undefined && isToolMessage(call)) {
    const toolClass = call.state.class;
    const verb =
      toolClass.kind === "delegate"
        ? DELEGATE_VERBS[toolClass.role].running
        : toolVerbs(toolClass).running;

    const detail =
      toolClass.kind === "delegate" ? delegateDetail(toolClass) : toolDetail(toolClass, cwd)?.text;

    return detail === undefined ? verb : `${verb} ${detail}`;
  }

  const streaming = view?.messages.findLast(
    (message) => message.kind === "part" && message.status.kind === "live",
  );

  if (streaming?.kind !== "part") return undefined;

  if (streaming.partKind === "thinking") return "Thinking";

  return streaming.partKind === "text" ? "Writing a response" : undefined;
}
