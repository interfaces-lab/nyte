import { Type } from "typebox";
import { Value } from "typebox/value";
import type { PartId, SessionId, SessionView } from "@nyte-ai/sdk";
import { mutationOptions } from "@tanstack/react-query";
import { connection } from "../../sdk.tsx";

/** A question a run is parked on: the prompt, the options offered, and the part that takes the answer. */
export interface WaitingQuestion {
  readonly part: PartId;
  readonly prompt: string;
  readonly options: readonly string[];
}

const QuestionState = Type.Object({ prompt: Type.String(), options: Type.Array(Type.String()) });

/** The `ask/question` parts a view carries that nobody has answered yet, in the view's order. */
export function waitingQuestions(
  view: Pick<SessionView, "parts"> | undefined,
): readonly WaitingQuestion[] {
  return (view?.parts ?? []).flatMap((part) =>
    part.partKind === "ask/question" &&
    (part.status.kind === "live" || part.status.kind === "waiting") &&
    Value.Check(QuestionState, part.state)
      ? [{ part: part.id, prompt: part.state.prompt, options: part.state.options }]
      : [],
  );
}

/** Answers a question with a choice, offered or in the user's own words, through its part's action. */
export async function answerQuestion(
  sessionId: SessionId,
  question: WaitingQuestion,
  choice: string,
): Promise<void> {
  const outcome = await connection()
    .session(sessionId)
    .part(question.part)
    .act("answer", { choice: choice.trim() });

  if (outcome.kind !== "ok") throw new Error("This question is no longer waiting.");
}

/** One answer per question; the card draws the outcome. */
export function questionAnswerOptions(input: {
  readonly sessionId: SessionId;
  readonly question: WaitingQuestion;
}) {
  return mutationOptions({
    mutationKey: ["question", input.sessionId, input.question.part],
    retry: false,
    mutationFn: (choice: string) => answerQuestion(input.sessionId, input.question, choice),
  });
}
