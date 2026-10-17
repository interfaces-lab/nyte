import { asId } from "@nyte-ai/schema";
import type { ModelInfo, Thinking } from "@nyte-ai/sdk";
import { toDesktopCatalog, type DesktopModelOption } from "@nyte-ai/app/catalog.ts";

function model(
  provider: string,
  id: string,
  name: string,
  thinking: readonly Thinking[],
  fast: boolean,
): ModelInfo {
  return {
    ref: { provider, id },
    name,
    reasoning: true,
    thinking,
    defaultThinking: thinking.find((level) => level !== "off") ?? "off",
    fast: fast ? { provider, id: `${id}-fast` } : null,
    contextWindow: 200_000,
    compactAt: 180_000,
    maxOutput: 64_000,
    input: ["text", "image"],
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  };
}

export const modelCatalog = toDesktopCatalog({
  generation: asId<"catalog-generation">("lab"),
  default: { provider: "anthropic", id: "claude-opus" },
  providers: [
    {
      id: "anthropic",
      name: "Anthropic",
      credential: "verified",
      methods: [{ kind: "oauth" }],
      limits: [],
      models: [
        model(
          "anthropic",
          "claude-opus",
          "Claude Opus 4.5",
          ["off", "low", "medium", "high"],
          true,
        ),
        model(
          "anthropic",
          "claude-sonnet",
          "Claude Sonnet 4.5",
          ["off", "low", "medium", "high"],
          false,
        ),
      ],
    },
    {
      id: "openai",
      name: "OpenAI",
      credential: "configured",
      methods: [{ kind: "key" }],
      limits: [],
      models: [
        model("openai", "gpt", "GPT-5.1", ["off", "minimal", "low", "medium", "high"], true),
        model("openai", "gpt-codex", "GPT-5.1 Codex", ["off", "low", "medium", "high"], false),
      ],
    },
  ],
});

function firstModel(models: readonly DesktopModelOption[]): DesktopModelOption {
  const first = models[0];

  if (first === undefined) throw new Error("The lab catalog has no models");

  return first;
}

export const labModel = firstModel(modelCatalog.models);
