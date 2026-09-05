import assert from "node:assert/strict";
import { test } from "vitest";
import type { Turn } from "@nyte-ai/core";
import { configChangeText } from "./transcript-presentation.ts";

test("model routing does not add a transcript notice", () => {
  const turn = {
    kind: "config",
    commit: "model-change",
    at: 0,
    body: { kind: "config", model: { provider: "openai", id: "gpt-6-astra" } },
  } satisfies Turn;
  assert.equal(configChangeText(turn), undefined);
  assert.equal(
    configChangeText({ ...turn, body: { ...turn.body, agent: "plan" } }),
    "Mode set to plan",
  );
});
