import { SdkError, definePart, dev } from "@nyte-ai/core";
import type { ActionContext, ActionOutput, ToolDefinition } from "@nyte-ai/core";
import type { Awaitable, Infer } from "@nyte-ai/schema";
import {
  answerInput,
  question as questionContract,
  questionParameters,
  questionOutput,
} from "./schema.ts";
import type { QuestionAnswers, QuestionInfo, QuestionState } from "./schema.ts";
import type { Plugin } from "@nyte-ai/plugin/core";

type Actions = typeof questionContract.actions;

type Handlers = {
  readonly [A in keyof Actions]: (
    input: Infer<Actions[A]["input"]>,
    context: ActionContext<QuestionState, Actions>,
  ) => Awaitable<ActionOutput<Actions[A]>>;
};

function normalizeAnswers(
  items: readonly QuestionInfo[],
  supplied: QuestionAnswers,
): QuestionAnswers {
  if (supplied.length !== items.length)
    throw new SdkError("invalid", "Submit one answer list for each question.");

  return items.map((item, index) => {
    const selected = supplied[index].map((answer) => answer.trim());

    if (selected.some((answer) => answer === ""))
      throw new SdkError("invalid", "Answers cannot be blank.");

    if (!item.multiple && selected.length > 1)
      throw new SdkError("invalid", "This question accepts one answer.");

    if (new Set(selected).size !== selected.length)
      throw new SdkError("invalid", "Choose each answer only once.");

    return item.multiple ? selected.toSorted() : selected;
  });
}

const handlers: Handlers = {
  async answer(input, context) {
    let accepted = false;

    const outcome = await context.part.update((current) => {
      const normalized = normalizeAnswers(current.questions, input.answers);
      accepted =
        current.answers === null || JSON.stringify(current.answers) === JSON.stringify(normalized);

      return current.answers === null ? { ...current, answers: normalized } : current;
    });

    if (outcome.kind !== "updated")
      throw new Error(`The questions could not be answered: ${outcome.kind}.`);

    if (!accepted) throw new SdkError("invalid", "These questions were already answered.");
  },
};

export const question = definePart({
  ...questionContract,
  onAction: (action, input, context) => handlers[action](input, context),
});

const ask: ToolDefinition<Infer<typeof questionParameters>, Infer<typeof questionOutput>> = {
  name: "question",
  description:
    "Ask the user one or more questions and wait for their answers. Give each option a short label and a description. Use multiple when several choices may apply. The user can also write their own answer.",
  parameters: questionParameters,
  output: questionOutput,
  class: (args) => ({
    kind: "custom",
    label: args.questions.map((item) => item.header).join(", "),
  }),
  replay: "safe",
  async execute(args, invocation) {
    for (const item of args.questions) {
      if (new Set(item.options.map((option) => option.label.trim())).size !== item.options.length)
        throw new SdkError("invalid", "Question option labels must be distinct.");
    }

    const part = await invocation.session.parts.create(question, {
      state: { ...args, answers: null },
      placement: { kind: "modal" },
    });

    dev("question", "asked", { call: invocation.call, part: part.id });
    const outcome = await invocation.wait({ kind: "part", part: part.id });

    const checked =
      outcome.kind === "part" && outcome.answer?.action === "answer"
        ? await answerInput["~standard"].validate(outcome.answer.input)
        : undefined;

    const reply =
      checked !== undefined && checked.issues === undefined
        ? normalizeAnswers(args.questions, checked.value.answers)
        : null;

    return {
      content: [
        {
          kind: "text",
          text:
            reply === null
              ? "The user did not answer. Continue with your best judgment and say what you assumed."
              : args.questions
                  .map(
                    (item, index) => `${item.question}: ${reply[index].join(", ") || "Unanswered"}`,
                  )
                  .join("\n"),
        },
      ],
      output: { answers: reply },
      parts: [part.id],
    };
  },
};

/**
 * Contributes the question tool and its grouped modal. The durable wait
 * resumes after one complete submission from any client.
 *
 * @category plugins
 * @since 0.1.0
 */
export default {
  id: "question",
  contribute: { parts: [question], tools: [ask] },
} satisfies Plugin;
