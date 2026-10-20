import { join } from "node:path";
import { anthropicProvider, openaiProvider, openrouterProvider } from "@nyte-ai/ai";
import type { ProviderAuth } from "@nyte-ai/ai";
import { createModels } from "@nyte-ai/ai/models";
import type { MutableModels, Provider } from "@nyte-ai/ai/models";
import { openaiCodexProvider } from "@nyte-ai/ai/providers/openai-codex";
import type { Api, Model } from "@nyte-ai/schema/model";
import { openRecorder } from "./recorder.ts";
import type { Recorder, RecorderFetch, RecorderSocketClass } from "./recorder.ts";

export interface BenchCassette {
  readonly path: string;
  readonly provider: () => Provider;
  readonly model: Model<Api>;
  readonly volatile: readonly string[];
  readonly prompt: string;
  readonly answer: string;
}

const folder = join(import.meta.dirname, "cassettes");

export const CASSETTES = {
  anthropicToolUse: {
    path: join(folder, "anthropic-tool-use.json"),
    provider: anthropicProvider,
    model: {
      id: "claude-sonnet-4-5",
      name: "Claude Sonnet 4.5",
      api: "anthropic-messages",
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com",
      reasoning: true,
      input: ["text", "image"],
      cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      contextWindow: 200_000,
      maxTokens: 64_000,
    },
    volatile: ["system", "tools"],
    prompt: "What do my notes say?",
    answer: "Your notes say to buy oat milk and call the landlord.",
  },
  openaiResponses: {
    path: join(folder, "openai-responses-text.json"),
    provider: openaiProvider,
    model: {
      id: "gpt-5-mini",
      name: "GPT-5 mini",
      api: "openai-responses",
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      reasoning: true,
      input: ["text", "image"],
      cost: { input: 0.25, output: 2, cacheRead: 0.025, cacheWrite: 0 },
      contextWindow: 400_000,
      maxTokens: 128_000,
    },
    volatile: ["input.0.content", "tools", "prompt_cache_key"],
    prompt: "Name a prime number.",
    answer: "Seven is a prime number.",
  },
  openrouterCompletions: {
    path: join(folder, "openrouter-completions-text.json"),
    provider: openrouterProvider,
    model: {
      id: "anthropic/claude-haiku-4.5",
      name: "Anthropic: Claude Haiku 4.5",
      api: "openai-completions",
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      reasoning: false,
      input: ["text"],
      cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
      contextWindow: 200_000,
      maxTokens: 64_000,
    },
    volatile: ["messages.0.content", "tools", "prompt_cache_key"],
    prompt: "What is the capital of France?",
    answer: "The capital of France is Paris.",
  },
  codexWebSocket: {
    path: join(folder, "openai-codex-websocket.json"),
    provider: openaiCodexProvider,
    model: {
      id: "gpt-5.1-codex",
      name: "GPT-5.1 Codex",
      api: "openai-codex-responses",
      provider: "openai-codex",
      baseUrl: "https://chatgpt.com/backend-api",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 400_000,
      maxTokens: 128_000,
    },
    volatile: ["instructions", "tools", "prompt_cache_key"],
    prompt: "Say hello.",
    answer: "Hello from Codex.",
  },
} as const satisfies Readonly<Record<string, BenchCassette>>;

export interface CassettePlayer extends Recorder {
  readonly models: MutableModels;
}

export async function playCassette(input: {
  readonly cassette: BenchCassette;
  readonly paths?: Readonly<Record<string, string>>;
  readonly replayKey?: string;
  readonly upstream?: { readonly fetch: RecorderFetch; readonly WebSocket?: RecorderSocketClass };
}): Promise<CassettePlayer> {
  const recorder = await openRecorder({
    path: input.cassette.path,
    paths: input.paths,
    volatile: input.cassette.volatile,
    upstream: input.upstream,
  });

  return {
    ...recorder,
    models: recordedModels({
      recorder,
      provider: input.cassette.provider(),
      model: input.cassette.model,
      replayKey: input.replayKey,
    }),
  };
}

const REPLAY_KEY = "nyte-replay-key";

function recordedModels(input: {
  readonly recorder: Recorder;
  readonly provider: Provider;
  readonly model: Model<Api>;
  readonly replayKey?: string;
}): MutableModels {
  const { recorder, provider } = input;
  const key = input.replayKey ?? REPLAY_KEY;

  const auth: ProviderAuth =
    recorder.mode === "record"
      ? provider.auth
      : {
          apiKey: {
            name: `${provider.name} cassette`,
            resolve: async () => ({ auth: { apiKey: key }, source: "cassette" }),
          },
        };

  const models = createModels();

  models.setProvider({
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    headers: provider.headers,
    promptCache: provider.promptCache,
    capabilities: provider.capabilities,
    auth,
    getModels: () => [input.model],
    stream: (model, context, options) =>
      provider.stream(model, context, Object.assign({}, options, { fetch: recorder.fetch })),
    streamSimple: (model, context, options) =>
      provider.streamSimple(model, context, { ...options, fetch: recorder.fetch }),
  });

  return models;
}
