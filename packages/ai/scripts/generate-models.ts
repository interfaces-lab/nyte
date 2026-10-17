#!/usr/bin/env node

/**
 * Generates the per-provider model catalogs in `packages/ai/catalog` from models.dev,
 * OpenRouter, Vercel AI Gateway and the hand-kept models in `catalog/curated-models.ts`.
 * models.dev takes priority: a later source never replaces a model an earlier one listed.
 */
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { dirname, join, relative } from "path";
import { fileURLToPath } from "url";
import { styleText } from "util";
import type { Api, Model } from "../src/types.ts";
import {
  applyAnthropicAllowedFallbackModelMetadata,
  applyAnthropicMessagesCompatMetadata,
  applyModelsDevModeMetadata,
  applyOpenAICompletionsCompatMetadata,
  applyOpenAICompletionsTranscriptMetadata,
  applyOpenAIExplicitPromptCacheMetadata,
  applyOpenAIGrammarToolCompatMetadata,
  applyOpenAIResponsesTranscriptMetadata,
  applyOpenAIToolSearchMetadata,
  applyPromptCacheMetadata,
  applyStrictToolCompatMetadata,
  inAnthropicFallbackChain,
} from "./catalog/compat-metadata.ts";
import {
  addCuratedModels,
  applyUpstreamCorrections,
  withoutUnservedModels,
} from "./catalog/curated-models.ts";
import {
  anthropicModels,
  bedrockModels,
  googleModels,
  kimiCodingModels,
  minimaxModels,
  mistralModels,
  moonshotModels,
  openAiModels,
  plainModels,
  qwenTokenPlanModels,
  vertexModels,
  xaiModels,
  xiaomiModels,
  zaiModels,
} from "./catalog/direct-providers.ts";
import {
  basetenModels,
  cloudflareAiGatewayModels,
  cloudflareWorkersAiModels,
  fireworksModels,
  githubCopilotModels,
  huggingFaceModels,
  nvidiaModels,
  opencodeModels,
  togetherModels,
} from "./catalog/hosted-providers.ts";
import { fetchModelsDevCatalog, ModelsDevMetadata } from "./catalog/models-dev.ts";
import {
  fetchAiGatewayModels,
  fetchNvidiaNimModelIds,
  fetchOpenRouterModels,
  SOURCE_WIDTH,
} from "./catalog/remote-catalogs.ts";
import {
  applyModelsDevReasoningOptionMetadata,
  applyThinkingLevelMetadata,
} from "./catalog/thinking-metadata.ts";
import { done, fail, seconds } from "./terminal.ts";
import { verifyNyteCatalogs } from "./verify-catalogs.ts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Every provider's models from models.dev, in a fixed order, and the metadata the loaders recorded from their
 * source models; OpenRouter's and Vercel's entries only record metadata.
 */
async function loadModelsDevData(): Promise<{
  readonly models: Model<Api>[];
  readonly metadata: ModelsDevMetadata;
}> {
  const startedAt = performance.now();
  const data = await fetchModelsDevCatalog();
  const metadata = new ModelsDevMetadata();

  for (const [modelId, model] of Object.entries(data.openrouter?.models ?? {})) {
    metadata.record("openrouter", modelId, model);
  }

  for (const [modelId, model] of Object.entries(data.vercel?.models ?? {})) {
    metadata.record("vercel-ai-gateway", modelId, model);
  }

  const nvidiaNimModelIds = data.nvidia?.models
    ? await fetchNvidiaNimModelIds()
    : new Map<string, string>();

  const models = [
    ...bedrockModels(data, metadata),
    ...anthropicModels(data, metadata),
    ...googleModels(data, metadata),
    ...vertexModels(data, metadata),
    ...openAiModels(data, metadata),
    ...plainModels(data, "groq", "openai-completions", "https://api.groq.com/openai/v1", metadata),
    ...plainModels(data, "cerebras", "openai-completions", "https://api.cerebras.ai/v1", metadata),
    ...cloudflareWorkersAiModels(data, metadata),
    ...cloudflareAiGatewayModels(data, metadata),
    ...xaiModels(data, metadata),
    ...zaiModels(data, metadata),
    ...mistralModels(data, metadata),
    ...huggingFaceModels(data, metadata),
    ...fireworksModels(data["fireworks-ai"], metadata),
    ...nvidiaModels(data, nvidiaNimModelIds, metadata),
    ...togetherModels(data, metadata),
    ...basetenModels(data.baseten),
    ...opencodeModels(data, metadata),
    ...githubCopilotModels(data, metadata),
    ...minimaxModels(data, metadata),
    ...kimiCodingModels(data, metadata),
    ...moonshotModels(data, metadata),
    ...xiaomiModels(data, metadata),
    ...qwenTokenPlanModels(data, metadata),
  ];

  done("models.dev", `${models.length} models · ${seconds(startedAt)}`, SOURCE_WIDTH);

  return { models, metadata };
}

/** Derives each model's compatibility, thinking and cache metadata, in the order later passes depend on. */
function applyMetadata(models: readonly Model<Api>[], metadata: ModelsDevMetadata): void {
  for (const model of models) {
    applyModelsDevModeMetadata(model, metadata);
    applyOpenAICompletionsCompatMetadata(model);
    applyAnthropicMessagesCompatMetadata(model);
    applyModelsDevReasoningOptionMetadata(model, metadata);
    applyThinkingLevelMetadata(model);
    applyStrictToolCompatMetadata(model);
    applyOpenAIGrammarToolCompatMetadata(model);
    applyOpenAIToolSearchMetadata(model);
    applyOpenAICompletionsTranscriptMetadata(model);
    applyOpenAIResponsesTranscriptMetadata(model);
    applyOpenAIExplicitPromptCacheMetadata(model);
    applyPromptCacheMetadata(model);
  }

  applyAnthropicAllowedFallbackModelMetadata(models.filter(inAnthropicFallbackChain));
}

/** Groups models by provider, keeping the first model each provider lists under an id. */
function groupByProvider(
  models: readonly Model<Api>[],
): Record<string, Record<string, Model<Api>>> {
  const providers: Record<string, Record<string, Model<Api>>> = {};

  for (const model of models) {
    if (!providers[model.provider]) {
      providers[model.provider] = {};
    }

    if (!providers[model.provider][model.id]) {
      providers[model.provider][model.id] = model;
    }
  }

  return providers;
}

async function generateModels() {
  const startedAt = performance.now();
  const modelsDev = await loadModelsDevData();
  const openRouterModels = await fetchOpenRouterModels();
  const aiGatewayModels = await fetchAiGatewayModels();

  const allModels = withoutUnservedModels([
    ...modelsDev.models,
    ...openRouterModels,
    ...aiGatewayModels,
  ]);

  applyUpstreamCorrections(allModels);
  addCuratedModels(allModels);
  applyMetadata(allModels, modelsDev.metadata);

  const providers = groupByProvider(allModels);
  const sortedProviderIds = Object.keys(providers).sort();
  const catalogDir = join(packageRoot, "catalog");

  rmSync(catalogDir, { recursive: true, force: true });
  mkdirSync(catalogDir, { recursive: true });

  for (const providerId of sortedProviderIds) {
    const models = Object.values(providers[providerId]).sort((left, right) =>
      left.id.localeCompare(right.id),
    );

    writeFileSync(join(catalogDir, `${providerId}.json`), `${JSON.stringify(models, null, 2)}\n`);
  }

  await verifyNyteCatalogs(catalogDir);

  const counts = sortedProviderIds.map((providerId) => ({
    providerId,
    count: Object.keys(providers[providerId]).length,
  }));
  const total = counts.reduce((sum, { count }) => sum + count, 0);
  const idWidth = Math.max(...sortedProviderIds.map((providerId) => providerId.length));
  const countWidth = String(Math.max(...counts.map(({ count }) => count))).length;

  console.log("");

  for (const { providerId, count } of counts) {
    console.log(
      `  ${providerId.padEnd(idWidth)}  ${styleText("dim", String(count).padStart(countWidth))}`,
    );
  }

  console.log("");
  done(
    `Wrote ${sortedProviderIds.length} catalogs to ${relative(join(packageRoot, "..", ".."), catalogDir)}`,
    `${total} models · ${seconds(startedAt)}`,
  );
}

generateModels().catch(fail);
