import type { PartDefinition } from "@nyte-ai/core";
import { idSchema, isJsonObject, standard } from "@nyte-ai/schema";
import type { CallId, Infer, PartId, PartView, SessionView } from "@nyte-ai/schema";
import { Type } from "typebox";

/** The question tool's name, which clients match to draw its calls. */
export const QUESTION_TOOL = "question";

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

const skipInput = standard(Type.Object({}));

const phase = Type.Union([
  Type.Object({ kind: Type.Literal("asking") }),
  Type.Object({ kind: Type.Literal("open"), head: idSchema<"head">() }),
  Type.Object({
    kind: Type.Literal("answered"),
    answers,
    head: Type.Union([idSchema<"head">(), Type.Null()]),
  }),
  Type.Object({ kind: Type.Literal("skipped"), late: Type.Boolean() }),
]);

const state = standard(Type.Object({ call: idSchema<"call">(), questions, phase }));

export const questionParameters = standard(Type.Object({ questions }));

const actions = { answer: { input: answerInput }, skip: { input: skipInput } };

/** A question, its described choices, and whether the user may select several. */
export type QuestionInfo = Infer<typeof info>;

/** One answer list per question, in request order. An empty list leaves a question unanswered. */
export type QuestionAnswers = Infer<typeof answerInput>["answers"];

/**
 * A grouped question request: the call that asked it, its questions, and where it stands.
 * `asking` while the call waits; `open` once the call stopped waiting and an answer goes to `head`
 * as a message. `answered` keeps that `head`, or null when the waiting call took the answer;
 * `skipped` says whether the user declined after the call stopped waiting.
 * A run that ends first shows on the part's status, not here.
 */
export type QuestionState = Infer<typeof state>;

export type QuestionPhase = QuestionState["phase"];

/**
 * A grouped modal request. `answer` submits all questions at once and `skip` declines them; the
 * first of either holds across retries and restarts.
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
            )}${current.phase.kind === "answered" ? `\nAnswered: ${current.phase.answers[index].join(", ") || "Unanswered"}` : ""}`,
      )
      .join("\n\n")}`,
} satisfies PartDefinition<QuestionState, typeof actions>;

/** A grouped request still waiting for the user, with the part its submission goes to. `late` once the asking call stopped waiting and the agent carried on. */
export type OpenQuestion = Pick<QuestionState, "questions"> & {
  readonly part: PartId;
  readonly late: boolean;
};

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
    const read = readQuestion(part);

    if (read === null || (read.phase.kind !== "asking" && read.phase.kind !== "open")) return [];

    return [{ part: part.id, questions: read.questions, late: read.phase.kind === "open" }];
  });
}

/**
 * The question part a call made, found by its `call` with one string comparison per part; the
 * caller validates only the match with {@link readQuestion}.
 *
 * @category plugins
 */
export function findQuestionPart(parts: readonly PartView[], call: CallId): PartView | undefined {
  return parts.find(
    (part) =>
      part.partKind === question.kind && isJsonObject(part.state) && part.state.call === call,
  );
}

/**
 * A question part's state, or null when it doesn't parse.
 *
 * @category plugins
 */
export function readQuestion(part: PartView): QuestionState | null {
  const checked = question.state["~standard"].validate(part.state);

  return checked instanceof Promise || checked.issues !== undefined ? null : checked.value;
}
