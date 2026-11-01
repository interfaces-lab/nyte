import { asId } from "@nyte-ai/schema";
import type { ModelInfo, ModelListing, Thinking } from "@nyte-ai/sdk";
import { toDesktopCatalog } from "@nyte-ai/app/data/catalog.ts";

interface Spec {
  readonly id: string;
  readonly name: string;
  readonly thinking: readonly Thinking[];
  readonly context: number;
  readonly fast?: boolean;
  readonly images?: boolean;
  readonly cost?: readonly [input: number, output: number];
}

function model(provider: string, spec: Spec): ModelInfo {
  const cost = spec.cost ?? [3, 15];

  return {
    ref: { provider, id: spec.id },
    name: spec.name,
    reasoning: spec.thinking.length > 1,
    thinking: spec.thinking,
    defaultThinking: spec.thinking.includes("medium")
      ? "medium"
      : (spec.thinking.find((level) => level !== "off") ?? "off"),
    fast: spec.fast === true ? { provider, id: `${spec.id}-fast` } : null,
    contextWindow: spec.context,
    compactAt: Math.round(spec.context * 0.9),
    maxOutput: 64_000,
    input: spec.images === false ? ["text"] : ["text", "image"],
    capabilities: { steer: true },
    cost: { input: cost[0], output: cost[1], cacheRead: cost[0] / 10, cacheWrite: cost[0] * 1.25 },
  };
}

const CLAUDE = ["off", "low", "medium", "high", "max"] as const;

const GPT = ["minimal", "low", "medium", "high", "xhigh"] as const;

const GEMINI = ["off", "low", "high"] as const;

function provider(
  id: string,
  name: string,
  credential: "verified" | "configured" | "missing",
  specs: readonly Spec[],
  listings: Readonly<Record<string, Exclude<ModelListing, "shown">>> = {},
) {
  return {
    id,
    name,
    credential,
    methods: [{ kind: "oauth" as const }, { kind: "key" as const }],
    limits: [],
    listings,
    models: specs.map((spec) => model(id, spec)),
  };
}

/** Five connected providers and one that isn't, enough to scroll and to search. */
export const catalog = toDesktopCatalog({
  generation: asId<"catalog-generation">("lab-models"),
  default: { provider: "anthropic", id: "claude-opus-4-5" },
  providers: [
    provider(
      "anthropic",
      "Anthropic",
      "verified",
      [
        {
          id: "claude-opus-4-5",
          name: "Claude Opus 4.5",
          thinking: CLAUDE,
          context: 200_000,
          fast: true,
          cost: [5, 25],
        },
        {
          id: "claude-sonnet-4-5",
          name: "Claude Sonnet 4.5",
          thinking: CLAUDE,
          context: 1_000_000,
        },
        {
          id: "claude-haiku-4-5",
          name: "Claude Haiku 4.5",
          thinking: ["off", "low", "medium", "high"],
          context: 200_000,
          cost: [1, 5],
        },
      ],
      { "claude-opus-4-5": "favorite" },
    ),
    provider(
      "openai",
      "OpenAI",
      "configured",
      [
        {
          id: "gpt-5-1",
          name: "GPT-5.1",
          thinking: GPT,
          context: 400_000,
          fast: true,
          cost: [1.25, 10],
        },
        {
          id: "gpt-5-1-codex",
          name: "GPT-5.1 Codex",
          thinking: GPT,
          context: 400_000,
          cost: [1.25, 10],
        },
        {
          id: "gpt-5-1-codex-mini",
          name: "GPT-5.1 Codex Mini",
          thinking: ["low", "medium", "high"],
          context: 400_000,
          cost: [0.25, 2],
        },
        { id: "gpt-4-1", name: "GPT-4.1", thinking: ["off"], context: 1_000_000, cost: [2, 8] },
      ],
      { "gpt-5-1-codex": "favorite", "gpt-4-1": "hidden" },
    ),
    provider("google", "Google", "verified", [
      {
        id: "gemini-3-pro",
        name: "Gemini 3 Pro",
        thinking: GEMINI,
        context: 1_000_000,
        cost: [2, 12],
      },
      {
        id: "gemini-2-5-flash",
        name: "Gemini 2.5 Flash",
        thinking: GEMINI,
        context: 1_000_000,
        cost: [0.3, 2.5],
      },
    ]),
    provider(
      "openrouter",
      "OpenRouter",
      "configured",
      [
        {
          id: "deepseek-v3-2",
          name: "DeepSeek V3.2",
          thinking: ["off", "high"],
          context: 128_000,
          images: false,
          cost: [0.28, 0.42],
        },
        {
          id: "kimi-k2-thinking",
          name: "Kimi K2 Thinking",
          thinking: ["off", "high"],
          context: 256_000,
          images: false,
          cost: [0.6, 2.5],
        },
        {
          id: "qwen3-coder",
          name: "Qwen3 Coder",
          thinking: ["off"],
          context: 256_000,
          images: false,
          cost: [0.22, 0.95],
        },
      ],
      { "qwen3-coder": "hidden" },
    ),
    provider("acp", "Agents", "verified", [
      { id: "codex-acp", name: "Codex", thinking: ["off"], context: 400_000 },
      { id: "gemini", name: "Gemini CLI", thinking: ["off"], context: 1_000_000 },
      { id: "cursor", name: "Cursor Agent", thinking: ["off"], context: 200_000 },
    ]),
    provider("mistral", "Mistral", "missing", [
      { id: "devstral", name: "Devstral 2", thinking: ["off"], context: 256_000 },
    ]),
  ],
});
