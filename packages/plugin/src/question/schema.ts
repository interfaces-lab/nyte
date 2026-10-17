import type { PartDefinition } from "@nyte-ai/core";
import { standard } from "@nyte-ai/schema";
import type { Infer, PartId, SessionView } from "@nyte-ai/schema";
import { Type } from "typebox";

const infoSchema = Type.Object({
  question: Type.String({ minLength: 1, pattern: "\\S", description: "The question to ask." }),
  header: Type.String({
    minLength: 1,
    maxLength: 30,
    pattern: "\\S",
    description: "A short label for this question.",
  }),
  options: Type.Array(
    Type.Object({
      label: Type.String({ minLength: 1, pattern: "\\S" }),
      description: Type.String({ description: "Explain what this choice means." }),
    }),
    { description: "Distinct choices. The user may answer in their own words." },
  ),
  multiple: Type.Optional(
    Type.Boolean({ description: "Allow more than one choice. Defaults to false." }),
  ),
});

const info = standard(infoSchema);

const questions = Type.Array(infoSchema, { minItems: 1 });

const answers = Type.Array(Type.Array(Type.String({ minLength: 1 })), {
  minItems: 1,
});

export const answerInput = standard(Type.Object({ answers }));

export const questionOutput = standard(
  Type.Object({ answers: Type.Union([answers, Type.Null()]) }),
);

const state = standard(Type.Object({ questions, answers: Type.Union([answers, Type.Null()]) }));

export const questionParameters = standard(Type.Object({ questions }));

const actions = { answer: { input: answerInput } };

/** A question, its described choices, and whether the user may select several. */
export type QuestionInfo = Infer<typeof info>;

/** One answer list per question, in request order. An empty list leaves a question unanswered. */
export type QuestionAnswers = Infer<typeof answerInput>["answers"];

/** A grouped question request and its first complete answer, null while waiting. */
export type QuestionState = Infer<typeof state>;

/**
 * A grouped modal request. Its answer action submits all questions at once,
 * preserving the first complete answer across retries and restarts.
 *
 * @category plugins
 * @since 0.1.0
 */
export const question = {
  kind: "ask/question",
  state,
  actions,
  fallback: (current, { id }) =>
    `Questions ${id}:\n${current.questions
      .map(
        (item, index) =>
          `${item.header}: ${item.question}\n${item.options
            .map((option) => `${option.label}: ${option.description}`)
            .join(
              "\n",
            )}${current.answers === null ? "" : `\nAnswered: ${current.answers[index].join(", ") || "Unanswered"}`}`,
      )
      .join("\n\n")}`,
} satisfies PartDefinition<QuestionState, typeof actions>;

/** A grouped request still waiting for the user, with the part its submission goes to. */
export type OpenQuestion = Pick<QuestionState, "questions"> & { readonly part: PartId };

/**
 * Returns unanswered live question requests, oldest first. Requests from a
 * stopped or failed run and parts with invalid state are omitted.
 *
 * @category plugins
 * @since 0.1.0
 */
export function openQuestions(
  view: Pick<SessionView, "parts"> | undefined,
): readonly OpenQuestion[] {
  return (view?.parts ?? []).flatMap((part) => {
    if (part.partKind !== question.kind || part.status.kind !== "live") return [];
    const checked = question.state["~standard"].validate(part.state);

    if (
      checked instanceof Promise ||
      checked.issues !== undefined ||
      checked.value.answers !== null
    )
      return [];

    return [{ part: part.id, questions: checked.value.questions }];
  });
}
