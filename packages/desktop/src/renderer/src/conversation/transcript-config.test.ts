import assert from "node:assert/strict";
import { test } from "vitest";
import type { Turn } from "@nyte-ai/core";
import { configChangeText } from "./transcript-presentation.ts";

const turn = {
  kind: "config",
  commit: "config-change",
  at: 0,
  body: { kind: "config" },
} satisfies Turn;

test("config history presents every change that the TUI presents", () => {
  assert.equal(configChangeText(turn), undefined);
  assert.equal(
    configChangeText({
      ...turn,
      body: {
        ...turn.body,
        model: { provider: "openai", id: "gpt-6-astra" },
        thinkingLevel: "medium",
        agent: "plan",
      },
    }),
    "Model → openai/gpt-6-astra · Thinking → medium · Agent → plan",
  );
});

test("a provider-less model keeps its configured id", () => {
  assert.equal(
    configChangeText({ ...turn, body: { ...turn.body, model: { id: "local-model" } } }),
    "Model → local-model",
  );
});
