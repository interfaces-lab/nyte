/**
 * The question tool over durable suspension. The model calls `question`;
 * the call parks the run (design record, "Wait and wake") with a `Selection`,
 * which is what every client renders: the question and its options travel
 * with the waiting effect, so a client that opens the session later, on any
 * host, answers from the snapshot alone. The user answers through the reply
 * channel (`runs.reply({ callId, waitId, reply })`), which targets that exact
 * parked generation; conversation messages are never involved, so an unrelated
 * steer or a stale panel can never be mistaken for an answer.
 *
 * A reply is a `SelectionReply` from a client, or a bare string from a script
 * naming a choice by id or label, or anything else as the user's own answer;
 * a human is never trapped in the answers the model imagined. A session
 * setting gives every question a deadline, after which the runner wakes the
 * call unanswered and the model carries on.
 *
 * Based on https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/question.ts
 * The own-answer rule follows https://github.com/anomalyco/opencode/blob/e70d667a9fe3e84cc071a5596aa522c142c525b7/packages/core/src/tool/plugin/question.ts
 */
import { acceptsSelectionReply, definePlugin, selectionReply, ToolWait } from "@nyte-ai/plugin";
import type { AgentTool, Choice, Selection, ToolWakeOutcome } from "@nyte-ai/plugin";
import type { JsonValue } from "@nyte-ai/schema";
import { Type, Unsafe, type Static } from "typebox";
import { Value } from "typebox/value";

export const QUESTION_TIMEOUT_SETTING_ID = "question-timeout";
const TIMEOUT_KEY = "timeout";

/** How long a question waits before the runner settles it unanswered. Ids are what storage holds. */
const TIMEOUTS: readonly { readonly id: string; readonly ms: number }[] = [
  { id: "30s", ms: 30_000 },
  { id: "2m", ms: 120_000 },
  { id: "10m", ms: 600_000 },
];

const questionOption = Type.Object(
  {
    label: Type.String({ minLength: 1, description: "Display label for the option" }),
    description: Type.Optional(Type.String({ description: "Extra detail shown under the label" })),
  },
  { additionalProperties: false },
);

type QuestionOption = Static<typeof questionOption>;

export const questionParameters = Type.Object(
  {
    question: Type.String({ minLength: 1, description: "The question to ask the user" }),
    // `minItems: 1` is the tuple's whole invariant, so the check earns the type.
    options: Unsafe<readonly [QuestionOption, ...QuestionOption[]]>(
      Type.Array(questionOption, { minItems: 1, description: "Choices the user can select" }),
    ),
    multiple: Type.Optional(
      Type.Boolean({ description: "Let the user pick more than one option" }),
    ),
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

/** Choice ids are 1-based positions: stable, short, and what a terminal user types. */
function choiceAt(option: QuestionOption, index: number): Choice {
  const choice = { id: String(index + 1), label: option.label };
  return option.description === undefined ? choice : { ...choice, description: option.description };
}

export function selectionFor(input: QuestionInput): Selection {
  const [first, ...rest] = input.options;
  const selection: Selection = {
    title: input.question,
    choices: [choiceAt(first, 0), ...rest.map((option, index) => choiceAt(option, index + 1))],
    other: "Or type your own answer",
  };
  return input.multiple === true ? { ...selection, multiple: true } : selection;
}

/**
 * The answer as the model reads it. A client's `SelectionReply` names choices
 * by id and keeps typed text apart; a bare string from a script names one
 * choice by id or label, or is its own answer. Several answers join as a list.
 */
export function answerFor(input: QuestionInput, reply: JsonValue): string {
  const selection = selectionFor(input);
  const structured = selectionReply(reply);
  if (structured !== undefined) {
    if (!acceptsSelectionReply(selection, structured)) return "";
    const picked = structured.choices.map((id) => {
      const choice = selection.choices.find((candidate) => candidate.id === id);
      if (choice === undefined) throw new Error("Accepted selection reply named an unknown choice");
      return choice.label;
    });
    const other = structured.other?.trim();
    return [...picked, ...(other === undefined ? [] : [other])].join(", ");
  }
  if (typeof reply !== "string") return "";
  const trimmed = reply.trim();
  const lowered = trimmed.toLowerCase();
  const selected = selection.choices.find(
    (choice) => choice.id === trimmed || choice.label.toLowerCase() === lowered,
  );
  return selected?.label ?? trimmed;
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

export function createQuestionTool(options: {
  readonly timeoutMs: () => Promise<number | undefined>;
}): AgentTool<typeof questionParameters, QuestionDetails> {
  return {
    name: "question",
    description:
      "Ask the user one question and let them choose one or more answers from a list. " +
      "The user may also answer in their own words; you receive whichever they gave.",
    parameters: questionParameters,
    availability: "foreground",
    replay: "never",
    execute: async (_callId, params) => {
      const ms = await options.timeoutMs();
      throw new ToolWait({
        selection: selectionFor(params),
        ...(ms === undefined ? {} : { until: Date.now() + ms }),
      });
    },
    wake: async (waiting, context) => {
      const input = parseQuestionInput(waiting.args);
      if (context.expired || context.aborted) return unanswered(input);
      if (context.reply === undefined) return { kind: "wait", selection: selectionFor(input) };
      const answer = answerFor(input, context.reply);
      return answer === "" ? unanswered(input) : answered(input, answer);
    },
  };
}

/** A standalone question tool with no timeout. The plugin binds its setting instead. */
export const questionTool = createQuestionTool({ timeoutMs: async () => undefined });

export const questionPlugin = definePlugin({
  id: "question",
  session(api) {
    const timeoutMs = async (): Promise<number | undefined> => {
      const stored = await api.storage.get(TIMEOUT_KEY);
      return TIMEOUTS.find((timeout) => timeout.id === stored)?.ms;
    };
    api.tools.add((draft) => draft.set(questionTool.name, createQuestionTool({ timeoutMs })));
    api.settings.add((settings) =>
      settings.set(QUESTION_TIMEOUT_SETTING_ID, {
        label: "Question timeout",
        key: TIMEOUT_KEY,
        fallback: "never",
        choices: [
          { id: "never", label: "Wait for an answer" },
          ...TIMEOUTS.map(({ id }) => ({ id, label: id, description: "Then continue unanswered" })),
        ],
      }),
    );
  },
});

export default questionPlugin;
