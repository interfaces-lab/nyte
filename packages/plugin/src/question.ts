import { SdkError, definePart, dev } from "@nyte-ai/core";
import type { ActionContext, ActionOutput, ToolDefinition } from "@nyte-ai/core";
import { standard } from "@nyte-ai/schema";
import type { Awaitable, Infer, Json, PartId, SessionView } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Plugin } from "./core.ts";

const state = standard(
  Type.Object({
    prompt: Type.String(),
    options: Type.Array(Type.String()),
    answer: Type.Union([Type.String(), Type.Null()]),
  }),
);

const actions = { answer: { input: standard(Type.Object({ choice: Type.String() })) } };

type Actions = typeof actions;

/**
 * Returns a question part's state: the prompt, the options offered, and the
 * user's answer, null until they give one.
 *
 * @category plugins
 * @since 0.1.0
 */
export type QuestionState = Infer<typeof state>;

const handlers: {
  readonly [A in keyof Actions]: (
    input: Infer<Actions[A]["input"]>,
    context: ActionContext<QuestionState, Actions>,
  ) => Awaitable<ActionOutput<Actions[A]>>;
} = {
  /** Keeps the first answer: the same choice again is accepted, so a re-run after a restart is safe; another is refused. */
  async answer(input, context) {
    let first = false;

    const outcome = await context.part.update((current) => {
      first = current.answer === null || current.answer === input.choice;

      return first ? { ...current, answer: input.choice } : current;
    });

    if (outcome.kind !== "updated")
      throw new Error(`The question could not be answered: ${outcome.kind}.`);

    if (!first) throw new SdkError("invalid", "This question was already answered.");
  },
};

/**
 * The modal a question puts in front of the user: the prompt, the options
 * offered, and the one action that answers with a choice, which the state
 * keeps so every client sees the question answered. A client without a
 * renderer draws the fallback; the model reads it too.
 *
 * @category plugins
 * @since 0.1.0
 */
export const question = definePart({
  kind: "ask/question",
  state,
  actions,
  fallback: (current, { id }) =>
    `Question ${id}: ${current.prompt} (${current.options.join(" / ")})${current.answer === null ? "" : ` Answered: ${current.answer}`}`,
  onAction: (action, input, context) => handlers[action](input, context),
});

/**
 * One question still waiting for the user, with the part its answer goes to.
 *
 * @category plugins
 * @since 0.1.0
 */
export interface OpenQuestion {
  readonly part: PartId;
  readonly prompt: string;
  readonly options: readonly string[];
}

/**
 * Returns the questions still waiting for the user, oldest first: live
 * `ask/question` parts with no answer. A question its run stopped or failed
 * is no longer live, and a view not loaded yet has none. Clients draw them
 * as they like; this decides which.
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

    if (checked instanceof Promise || checked.issues !== undefined || checked.value.answer !== null)
      return [];

    return [{ part: part.id, prompt: checked.value.prompt, options: checked.value.options }];
  });
}

const parameters = standard(
  Type.Object({
    prompt: Type.String({ minLength: 1, description: "The question to ask the user." }),
    options: Type.Array(Type.String({ minLength: 1 }), {
      minItems: 1,
      description: "Short, distinct choices. The user may answer in their own words.",
    }),
  }),
);

/**
 * Asks the user and parks the run on the answer. The part is an acquisition
 * of the call, so the re-run after the answer finds the same part and its
 * wait resolves at once with the durable answer (§42x, §42z). It belongs to
 * the call's run, so stopping the run fails it and no client asks it again.
 */
const ask: ToolDefinition<{ prompt: string; options: string[] }> = {
  name: "question",
  description:
    "Ask the user a question and wait for their answer. Use it for a decision you cannot make yourself.",
  parameters,
  class: (args) => ({ kind: "custom", label: args.prompt }),
  replay: "safe",
  async execute(args, invocation) {
    const part = await invocation.session.parts.create(question, {
      state: { ...args, answer: null },
      placement: { kind: "modal" },
    });

    dev("question", "asked", { call: invocation.call, part: part.id });
    const outcome = await invocation.wait({ kind: "part", part: part.id });
    const choice = outcome.kind === "part" ? choiceOf(outcome.answer) : null;

    return {
      content: [
        {
          kind: "text",
          text:
            choice ??
            "The user did not answer. Continue with your best judgment and say what you assumed.",
        },
      ],
      parts: [part.id],
    };
  },
};

/** Returns the choice an `answer` action carried, or null for a dismissal. */
function choiceOf(answer: { readonly action: string; readonly input: Json } | null): string | null {
  if (answer?.action !== "answer") return null;
  const { input } = answer;

  return typeof input === "object" &&
    input !== null &&
    "choice" in input &&
    typeof input.choice === "string"
    ? input.choice
    : null;
}

/**
 * Lets the model ask the user: the `question` tool creates an `ask/question`
 * modal and waits on it durably, so the answer survives a restart and may
 * come from any client.
 *
 * @category plugins
 * @since 0.1.0
 */
export default {
  id: "question",
  contribute: { parts: [question], tools: [ask] },
} satisfies Plugin;
