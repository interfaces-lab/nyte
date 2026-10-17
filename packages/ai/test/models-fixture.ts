import type { ApiKeyAuth, OAuthAuth, ProviderAuth } from "../src/auth/types.ts";
import type { Provider } from "../src/models.ts";
import type { Api, AssistantMessage, Context, Model, StreamOptions } from "../src/types.ts";
import { AssistantMessageEventStream } from "../src/utils/event-stream.ts";

export function testModel(provider: string, id: string): Model<Api> {
  return {
    id,
    name: id,
    api: "test-api",
    provider,
    baseUrl: "https://example.test/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 10000,
    maxTokens: 1000,
  };
}

export function doneMessage(model: Model<Api>, text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

export interface ProviderCall {
  model: Model<Api>;
  options: StreamOptions | undefined;
}

/** Ambient auth for keyless test providers; reports "configured" with no auth values. */
export const ambientAuth: ApiKeyAuth = {
  name: "Ambient",
  resolve: async () => ({ auth: {} }),
};

export function testProvider(input: {
  id: string;
  models?: Model<Api>[];
  auth?: ProviderAuth;
  getModels?: () => readonly Model<Api>[];
  refreshModels?: Provider["refreshModels"];
  fetchAccountLimits?: Provider["fetchAccountLimits"];
  calls?: ProviderCall[];
}): Provider {
  const models = input.models ?? [testModel(input.id, "model-a")];
  const respond = (model: Model<Api>, options: StreamOptions | undefined) => {
    input.calls?.push({ model, options });
    const stream = new AssistantMessageEventStream();
    const message = doneMessage(model, "ok");
    stream.push({ type: "start", partial: message });
    stream.push({ type: "done", reason: "stop", message });
    stream.end(message);
    return stream;
  };
  return {
    id: input.id,
    name: input.id,
    auth: input.auth ?? { apiKey: ambientAuth },
    getModels: input.getModels ?? (() => models),
    refreshModels: input.refreshModels,
    fetchAccountLimits: input.fetchAccountLimits,
    stream: (model, _context, options) => respond(model, options),
    streamSimple: (model, _context, options) => respond(model, options),
  };
}

export const context: Context = {
  messages: [{ role: "user", content: "hi", timestamp: Date.now() }],
};

export function envKeyAuth(key: string | undefined): ApiKeyAuth {
  return {
    name: "Test API key",
    resolve: async (input) => {
      const resolved = input.credential?.key ?? key;
      if (!resolved) return undefined;
      return { auth: { apiKey: resolved }, source: input.credential ? "stored" : "env" };
    },
  };
}

export function testOAuth(overrides?: Partial<OAuthAuth>): OAuthAuth {
  return {
    name: "Test OAuth",
    login: async () => {
      throw new Error("not used");
    },
    refresh: async (credential) => credential,
    toAuth: async (credential) => ({ apiKey: credential.access }),
    ...overrides,
  };
}
