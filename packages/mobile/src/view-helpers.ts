import { openQuestions } from "@nyte-ai/plugin/question/schema";
import { PartIdSchema, SessionIdSchema } from "@nyte-ai/schema";
import type { Execution, PartId, RunView, SessionId, SessionInfo } from "@nyte-ai/sdk";
import type { HeadView } from "@nyte-ai/sdk/client";
import { executionMark, mainHead, sessionMark } from "@nyte-ai/plugin/client/presentation";
import type { TaskState } from "@nyte-ai/plugin/client/presentation";

export function liveRun(session: SessionInfo): RunView | undefined {
  const execution = mainHead(session)?.execution;

  return execution === undefined || execution.kind === "idle" ? undefined : execution.run;
}

/** The chat's mark as every surface shows it, `headAttention`'s from its row once the row is read; until then, its own run's. */
export function chatMark(
  info: SessionInfo | undefined,
  execution: Execution | undefined,
): TaskState {
  return info === undefined ? executionMark(execution) : sessionMark(info);
}

export function hasRun(session: SessionInfo): boolean {
  const execution = mainHead(session)?.execution;

  return execution !== undefined && (execution.kind !== "idle" || execution.lastRun !== null);
}

export function parseSessionId(raw: string | undefined): SessionId | undefined {
  const result = SessionIdSchema["~standard"].validate(raw);

  return result instanceof Promise || result.issues !== undefined ? undefined : result.value;
}

export function parsePartId(raw: string | undefined): PartId | undefined {
  const result = PartIdSchema["~standard"].validate(raw);

  return result instanceof Promise || result.issues !== undefined ? undefined : result.value;
}

export type OpenQuestion = ReturnType<typeof openQuestions>[number];

export function openQuestion(view: HeadView): OpenQuestion | undefined {
  return openQuestions(view)[0];
}

export type AskedQuestion = {
  session: SessionId;
  origin: string | undefined;
  question: OpenQuestion;
};
