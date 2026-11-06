import type { BenchCase, Suite } from "../../src/case.ts";
import { NOTES_FILES, TODOS } from "../notes.ts";

const REPLY =
  "notes.txt lists three TODO items: rename the billing page, ship the dark mode toggle and write the changelog. The launch owner is Priya.";

const loose = (id: string, prompt: string, model: string): BenchCase => ({
  id,
  kind: "bad",
  experience:
    "Asked for a subagent on a model named the way people say it, the chat's task call named no model Nyte has, failed, and took another round to retry.",
  prompt,
  servers: {},
  files: NOTES_FILES,
  subagentReply: REPLY,
  expect: { calls: ["task"], subagentModel: model, answer: TODOS },
});

/**
 * Whether a subagent starts on the model the user named loosely, in one round. Each subagent
 * gets a scripted reply instead of reaching its model, so only the chat's call is measured.
 */
export const SUBAGENT_MODELS: Suite = {
  id: "subagent-models",
  title: "Subagent models",
  cases: [
    loose(
      "model-opus",
      "Spin up an opus 5.5 subagent to list the TODO items in notes.txt.",
      "anthropic/claude-opus-5-5",
    ),
    loose(
      "model-sonnet",
      "Spin up a sonnet 5.5 subagent to list the TODO items in notes.txt.",
      "anthropic/claude-sonnet-5-5",
    ),
    loose(
      "model-haiku",
      "Use haiku 5.5 as a subagent to list the TODO items in notes.txt.",
      "anthropic/claude-haiku-5-5",
    ),
    loose(
      "model-sol",
      "Have sol 6.1 list the TODO items in notes.txt as a subagent.",
      "openai-codex/gpt-6.1-sol",
    ),
    loose(
      "model-astra",
      "Ask astra, as a subagent, to list the TODO items in notes.txt.",
      "openai-codex/gpt-6-astra",
    ),
  ],
};
