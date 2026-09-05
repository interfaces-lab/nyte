/**
 * Example question tool over durable suspension. The model calls `question`;
 * the call parks the run (design record, "Suspension and wake") and the
 * pending tool call itself is what a client renders: the `effect` event with
 * state `waiting` carries the call id, and its arguments carry the question
 * and the options. The user answers through the reply channel
 * (`runs.reply({ callId, reply })`), which targets this call directly;
 * conversation messages are never involved, so an unrelated steer can never
 * be mistaken for an answer.
 *
 * A reply that names an option (its number or its label) selects it; any
 * other reply is the user's own answer, so a human is never trapped in the
 * answers the model imagined.
 *
 * Based on https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/question.ts
 * The own-answer rule follows https://github.com/anomalyco/opencode/blob/e70d667a9fe3e84cc071a5596aa522c142c525b7/packages/core/src/tool/plugin/question.ts
 */
import { definePlugin, ToolWait } from "@nyte-ai/plugin";
import type { AgentTool, ToolWakeOutcome } from "@nyte-ai/plugin";
import type { JsonValue } from "@nyte-ai/schema";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

const questionOption = Type.Object(
  {
    label: Type.String({ minLength: 1, description: "Display label for the option" }),
    description: Type.Optional(Type.String({ description: "Extra detail shown under the label" })),
  },
  { additionalProperties: false },
);

export const questionParameters = Type.Object(
  {
    question: Type.String({ minLength: 1, description: "The question to ask the user" }),
    options: Type.Array(questionOption, {
      minItems: 1,
      description: "Choices the user can select",
    }),
  },
  { additionalProperties: false },
);

export type QuestionInput = Static<typeof questionParameters>;

/** What a client can show beside the settled call: the question, and the answer when one was given. */
export interface QuestionDetails {
  readonly question: string;
  readonly answer?: string;
}

/**
 * The intent's arguments were validated against `questionParameters` before
 * the call parked; a wake re-derives the typed view through the same schema.
 */
function parseQuestionInput(args: JsonValue): QuestionInput {
  if (!Value.Check(questionParameters, args)) {
    throw new Error("Question arguments do not match the question schema");
  }
  return args;
}

function isReplyText(reply: JsonValue): reply is string {
  return typeof reply === "string";
}

/** A reply names an option by 1-based number or exact label; anything else is its own answer. */
export function answerFor(input: QuestionInput, reply: string): string {
  const trimmed = reply.trim();
  const index = Number(trimmed);
  if (Number.isInteger(index) && index >= 1 && index <= input.options.length) {
    const selected = input.options[index - 1];
    if (selected !== undefined) return selected.label;
  }
  const lowered = trimmed.toLowerCase();
  const byLabel = input.options.find((option) => option.label.toLowerCase() === lowered);
  return byLabel?.label ?? trimmed;
}

function unanswered(input: QuestionInput): ToolWakeOutcome {
  // An empty or malformed reply is a human walking away, not an answer.
  return {
    kind: "settle",
    isError: true,
    result: {
      content: [{ type: "text", text: "Question was left unanswered" }],
      details: { question: input.question },
      title: input.question,
    },
  };
}

function answered(input: QuestionInput, answer: string): ToolWakeOutcome {
  return {
    kind: "settle",
    result: {
      content: [{ type: "text", text: answer }],
      details: { question: input.question, answer },
      title: input.question,
    },
  };
}

export const questionTool: AgentTool<typeof questionParameters, QuestionDetails> = {
  name: "question",
  description:
    "Ask the user one question and let them choose from a list of answers. " +
    "The user may also answer in their own words; you receive whichever they gave.",
  parameters: questionParameters,
  replay: "never",
  execute: async () => {
    throw new ToolWait();
  },
  wake: async (waiting, context) => {
    const input = parseQuestionInput(waiting.args);
    if (context.reply === undefined) return { kind: "wait" };
    const answer = isReplyText(context.reply) ? answerFor(input, context.reply) : "";
    return answer === "" ? unanswered(input) : answered(input, answer);
  },
};

export const questionPlugin = definePlugin({
  id: "question",
  session(api) {
    api.tools.add((draft) => draft.set(questionTool.name, questionTool));
  },
});

export default questionPlugin;
