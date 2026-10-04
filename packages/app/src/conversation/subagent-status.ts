import { toolStatus } from "@nyte-ai/client";
import type { ToolStatus } from "@nyte-ai/client";
import type { SessionInfo, TurnToolClass } from "@nyte-ai/protocol";
import type { SessionFrame } from "../live.ts";
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
  const run = session.heads[0]?.run;

  if (run === undefined) return { indicator: "done", text: "" };
  const phase = run.phase;

  switch (phase.kind) {
    case "respond":
    case "tools":
      return PLANNING;
    // Parked on its own background work, the child is still working.
    case "waiting":
      return run.awaitingReply === true
        ? { indicator: "attention", text: "Needs attention" }
        : PLANNING;
    case "retry":
      return { indicator: "running", text: "Retrying" };
    case "done":
      return { indicator: unread ? "unread" : "done", text: "Completed" };
    case "failed":
      return { indicator: "failed", text: "Stopped with error" };
    case "aborted":
      return { indicator: "failed", text: "Stopped" };
    default: {
      const _exhaustive: never = phase;

      return _exhaustive;
    }
  }
}

type DelegateRole = Extract<TurnToolClass, { readonly kind: "delegate" }>["role"];

export const DELEGATE_VERBS: Readonly<Record<DelegateRole, ToolVerbs>> = {
  create: { running: "Creating", past: "Created" },
  send: { running: "Messaging", past: "Messaged" },
  read: { running: "Reading transcript", past: "Read transcript" },
  stop: { running: "Stopping", past: "Stopped" },
};

/** The noun a verbless line adds after the agent it names: "review agent message · Blocked". */
export const DELEGATE_NOUNS: Readonly<Record<DelegateRole, string>> = {
  create: "agent",
  send: "message",
  read: "transcript",
  stop: "stop",
};

function delegateDetail(toolClass: Extract<TurnToolClass, { readonly kind: "delegate" }>): string {
  return toolClass.role === "create" ? toolClass.title : "subagent";
}

/** What a running child is doing now: its unsettled call, else what it streams. */
export function subagentActivity(
  frame: SessionFrame | undefined,
  cwd: string | undefined,
): string | undefined {
  const turn = frame?.snapshot.transcript.findLast((entry) => entry.kind === "turn");

  const call =
    turn?.kind === "turn"
      ? turn.parts.findLast(
          (part) => part.kind === "tool" && toolStatus(part.state).tense === "running",
        )
      : undefined;

  if (call?.kind === "tool") {
    const verb =
      call.class.kind === "delegate"
        ? DELEGATE_VERBS[call.class.role].running
        : toolVerbs(call.class).running;

    const detail =
      call.class.kind === "delegate"
        ? delegateDetail(call.class)
        : toolDetail(call.class, cwd)?.text;

    return detail === undefined ? verb : `${verb} ${detail}`;
  }

  const streaming = frame?.live.order.at(-1)?.kind;

  if (streaming === "thinking") return "Thinking";

  return streaming === "text" ? "Writing a response" : undefined;
}
