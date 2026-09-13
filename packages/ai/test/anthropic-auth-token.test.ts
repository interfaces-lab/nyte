import { arch, platform, release } from "node:os";
import { beforeEach, describe, expect, it } from "vitest";
import { stream } from "../src/api/anthropic-messages.ts";
import { ANTHROPIC_AUTH_TOKEN_ENV, ANTHROPIC_OAUTH_TOKEN_ENV } from "../src/env-api-keys.ts";
import { createModels } from "../src/models.ts";
import { anthropicProvider } from "../src/providers/anthropic.ts";
import type { Context, Model } from "../src/types.ts";

interface CapturedRequest {
  headers: Headers;
  body: unknown;
}

const responseBody = [
  `event: rate_limit_event\ndata: ${JSON.stringify({
    type: "rate_limit_event",
    rate_limit_info: {
      rateLimitType: "five_hour",
      utilization: 0.42,
      resetsAt: 2_000_000_000,
    },
  })}`,
  `event: message_start\ndata: ${JSON.stringify({
    type: "message_start",
    message: {
      id: "msg_test",
      model: "claude-test",
      usage: { input_tokens: 1, output_tokens: 0 },
    },
  })}`,
  `event: message_delta\ndata: ${JSON.stringify({
    type: "message_delta",
    delta: { stop_reason: "end_turn" },
    usage: { output_tokens: 1 },
  })}`,
  `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}`,
].join("\n\n");

const requests: CapturedRequest[] = [];
const fetch: typeof globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const body: unknown = await request.clone().json();
  requests.push({ headers: request.headers, body });
  return new Response(responseBody, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
};

const NYTE_USER_AGENT = `nyte (${platform()} ${release()}; ${arch()})`;
const neverAbortedSignal = new AbortController().signal;

const context: Context = {
  systemPrompt: "System prompt.",
  messages: [{ role: "user", content: "Hello", timestamp: Date.now() }],
};

const anthropicModel: Model<"anthropic-messages"> = {
  id: "claude-test",
  name: "Claude Test",
  api: "anthropic-messages",
  provider: "anthropic",
  baseUrl: "https://api.anthropic.com",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100000,
  maxTokens: 4096,
};

const kimiCodingModel: Model<"anthropic-messages"> = {
  ...anthropicModel,
  id: "kimi-for-coding",
  name: "Kimi For Coding",
  provider: "kimi-coding",
  baseUrl: "https://api.kimi.com/coding",
};

beforeEach(() => {
  requests.length = 0;
});

describe("Anthropic auth token env", () => {
  it("resolves ANTHROPIC_AUTH_TOKEN as a bearer Authorization header", async () => {
    const provider = anthropicProvider();
    const auth = await provider.auth.apiKey?.resolve({
      ctx: {
        env: async (name) =>
          ({
            ANTHROPIC_AUTH_TOKEN: "auth-token",
            ANTHROPIC_OAUTH_TOKEN: "oauth-token",
            ANTHROPIC_API_KEY: "api-key",
          })[name],
        fileExists: async () => false,
      },
      signal: neverAbortedSignal,
    });

    expect(auth).toEqual({
      auth: { headers: { Authorization: "Bearer auth-token" } },
      source: ANTHROPIC_AUTH_TOKEN_ENV,
    });
  });

  it("preserves ANTHROPIC_OAUTH_TOKEN as OAuth-shaped API auth", async () => {
    const provider = anthropicProvider();
    const auth = await provider.auth.apiKey?.resolve({
      ctx: {
        env: async (name) =>
          ({
            ANTHROPIC_OAUTH_TOKEN: "oauth-token",
            ANTHROPIC_API_KEY: "api-key",
          })[name],
        fileExists: async () => false,
      },
      signal: neverAbortedSignal,
    });

    expect(auth).toEqual({
      auth: { apiKey: "oauth-token" },
      source: ANTHROPIC_OAUTH_TOKEN_ENV,
    });
  });

  it("reports account-limit events without adding them to the message stream", async () => {
    const observed: unknown[] = [];
    const eventTypes: string[] = [];
    const source = stream(anthropicModel, context, {
      headers: { Authorization: "Bearer test" },
      fetch,
      onAccountLimits: (limits) => {
        observed.push(limits);
      },
    });
    for await (const event of source) eventTypes.push(event.type);
    const result = await source.result();

    expect(result.stopReason).toBe("stop");
    expect(eventTypes).toEqual(["start", "done"]);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer test");
    expect(requests[0]?.headers.get("x-api-key")).toBeNull();
    expect(observed).toEqual([
      {
        providerId: "anthropic",
        windows: [
          {
            id: "five_hour",
            usedPercent: 42,
            resetsAt: 2_000_000_000_000,
          },
        ],
        observedAt: expect.any(Number),
      },
    ]);
  });

  it("uses Authorization headers without OAuth-mode request shaping", async () => {
    const result = await stream(anthropicModel, context, {
      headers: { Authorization: "Bearer gateway-token" },
      fetch,
      cacheRetention: "none",
    }).result();

    expect(result.stopReason).toBe("stop");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer gateway-token");
    expect(requests[0]?.headers.get("x-api-key")).toBeNull();
    expect(requests[0]?.headers.get("anthropic-beta") ?? "").not.toContain("oauth-2025-04-20");
    expect(requests[0]?.body).toMatchObject({
      model: "claude-test",
      system: [{ text: "System prompt." }],
      messages: [{ role: "user", content: "Hello" }],
      stream: true,
    });
  });

  it("threads authContext ANTHROPIC_AUTH_TOKEN through request headers", async () => {
    const models = createModels({
      authContext: {
        env: async (name) => (name === "ANTHROPIC_AUTH_TOKEN" ? "ctx-token" : undefined),
        fileExists: async () => false,
      },
    });
    models.setProvider(anthropicProvider());

    const result = await models
      .streamSimple(anthropicModel, context, { fetch, cacheRetention: "none" })
      .result();

    expect(result.stopReason).toBe("stop");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer ctx-token");
    expect(requests[0]?.headers.get("x-api-key")).toBeNull();
    expect(requests[0]?.headers.get("anthropic-beta") ?? "").not.toContain("oauth-2025-04-20");
    expect(requests[0]?.body).toMatchObject({ system: [{ text: "System prompt." }] });
  });

  it("preserves OAuth request shaping for ANTHROPIC_OAUTH_TOKEN", async () => {
    const models = createModels({
      authContext: {
        env: async (name) => (name === "ANTHROPIC_OAUTH_TOKEN" ? "sk-ant-oat-test" : undefined),
        fileExists: async () => false,
      },
    });
    models.setProvider(anthropicProvider());

    const result = await models
      .streamSimple(anthropicModel, context, { fetch, cacheRetention: "none" })
      .result();

    expect(result.stopReason).toBe("stop");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer sk-ant-oat-test");
    expect(requests[0]?.headers.get("x-api-key")).toBeNull();
    expect(requests[0]?.headers.get("anthropic-beta")).toContain("oauth-2025-04-20");
    expect(requests[0]?.body).toMatchObject({
      system: [
        { text: "You are Claude Code, Anthropic's official CLI for Claude." },
        { text: "System prompt." },
      ],
    });
  });

  it("lets explicit request headers override ANTHROPIC_AUTH_TOKEN", async () => {
    const models = createModels({
      authContext: {
        env: async (name) => (name === "ANTHROPIC_AUTH_TOKEN" ? "ctx-token" : undefined),
        fileExists: async () => false,
      },
    });
    models.setProvider(anthropicProvider());

    const result = await models
      .streamSimple(anthropicModel, context, {
        headers: { Authorization: "Bearer explicit-token" },
        fetch,
        cacheRetention: "none",
      })
      .result();

    expect(result.stopReason).toBe("stop");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer explicit-token");
    expect(requests[0]?.headers.get("x-api-key")).toBeNull();
  });
});

describe("Anthropic-compatible user agents", () => {
  it("uses Nyte's User-Agent by default for Anthropic Messages requests", async () => {
    const result = await stream(anthropicModel, context, {
      apiKey: "anthropic-key",
      fetch,
    }).result();

    expect(result.stopReason).toBe("stop");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers.get("x-api-key")).toBe("anthropic-key");
    expect(requests[0]?.headers.get("authorization")).toBeNull();
    expect(requests[0]?.headers.get("user-agent")).toBe(NYTE_USER_AGENT);
  });

  it("lets explicit headers override the default Anthropic Messages User-Agent", async () => {
    const result = await stream(kimiCodingModel, context, {
      apiKey: "kimi-key",
      headers: { "User-Agent": "custom-client" },
      fetch,
    }).result();

    expect(result.stopReason).toBe("stop");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers.get("x-api-key")).toBe("kimi-key");
    expect(requests[0]?.headers.get("authorization")).toBeNull();
    expect(requests[0]?.headers.get("user-agent")).toBe("custom-client");
  });
});
