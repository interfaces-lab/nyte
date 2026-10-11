import { question } from "@nyte-ai/plugin/question";
import { SessionIdSchema } from "@nyte-ai/schema";
import type {
  Execution,
  PartId,
  PartStatus,
  RunView,
  SessionId,
  SessionInfo,
  SessionView,
  ToolPartState,
} from "@nyte-ai/sdk";

/** How a list row reads a session at a glance, from its main head's execution. */
export type SessionMark = "waiting" | "retry" | "working" | "failed" | "idle";

/** Returns the head a list row reports on: main, else the first. */
function mainHead(session: SessionInfo) {
  return session.heads.find((head) => head.name === "main") ?? session.heads[0];
}

/**
 * Returns the mark of an execution: a wait on a part is a question for the
 * user, a wait on a child, job or timer is still work, and an idle head whose
 * last run failed reads failed.
 */
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

/** Returns a directory row's mark from its main head. */
export function sessionMark(session: SessionInfo): SessionMark {
  return executionMark(mainHead(session)?.execution);
}

/** Returns the run the main head is working on, or undefined while it is idle. */
export function liveRun(session: SessionInfo): RunView | undefined {
  const execution = mainHead(session)?.execution;

  return execution === undefined || execution.kind === "idle" ? undefined : execution.run;
}

/** Returns whether the main head has ever run, so a row can say New rather than Finished. */
export function hasRun(session: SessionInfo): boolean {
  const execution = mainHead(session)?.execution;

  return execution !== undefined && (execution.kind !== "idle" || execution.lastRun !== null);
}

/** Returns a route parameter as a session id, or undefined when it is not one. */
export function sessionIdOf(raw: string | undefined): SessionId | undefined {
  const result = SessionIdSchema["~standard"].validate(raw);

  return result instanceof Promise || result.issues !== undefined ? undefined : result.value;
}

/** Whether a tool row's title takes a present verb, a past one, or none. */
export type ToolTense = "running" | "past" | "none";

/** How a tool row is tinted and which symbol it shows. */
export type ToolTone = "running" | "attention" | "success" | "failure" | "stopped";

/** How a tool row reads: its verb's tense, its tone, and the word after its title. */
export interface ToolStatus {
  readonly tense: ToolTense;
  readonly tone: ToolTone;
  readonly word: string | undefined;
}

/**
 * Returns the one reading of a tool part every row draws. A verb appears only
 * when it is true: present while the call runs, past once it settled ok,
 * none otherwise, when the word says what happened ("pnpm test · Failed").
 * A failed status is the run's; a waiting status on a part is a question.
 */
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

/** A question the model asked and nobody answered yet: the part to act on, its prompt and its options. */
export type OpenQuestion = {
  readonly id: PartId;
  readonly prompt: string;
  readonly options: readonly string[];
};

/**
 * Returns the `ask/question` modal a head waits on, from `view.parts`: live,
 * with no answer recorded. A state the question schema rejects is skipped.
 */
export function openQuestion(view: SessionView): OpenQuestion | undefined {
  for (const part of view.parts) {
    if (part.partKind !== question.kind || part.status.kind !== "live") continue;

    if (part.status.answer !== undefined) continue;
    const checked = question.state["~standard"].validate(part.state);

    if (checked instanceof Promise || checked.issues !== undefined) continue;

    return { id: part.id, prompt: checked.value.prompt, options: checked.value.options };
  }

  return undefined;
}
