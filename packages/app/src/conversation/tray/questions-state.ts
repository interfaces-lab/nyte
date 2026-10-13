import type { OpenQuestion } from "@nyte-ai/plugin/question";
import type { SessionId } from "@nyte-ai/sdk";
import { mutationOptions } from "@tanstack/react-query";
import { connection } from "../../sdk.tsx";

/** Answers a question with a choice, offered or in the user's own words, through its part's action. */
export async function answerQuestion(
  sessionId: SessionId,
  question: OpenQuestion,
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
  readonly question: OpenQuestion;
}) {
  return mutationOptions({
    mutationKey: ["question", input.sessionId, input.question.part],
    retry: false,
    mutationFn: (choice: string) => answerQuestion(input.sessionId, input.question, choice),
  });
}
