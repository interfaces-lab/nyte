import { definePart, dev } from "@nyte-ai/core";
import type { ToolDefinition } from "@nyte-ai/core";
import { standard } from "@nyte-ai/schema";
import type { Json } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Plugin } from "./core.ts";

/**
 * The modal a question puts in front of the user: the prompt, the options
 * offered, and the one action that answers with a choice. A client without
 * a renderer draws the fallback; the model reads it too.
 *
 * @category plugins
 * @since 0.1.0
 */
export const question = definePart({
  kind: "ask/question",
  state: standard(Type.Object({ prompt: Type.String(), options: Type.Array(Type.String()) })),
  actions: { answer: { input: standard(Type.Object({ choice: Type.String() })) } },
  fallback: (state, { id }) => `Question ${id}: ${state.prompt} (${state.options.join(" / ")})`,
});

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
 * wait resolves at once with the durable answer (§42x, §42z).
 */
const ask: ToolDefinition<{ prompt: string; options: string[] }> = {
  name: "question",
  description: "Ask the user a question and wait for their answer. Use it for a decision you cannot make yourself.",
  parameters,
  class: (args) => ({ kind: "custom", label: args.prompt }),
  replay: "safe",
  async execute(args, invocation) {
    const part = await invocation.session.parts.create(question, {
      state: args,
      placement: { kind: "modal" },
    });

    dev("question", "asked", { call: invocation.call, part: part.id });
    const outcome = await invocation.wait({ kind: "part", part: part.id });
    const choice = outcome.kind === "part" ? choiceOf(outcome.answer) : null;

    return {
      content: [{ kind: "text", text: choice ?? "The user did not answer. Continue with your best judgment and say what you assumed." }],
      parts: [part.id],
    };
  },
};

/** Returns the choice an `answer` action carried, or null for a dismissal. */
function choiceOf(answer: { readonly action: string; readonly input: Json } | null): string | null {
  if (answer?.action !== "answer") return null;
  const { input } = answer;

  return typeof input === "object" && input !== null && "choice" in input && typeof input.choice === "string"
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
