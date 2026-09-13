import { expect, expectTypeOf, it } from "vitest";
import { GITHUB_COPILOT_MODELS } from "../src/providers/github-copilot.models.ts";
import { OPENAI_MODELS } from "../src/providers/openai.models.ts";

it("derives model API, ID, and provider literals from grouped model data", () => {
  expectTypeOf(OPENAI_MODELS["gpt-5.5"].api).toEqualTypeOf<"openai-responses">();
  expectTypeOf(OPENAI_MODELS["gpt-5.5"].id).toEqualTypeOf<"gpt-5.5">();
  expectTypeOf(OPENAI_MODELS["gpt-5.5"].provider).toEqualTypeOf<"openai">();
  expectTypeOf(
    GITHUB_COPILOT_MODELS["claude-sonnet-4.6"].api,
  ).toEqualTypeOf<"anthropic-messages">();
  expectTypeOf(GITHUB_COPILOT_MODELS["claude-sonnet-4.6"].id).toEqualTypeOf<"claude-sonnet-4.6">();
  expectTypeOf(
    GITHUB_COPILOT_MODELS["claude-sonnet-4.6"].provider,
  ).toEqualTypeOf<"github-copilot">();
});

it("routes GitHub Copilot Grok 4.5 through the Responses API", () => {
  expectTypeOf(GITHUB_COPILOT_MODELS["grok-4.5"].api).toEqualTypeOf<"openai-responses">();
  expect(GITHUB_COPILOT_MODELS["grok-4.5"].api).toBe("openai-responses");
});
