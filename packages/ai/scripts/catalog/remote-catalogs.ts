/** Catalogs fetched from provider APIs rather than models.dev: NVIDIA NIM's live ids, OpenRouter, and Vercel AI Gateway. */
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { Api, Model } from "../../src/types.ts";
import { done, seconds } from "../terminal.ts";
import { roundCost } from "./costs.ts";

/** Pads source labels in the progress lines to the widest one, "Vercel AI Gateway". */
export const SOURCE_WIDTH = "Vercel AI Gateway".length;

export const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";

const AI_GATEWAY_MODELS_URL = "https://ai-gateway.vercel.sh/v1";

const AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh";

const NvidiaNimModelListSchema = Type.Object({
  data: Type.Optional(Type.Array(Type.Object({ id: Type.String() }))),
});

const optionalString = Type.Optional(Type.String());

const optionalLimit = Type.Optional(Type.Union([Type.Number(), Type.Null()]));

const OpenRouterModelListSchema = Type.Object({
  data: Type.Array(
    Type.Object({
      id: Type.String(),
      name: Type.String(),
      supported_parameters: Type.Optional(Type.Array(Type.String())),
      architecture: Type.Optional(Type.Object({ modality: optionalString })),
      pricing: Type.Optional(
        Type.Object({
          prompt: optionalString,
          completion: optionalString,
          input_cache_read: optionalString,
          input_cache_write: optionalString,
        }),
      ),
      top_provider: Type.Optional(
        Type.Object({ context_length: optionalLimit, max_completion_tokens: optionalLimit }),
      ),
      context_length: optionalLimit,
    }),
  ),
});

const AiGatewayPriceSchema = Type.Optional(Type.Union([Type.String(), Type.Number()]));

const AiGatewayModelSchema = Type.Object({
  id: Type.String(),
  name: Type.Optional(Type.String()),
  context_window: Type.Optional(Type.Number()),
  max_tokens: Type.Optional(Type.Number()),
  tags: Type.Optional(Type.Array(Type.String())),
  pricing: Type.Optional(
    Type.Object({
      input: AiGatewayPriceSchema,
      output: AiGatewayPriceSchema,
      input_cache_read: AiGatewayPriceSchema,
      input_cache_write: AiGatewayPriceSchema,
    }),
  ),
});

const AiGatewayModelListSchema = Type.Object({ data: Type.Optional(Type.Array(Type.Unknown())) });

/** Lowercases an NVIDIA model id and turns underscores into dots, as models.dev spells them. */
export function normalizeNvidiaModelId(modelId: string): string {
  return modelId.toLowerCase().replaceAll("_", ".");
}

/** NVIDIA NIM's live model ids, keyed by themselves and by their normalized spelling. */
export async function fetchNvidiaNimModelIds(): Promise<Map<string, string>> {
  const startedAt = performance.now();
  const response = await fetch(`${NVIDIA_BASE_URL}/models`);

  if (!response.ok) throw new Error(`NVIDIA NIM API returned ${response.status}`);
  const data: unknown = await response.json();

  if (!Value.Check(NvidiaNimModelListSchema, data)) {
    throw new Error("NVIDIA NIM API returned an unexpected model list");
  }

  const modelIds = new Map<string, string>();

  for (const model of data.data ?? []) {
    modelIds.set(model.id, model.id);
    modelIds.set(normalizeNvidiaModelId(model.id), model.id);
  }

  done("NVIDIA NIM", `${data.data?.length ?? 0} model IDs · ${seconds(startedAt)}`, SOURCE_WIDTH);

  return modelIds;
}

/** OpenRouter's tool-capable models. OpenRouter prices per token; catalogs store dollars per million tokens. */
export async function fetchOpenRouterModels(): Promise<Model<Api>[]> {
  const startedAt = performance.now();
  const response = await fetch("https://openrouter.ai/api/v1/models");

  if (!response.ok) throw new Error(`OpenRouter API returned ${response.status}`);
  const data: unknown = await response.json();

  if (!Value.Check(OpenRouterModelListSchema, data)) {
    throw new Error("OpenRouter API returned an unexpected model list");
  }

  const models: Model<Api>[] = [];

  for (const model of data.data) {
    if (!model.supported_parameters?.includes("tools")) continue;

    const input: ("text" | "image")[] = ["text"];

    if (model.architecture?.modality?.includes("image")) {
      input.push("image");
    }

    const inputCost = roundCost(parseFloat(model.pricing?.prompt || "0") * 1_000_000);
    const outputCost = roundCost(parseFloat(model.pricing?.completion || "0") * 1_000_000);

    const cacheReadCost = roundCost(parseFloat(model.pricing?.input_cache_read || "0") * 1_000_000);

    const cacheWriteCost = roundCost(
      parseFloat(model.pricing?.input_cache_write || "0") * 1_000_000,
    );

    const contextWindow = model.top_provider?.context_length || model.context_length || 4096;

    const normalizedModel: Model<Api> = {
      id: model.id,
      name: model.name,
      api: "openai-completions",
      baseUrl: "https://openrouter.ai/api/v1",
      provider: "openrouter",
      reasoning: model.supported_parameters?.includes("reasoning") || false,
      input,
      cost: {
        input: inputCost,
        output: outputCost,
        cacheRead: cacheReadCost,
        cacheWrite: cacheWriteCost,
      },
      contextWindow,
      maxTokens: model.top_provider?.max_completion_tokens || 4096,
    };

    models.push(normalizedModel);
  }

  done("OpenRouter", `${models.length} models · ${seconds(startedAt)}`, SOURCE_WIDTH);

  return models;
}

/** Vercel AI Gateway's tool-capable models, served over its Anthropic Messages endpoint. */
export async function fetchAiGatewayModels(): Promise<Model<Api>[]> {
  const startedAt = performance.now();
  const response = await fetch(`${AI_GATEWAY_MODELS_URL}/models`);

  if (!response.ok) throw new Error(`Vercel AI Gateway API returned ${response.status}`);
  const data: unknown = await response.json();
  const models: Model<Api>[] = [];

  const toNumber = (value: string | number | undefined): number => {
    const parsed = parseFloat(String(value ?? "0"));

    return Number.isFinite(parsed) ? parsed : 0;
  };

  const items = Value.Check(AiGatewayModelListSchema, data) ? (data.data ?? []) : [];

  for (const model of items) {
    if (!Value.Check(AiGatewayModelSchema, model)) continue;
    const tags = model.tags ?? [];

    if (!tags.includes("tool-use")) continue;

    const input: ("text" | "image")[] = ["text"];

    if (tags.includes("vision")) {
      input.push("image");
    }

    const inputCost = roundCost(toNumber(model.pricing?.input) * 1_000_000);
    const outputCost = roundCost(toNumber(model.pricing?.output) * 1_000_000);
    const cacheReadCost = roundCost(toNumber(model.pricing?.input_cache_read) * 1_000_000);
    const cacheWriteCost = roundCost(toNumber(model.pricing?.input_cache_write) * 1_000_000);

    models.push({
      id: model.id,
      name: model.name || model.id,
      api: "anthropic-messages",
      baseUrl: AI_GATEWAY_BASE_URL,
      provider: "vercel-ai-gateway",
      reasoning: tags.includes("reasoning"),
      input,
      cost: {
        input: inputCost,
        output: outputCost,
        cacheRead: cacheReadCost,
        cacheWrite: cacheWriteCost,
      },
      contextWindow: model.context_window || 4096,
      maxTokens: model.max_tokens || 4096,
    });
  }

  done("Vercel AI Gateway", `${models.length} models · ${seconds(startedAt)}`, SOURCE_WIDTH);

  return models;
}
