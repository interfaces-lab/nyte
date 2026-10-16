import { openQuestions } from "@nyte-ai/plugin/question/schema";
import { SessionIdSchema } from "@nyte-ai/schema";
import type {
  Execution,
  PartStatus,
  RunView,
  SessionId,
  SessionInfo,
  SessionView,
  ToolPartState,
} from "@nyte-ai/sdk";

export type SessionMark = "waiting" | "retry" | "working" | "failed" | "idle";

function mainHead(session: SessionInfo) {
  return session.heads.find((head) => head.name === "main") ?? session.heads[0];
}

export function executionMark(execution: Execution | undefined): SessionMark {
  switch (execution?.kind) {
    case undefined:
      return "idle";
    case "live":
      return "working";
    case "retrying":
      return "retry";
    case "waiting":
      return execution.on.kind === "part" ? "waiting" : "working";
    case "idle":
      return execution.lastRun?.end.kind === "failed" ? "failed" : "idle";
    default: {
      const exhaustive: never = execution;

      return exhaustive;
    }
  }
}

export function sessionMark(session: SessionInfo): SessionMark {
  return executionMark(mainHead(session)?.execution);
}

export function liveRun(session: SessionInfo): RunView | undefined {
  const execution = mainHead(session)?.execution;

  return execution === undefined || execution.kind === "idle" ? undefined : execution.run;
}

export function hasRun(session: SessionInfo): boolean {
  const execution = mainHead(session)?.execution;

  return execution !== undefined && (execution.kind !== "idle" || execution.lastRun !== null);
}

export function sessionIdOf(raw: string | undefined): SessionId | undefined {
  const result = SessionIdSchema["~standard"].validate(raw);

  return result instanceof Promise || result.issues !== undefined ? undefined : result.value;
}

export type ToolTense = "running" | "past" | "none";

export type ToolTone = "running" | "attention" | "success" | "failure" | "stopped";

export interface ToolStatus {
  readonly tense: ToolTense;
  readonly tone: ToolTone;
  readonly word: string | undefined;
}

export function toolStatus(state: ToolPartState, status: PartStatus): ToolStatus {
  if (status.kind === "failed")
    return status.failure.class === "aborted"
      ? { tense: "none", tone: "stopped", word: "Stopped" }
      : { tense: "none", tone: "failure", word: "Failed" };

  if (state.phase !== "settled")
    return status.kind === "waiting" && status.on.kind === "part"
      ? { tense: "running", tone: "attention", word: "Needs input" }
      : { tense: "running", tone: "running", word: undefined };

  switch (state.outcome.kind) {
    case "ok":
      return { tense: "past", tone: "success", word: undefined };
    case "failed":
      return { tense: "none", tone: "failure", word: "Failed" };
    case "rejected":
      return { tense: "none", tone: "failure", word: "Blocked" };
    case "interrupted":
      return { tense: "none", tone: "stopped", word: "Interrupted" };
    case "stopped":
      return { tense: "none", tone: "stopped", word: "Stopped" };
    default: {
      const exhaustive: never = state.outcome;

      return exhaustive;
    }
  }
}

export type OpenQuestion = ReturnType<typeof openQuestions>[number];

export function openQuestion(view: SessionView): OpenQuestion | undefined {
  return openQuestions(view)[0];
}
