/** Shared GitHub Copilot HTTP, OAuth, catalog, and SSE fixtures. */
import { vi } from "vitest";
import { InMemoryCredentialStore } from "../src/auth/credential-store.ts";
import type { AuthEvent, ProviderAuthInteraction } from "../src/auth/types.ts";
import { createModels } from "../src/models.ts";
import { InMemoryModelsStore } from "../src/models-store.ts";
import { githubCopilotProvider } from "../src/providers/github-copilot.ts";
import type { Api, JsonValue, Model } from "../src/types.ts";

type Captured = { url: string; method: string; headers: Headers; body: string };
type Routes = Record<string, (request: Captured) => Response | Promise<Response>>;

/** Records every request and answers from a route table keyed by `METHOD url`. */
export function fakeFetch(routes: Routes) {
  const requests: Captured[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const captured = {
      url: request.url,
      method: request.method,
      headers: request.headers,
      body: await request.text(),
    };
    requests.push(captured);
    const route = routes[`${captured.method} ${captured.url}`];
    if (route === undefined)
      throw new Error(`Unexpected request: ${captured.method} ${captured.url}`);
    return route(captured);
  };
  return { fetch, requests };
}

export function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function sse(events: readonly JsonValue[]): Response {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" },
  });
}

/** Anthropic-style SSE: each event carries its `event:` line. */
export function anthropicSse(events: readonly (JsonValue & { type: string })[]): Response {
  return new Response(
    events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream" } },
  );
}

export function interaction(
  signal?: AbortSignal,
): ProviderAuthInteraction & { events: AuthEvent[] } {
  const events: AuthEvent[] = [];
  return {
    signal: signal ?? new AbortController().signal,
    events,
    prompt: async () => {
      throw new Error("device sign-in must not prompt");
    },
    notify: (event) => {
      events.push(event);
    },
  };
}

export const DEVICE = "POST https://github.com/login/device/code";
export const TOKEN = "POST https://github.com/login/oauth/access_token";
export const EXCHANGE = "GET https://api.github.com/copilot_internal/v2/token";
export const ORIGIN = "https://api.individual.githubcopilot.com";
export const SESSION_TOKEN = "tid=test;proxy-ep=proxy.individual.githubcopilot.com";
export const MODELS = `GET ${ORIGIN}/models`;

export const copilotCatalog: readonly Model<Api>[] = [
  {
    id: "gemini-3.8-flash",
    name: "Gemini 3.8 Flash",
    api: "openai-completions",
    provider: "github-copilot",
    baseUrl: ORIGIN,
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 64_000,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
    },
  },
  {
    id: "gpt-5.5",
    name: "GPT-5.5",
    api: "openai-responses",
    provider: "github-copilot",
    baseUrl: ORIGIN,
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    compat: { supportsOpenAIGrammarTools: true },
  },
  {
    id: "claude-sonnet-4.6",
    name: "Claude Sonnet 4.6",
    api: "anthropic-messages",
    provider: "github-copilot",
    baseUrl: ORIGIN,
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    contextWindow: 1_000_000,
    maxTokens: 32_000,
    compat: { forceAdaptiveThinking: true },
  },
  {
    id: "claude-haiku-4.5",
    name: "Claude Haiku 4.5",
    api: "anthropic-messages",
    provider: "github-copilot",
    baseUrl: ORIGIN,
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
    contextWindow: 200_000,
    maxTokens: 64_000,
    compat: { supportsEagerToolInputStreaming: false },
  },
];

export function sessionToken(token = SESSION_TOKEN) {
  return json({ token, expires_at: Math.floor(Date.now() / 1000) + 3600 });
}

export function deviceCode(overrides: Record<string, unknown> = {}) {
  return json({
    device_code: "device-1",
    user_code: "ABCD-1234",
    verification_uri: "https://github.com/login/device",
    interval: 1,
    expires_in: 900,
    ...overrides,
  });
}

/** A collection with the Copilot provider over fresh in-memory stores. */
export function copilotModels(routes: Routes) {
  const transport = fakeFetch({
    [DEVICE]: () => deviceCode(),
    [TOKEN]: () => json({ access_token: "gh-token" }),
    [EXCHANGE]: () => sessionToken(),
    [MODELS]: () =>
      json({
        data: [
          {
            id: "claude-sonnet-4.6",
            model_picker_enabled: true,
            policy: { state: "enabled" },
          },
        ],
      }),
    ...routes,
  });
  const credentials = new InMemoryCredentialStore();
  const modelsStore = new InMemoryModelsStore();
  void modelsStore.write("github-copilot", { models: copilotCatalog });
  const models = createModels({ credentials, modelsStore });
  models.setProvider(githubCopilotProvider({ fetch: transport.fetch, clientId: "c" }));
  return { models, requests: transport.requests, credentials, modelsStore, fetch: transport.fetch };
}

/** Run the device sign-in, skipping the one-second poll interval with fake timers. */
export async function signIn(models: ReturnType<typeof copilotModels>["models"]) {
  await models.refresh({ providers: ["github-copilot"], allowNetwork: false });
  vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
  try {
    const login = models.login("github-copilot", "oauth", interaction());
    void login.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(1000);
    return await login;
  } finally {
    vi.useRealTimers();
  }
}
