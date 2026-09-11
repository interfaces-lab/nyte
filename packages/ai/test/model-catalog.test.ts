import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { anthropicProvider } from "../src/providers/anthropic.ts";
import { openaiCodexProvider } from "../src/providers/openai-codex.ts";

describe("generated model catalog", () => {
  test("includes Daybreak Blue in the shared Codex catalog", () => {
    const model = openaiCodexProvider()
      .getModels()
      .find((candidate) => candidate.id === "gpt-daybreak-blue-latest");

    assert.ok(model);
    assert.equal(model.name, "Daybreak Blue");
    assert.equal(model.api, "openai-codex-responses");
    assert.equal(model.provider, "openai-codex");
    assert.equal(model.contextWindow, 272_000);
    assert.equal(model.maxTokens, 128_000);
    assert.equal(model.reasoning, true);
    assert.deepEqual(model.input, ["text", "image"]);
    assert.deepEqual(model.thinkingLevelMap, {
      xhigh: "xhigh",
      max: "max",
      off: null,
      minimal: "low",
    });
    assert.equal(model.compat?.supportsOpenAIGrammarTools, true);
    assert.equal(model.compat?.supportsAdditionalTools, true);
    assert.equal(model.compat?.supportsToolSearch, true);
    assert.equal(model.modes, undefined);
  });

  test("includes Claude Fable 5.1 with its direct Anthropic capabilities", () => {
    const model = anthropicProvider()
      .getModels()
      .find((candidate) => candidate.id === "claude-fable-5-1");

    assert.ok(model);
    assert.equal(model.api, "anthropic-messages");
    assert.equal(model.provider, "anthropic");
    assert.equal(model.contextWindow, 1_000_000);
    assert.equal(model.maxTokens, 128_000);
    assert.equal(model.reasoning, true);
    assert.deepEqual(model.input, ["text", "image"]);
    assert.deepEqual(model.thinkingLevelMap, { off: null, xhigh: "xhigh", max: "max" });
    assert.equal(model.compat?.forceAdaptiveThinking, true);
    assert.equal(model.compat?.supportsStrictTools, true);
  });
});
