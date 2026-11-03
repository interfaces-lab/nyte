import { definePart, dev } from "@nyte-ai/core";
import type { ActionContext, ActionOutput, Part, ToolDefinition } from "@nyte-ai/core";
import { asId, SdkError } from "@nyte-ai/schema";
import type { Awaitable, HeadName, Infer } from "@nyte-ai/schema";
import {
  QUESTION_TOOL,
  answerInput,
  question as questionContract,
  questionParameters,
} from "./schema.ts";
import type { QuestionAnswers, QuestionInfo, QuestionPhase, QuestionState } from "./schema.ts";
import type { Plugin } from "@nyte-ai/plugin/core";

const WAIT_MS = 60_000;

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

/** The answers for the model, one question a line, or as a one-line label under their headers. */
function formatAnswers(
  items: readonly QuestionInfo[],
  answers: QuestionAnswers,
  form: "prompt" | "label",
): string {
  return items
    .map(
      (item, index) =>
        `${form === "prompt" ? item.question : item.header}: ${answers[index].join(", ") || "Unanswered"}`,
    )
    .join(form === "prompt" ? "\n" : " · ");
}

/**
 * A late answer goes to its head as an attached answer, under a receipt fixed by the part: it
 * rides into a live run at its next boundary or continues an idle head, never opening a turn as a
 * prompt, and a retried or repeated submission replays it instead of landing twice.
 */
const handlers: Handlers = {
  async answer(input, context) {
    let answered:
      | { readonly asked: QuestionState["questions"]; readonly phase: QuestionPhase }
      | undefined;

    const outcome = await context.part.update((current) => {
      const normalized = normalizeAnswers(current.questions, input.answers);
      const phase = current.phase;

      if (phase.kind === "skipped") throw new SdkError("invalid", "These questions were skipped.");

      if (phase.kind === "answered") {
        if (JSON.stringify(phase.answers) !== JSON.stringify(normalized))
          throw new SdkError("invalid", "These questions were already answered.");
        answered = { asked: current.questions, phase };

        return current;
      }

      const next: QuestionPhase = {
        kind: "answered",
        answers: normalized,
        head: phase.kind === "open" ? phase.head : null,
      };

      answered = { asked: current.questions, phase: next };

      return { ...current, phase: next };
    });

    if (outcome.kind !== "updated")
      throw new Error(`The questions could not be answered: ${outcome.kind}.`);

    if (answered?.phase.kind !== "answered" || answered.phase.head === null) return;

    await context.api.sdk
      .session(context.session)
      .head(answered.phase.head)
      .send(
        `The user answered your earlier question:\n${formatAnswers(answered.asked, answered.phase.answers, "prompt")}`,
        {
          delivery: "attach",
          source: {
            kind: "answer",
            part: context.part.id,
            label: formatAnswers(answered.asked, answered.phase.answers, "label"),
          },
          id: asId<"receipt">(`question:${context.part.id}`),
        },
      );
  },
  async skip(_, context) {
    const outcome = await context.part.update((current) => {
      const phase = current.phase;

      if (phase.kind === "answered")
        throw new SdkError("invalid", "These questions were already answered.");

      if (phase.kind === "skipped") return current;

      return { ...current, phase: { kind: "skipped", late: phase.kind === "open" } };
    });

    if (outcome.kind !== "updated")
      throw new Error(`The questions could not be skipped: ${outcome.kind}.`);
  },
};

export const question = definePart({
  ...questionContract,
  onAction: (action, input, context) => handlers[action](input, context),
});

const ask: ToolDefinition<Infer<typeof questionParameters>> = {
  name: QUESTION_TOOL,
  description:
    "Ask the user one or more questions and wait up to a minute for their answers. Give each option a short label and a description. Use multiple when several choices may apply. The user can also write their own answer. If they don't answer in time, keep working; their answer arrives later as a message.",
  parameters: questionParameters,
  class: (args) => ({
    kind: "custom",
    label: args.questions.map((item) => item.header).join(", "),
  }),
  effects: "none",
  approval: "never",
  replay: "safe",
  async execute(args, invocation) {
    for (const item of args.questions) {
      if (new Set(item.options.map((option) => option.label.trim())).size !== item.options.length)
        throw new SdkError("invalid", "Question option labels must be distinct.");
    }

    const part = await invocation.session.parts.create(question, {
      state: { call: invocation.call, questions: args.questions, phase: { kind: "asking" } },
      placement: { kind: "modal" },
    });

    dev("question", "asked", { call: invocation.call, part: part.id });

    const outcome = await invocation.wait({
      kind: "part",
      part: part.id,
      deadline: invocation.now() + WAIT_MS,
    });

    const checked =
      outcome.kind === "part" && outcome.answer?.action === "answer"
        ? await answerInput["~standard"].validate(outcome.answer.input)
        : undefined;

    const deadline = outcome.kind === "deadline" ? await stopWaiting(part, invocation.head) : null;

    const reply =
      deadline?.kind === "answered" && deadline.head === null
        ? deadline.answers
        : checked !== undefined && checked.issues === undefined
          ? normalizeAnswers(args.questions, checked.value.answers)
          : null;

    const unanswered =
      deadline?.kind === "open"
        ? "No answer yet. The question stays open, and the user's answer will arrive as a message."
        : "The user did not answer.";

    return {
      content: [
        {
          kind: "text",
          text:
            reply === null
              ? `${unanswered} Continue with your best judgment and say what you assumed.`
              : formatAnswers(args.questions, reply, "prompt"),
        },
      ],
      parts: [part.id],
    };
  },
};

/**
 * Stops waiting on a request the user hasn't touched, so a later answer goes to `head` as a
 * message, and returns where the request stands. A replay finds it already open and keeps it so.
 */
async function stopWaiting(part: Part<typeof question>, head: HeadName): Promise<QuestionPhase> {
  let phase: QuestionPhase = { kind: "open", head };

  await part.update((current) => {
    phase = current.phase.kind === "asking" ? { kind: "open", head } : current.phase;

    return { ...current, phase };
  });

  return phase;
}

/**
 * Contributes the question tool and its grouped modal. The durable wait
 * resumes after one complete submission or a skip from any client, or after
 * a minute; an answer after that reaches the asking head as a message.
 *
 * @category plugins
 * @since 0.1.0
 */
export default {
  id: "question",
  contribute: { parts: [question], tools: [ask] },
} satisfies Plugin;
