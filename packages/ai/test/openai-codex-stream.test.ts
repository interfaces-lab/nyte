import { arch, platform, release } from "node:os";
import { zstdDecompressSync } from "node:zlib";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  closeOpenAICodexWebSocketSessions,
  getOpenAICodexWebSocketDebugStats,
  resetOpenAICodexWebSocketDebugStats,
  stream,
  streamSimple,
} from "../src/api/openai-codex-responses.ts";
import type { Context, Model } from "../src/types.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  closeOpenAICodexWebSocketSessions();
  resetOpenAICodexWebSocketDebugStats();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function mockToken(accountId = "acc_test"): string {
  const payload = Buffer.from(
    JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: accountId } }),
    "utf8",
  ).toString("base64");
  return `aaa.${payload}.bbb`;
}

function parseJson(value: string): unknown {
  const parsed: unknown = JSON.parse(value);
  return parsed;
}

function decodeCodexRequestBody(body: RequestInit["body"] | undefined): unknown {
  if (typeof body === "string") {
    return parseJson(body);
  }
  if (body instanceof Uint8Array) {
    return parseJson(Buffer.from(zstdDecompressSync(body)).toString("utf8"));
  }
  return undefined;
}

function buildSSEPayload(options: {
  status: "completed" | "incomplete";
  includeDone?: boolean;
  endTurn?: boolean;
}): string {
  const terminalType =
    options.status === "incomplete" ? "response.incomplete" : "response.completed";
  const events = [
    `data: ${JSON.stringify({
      type: "response.output_item.added",
      item: { type: "message", id: "msg_1", role: "assistant", status: "in_progress", content: [] },
    })}`,
    `data: ${JSON.stringify({ type: "response.content_part.added", part: { type: "output_text", text: "" } })}`,
    `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "Hello" })}`,
    `data: ${JSON.stringify({
      type: "response.output_item.done",
      item: {
        type: "message",
        id: "msg_1",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: "Hello" }],
      },
    })}`,
    `data: ${JSON.stringify({
      type: terminalType,
      response: {
        status: options.status,
        end_turn: options.endTurn,
        incomplete_details:
          options.status === "incomplete" ? { reason: "max_output_tokens" } : null,
        usage: {
          input_tokens: 5,
          output_tokens: 3,
          total_tokens: 8,
          input_tokens_details: { cached_tokens: 0 },
        },
      },
    })}`,
  ];

  if (options.includeDone) {
    events.push("data: [DONE]");
  }

  return `${events.join("\n\n")}\n\n`;
}

function sseResponse(payload = buildSSEPayload({ status: "completed" })): Response {
  return new Response(payload, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

const CODEX_MODEL = {
  id: "gpt-5.1-codex",
  name: "GPT-5.1 Codex",
  api: "openai-codex-responses",
  provider: "openai-codex",
  baseUrl: "https://chatgpt.com/backend-api",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 400000,
  maxTokens: 128000,
} satisfies Model<"openai-codex-responses">;

const TEXT_CONTEXT = {
  systemPrompt: "You are a helpful assistant.",
  messages: [{ role: "user", content: "Say hello", timestamp: 1 }],
} satisfies Context;

describe("openai-codex streaming", () => {
  it("streams Daybreak Blue without selecting a Cyber access program", async () => {
    const token = mockToken();
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      expect(input.toString()).toBe("https://chatgpt.com/backend-api/codex/responses");
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe(`Bearer ${token}`);
      expect(headers.get("chatgpt-account-id")).toBe("acc_test");
      expect(headers.get("OpenAI-Beta")).toBe("responses=experimental");
      expect(headers.get("originator")).toBe("nyte");
      expect(headers.get("User-Agent")).toBe(`nyte (${platform()} ${release()}; ${arch()})`);
      expect(headers.get("accept")).toBe("text/event-stream");
      expect(headers.has("x-api-key")).toBe(false);
      expect(decodeCodexRequestBody(init?.body)).not.toHaveProperty("access_programs");
      return sseResponse();
    });
    vi.stubGlobal("fetch", fetchMock);

    const model = {
      ...CODEX_MODEL,
      id: "gpt-daybreak-blue-latest",
      name: "Daybreak Blue",
    } satisfies Model<"openai-codex-responses">;
    const resultStream = stream(model, TEXT_CONTEXT, { apiKey: token, transport: "sse" });
    const eventTypes: string[] = [];
    for await (const event of resultStream) {
      eventTypes.push(event.type);
    }

    const result = await resultStream.result();
    expect(result.content.find((content) => content.type === "text")?.text).toBe("Hello");
    expect(eventTypes).toContain("text_delta");
    expect(eventTypes).toContain("done");
  });

  it("completes after response.completed even when the SSE body stays open", async () => {
    const token = mockToken();
    const encoder = new TextEncoder();
    const sse = buildSSEPayload({ status: "completed", includeDone: true, endTurn: false });

    const responseStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(sse));
      },
    });

    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://chatgpt.com/backend-api/codex/responses") {
        return new Response(responseStream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const model = CODEX_MODEL;

    const context = TEXT_CONTEXT;

    const result = await Promise.race([
      stream(model, context, { apiKey: token, transport: "sse" }).result(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Timed out waiting for completed SSE stream")), 1000);
      }),
    ]);

    expect(result.content.find((c) => c.type === "text")?.text).toBe("Hello");
    expect(result.stopReason).toBe("stop");
    expect(result.endTurn).toBe(false);
  });

  it("maps response.incomplete to stopReason length even when the SSE body stays open", async () => {
    const token = mockToken();
    const encoder = new TextEncoder();
    const sse = buildSSEPayload({ status: "incomplete" });

    const responseStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(sse));
      },
    });

    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://chatgpt.com/backend-api/codex/responses") {
        return new Response(responseStream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const model = CODEX_MODEL;

    const context = TEXT_CONTEXT;

    const result = await Promise.race([
      stream(model, context, { apiKey: token, transport: "sse" }).result(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Timed out waiting for incomplete SSE stream")), 1000);
      }),
    ]);

    expect(result.content.find((c) => c.type === "text")?.text).toBe("Hello");
    expect(result.stopReason).toBe("length");
  });

  it("aborts SSE fetch after the configured HTTP timeout when response headers do not arrive", async () => {
    const token = mockToken();

    const fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url !== "https://chatgpt.com/backend-api/codex/responses") {
        throw new Error(`Unexpected URL: ${url}`);
      }

      const signal = init?.signal;
      if (!signal) {
        throw new Error("Expected SSE fetch to receive an abort signal");
      }

      return new Promise<Response>((_, reject) => {
        const onAbort = () => {
          const reason = signal.reason;
          reject(reason instanceof Error ? reason : new Error("SSE fetch aborted"));
        };
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const model = CODEX_MODEL;
    const context = TEXT_CONTEXT;

    const result = await stream(model, context, {
      apiKey: token,
      transport: "sse",
      timeoutMs: 10,
    }).result();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBe("Codex SSE response headers timed out after 10ms");
  });

  it("aborts SSE body reads after response headers arrive", async () => {
    const token = mockToken();
    const encoder = new TextEncoder();
    const timers: ReturnType<typeof setTimeout>[] = [];
    let cancelled = false;
    const responseStream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enqueue = (chunk: string) => {
          if (!cancelled) controller.enqueue(encoder.encode(chunk));
        };
        enqueue(
          `${[
            `data: ${JSON.stringify({
              type: "response.output_item.added",
              item: {
                type: "message",
                id: "msg_1",
                role: "assistant",
                status: "in_progress",
                content: [],
              },
            })}`,
            `data: ${JSON.stringify({ type: "response.content_part.added", part: { type: "output_text", text: "" } })}`,
            `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "one" })}`,
          ].join("\n\n")}\n\n`,
        );
        timers.push(
          setTimeout(() => {
            enqueue(
              `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "two" })}\n\n`,
            );
          }, 10),
        );
        timers.push(
          setTimeout(() => {
            if (cancelled) return;
            enqueue(
              `${[
                `data: ${JSON.stringify({
                  type: "response.output_item.done",
                  item: {
                    type: "message",
                    id: "msg_1",
                    role: "assistant",
                    status: "completed",
                    content: [{ type: "output_text", text: "onetwo" }],
                  },
                })}`,
                `data: ${JSON.stringify({
                  type: "response.completed",
                  response: {
                    status: "completed",
                    usage: {
                      input_tokens: 5,
                      output_tokens: 3,
                      total_tokens: 8,
                      input_tokens_details: { cached_tokens: 0 },
                    },
                  },
                })}`,
              ].join("\n\n")}\n\n`,
            );
            controller.close();
          }, 20),
        );
      },
      cancel() {
        cancelled = true;
        for (const timer of timers) clearTimeout(timer);
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(responseStream, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
      ),
    );

    const model = CODEX_MODEL;
    const context = TEXT_CONTEXT;
    const controller = new AbortController();
    const events: string[] = [];

    const resultStream = stream(model, context, {
      apiKey: token,
      transport: "sse",
      signal: controller.signal,
    });
    for await (const event of resultStream) {
      events.push(event.type === "text_delta" ? `text_delta:${event.delta}` : event.type);
      if (event.type === "text_delta" && event.delta === "one") {
        controller.abort();
      }
    }

    const result = await resultStream.result();
    expect(result.stopReason).toBe("aborted");
    expect(result.errorMessage).toBe("Request was aborted");
    expect(events).toContain("text_delta:one");
    expect(events).not.toContain("text_delta:two");
    expect(cancelled).toBe(true);
  });

  it("sets session-id/x-client-request-id headers and prompt_cache_key when sessionId is provided", async () => {
    const sessionId = "test-session-123";
    const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("session-id")).toBe(sessionId);
      expect(headers.has("session_id")).toBe(false);
      expect(headers.get("x-client-request-id")).toBe(sessionId);
      expect(decodeCodexRequestBody(init?.body)).toMatchObject({ prompt_cache_key: sessionId });
      return sseResponse();
    });
    vi.stubGlobal("fetch", fetchMock);

    await stream(CODEX_MODEL, TEXT_CONTEXT, {
      apiKey: mockToken(),
      sessionId,
      transport: "sse",
    }).result();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("omits SSE cache affinity when cacheRetention is none", async () => {
    let capturedHeaders: Headers | undefined;
    let capturedBody: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL, init?: RequestInit) => {
        capturedHeaders = new Headers(init?.headers);
        capturedBody = decodeCodexRequestBody(init?.body);
        return sseResponse();
      }),
    );

    await stream(CODEX_MODEL, TEXT_CONTEXT, {
      apiKey: mockToken(),
      cacheRetention: "none",
      sessionId: "one-off-summary",
      transport: "sse",
    }).result();

    expect(capturedHeaders?.has("session-id")).toBe(false);
    expect(capturedHeaders?.has("x-client-request-id")).toBe(false);
    expect(capturedBody).not.toHaveProperty("prompt_cache_key");
  });

  it("clamps cache affinity in the headers and body to 64 characters", async () => {
    const sessionId = "x".repeat(67);
    let capturedHeaders: Headers | undefined;
    let capturedBody: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL, init?: RequestInit) => {
        capturedHeaders = new Headers(init?.headers);
        capturedBody = decodeCodexRequestBody(init?.body);
        return sseResponse();
      }),
    );

    await stream(CODEX_MODEL, TEXT_CONTEXT, {
      apiKey: mockToken(),
      transport: "sse",
      sessionId,
    }).result();

    const clampedSessionId = "x".repeat(64);
    expect(capturedHeaders?.get("session-id")).toBe(clampedSessionId);
    expect(capturedHeaders?.get("x-client-request-id")).toBe(clampedSessionId);
    expect(capturedBody).toMatchObject({ prompt_cache_key: clampedSessionId });
  });

  it("preserves gpt-5.5 xhigh reasoning effort from simple options", async () => {
    let requestedPayload: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL, init?: RequestInit) => {
        requestedPayload = decodeCodexRequestBody(init?.body);
        return sseResponse();
      }),
    );
    const model = {
      ...CODEX_MODEL,
      id: "gpt-5.5",
      name: "GPT-5.5",
      thinkingLevelMap: { xhigh: "xhigh" },
    } satisfies Model<"openai-codex-responses">;

    await streamSimple(model, TEXT_CONTEXT, {
      apiKey: mockToken(),
      reasoning: "xhigh",
      transport: "sse",
    }).result();

    expect(requestedPayload).toMatchObject({ reasoning: { effort: "xhigh", summary: "auto" } });
  });

  it("forwards required tool choice", async () => {
    let requestedPayload: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL, init?: RequestInit) => {
        requestedPayload = decodeCodexRequestBody(init?.body);
        return sseResponse();
      }),
    );

    await stream(
      CODEX_MODEL,
      {
        messages: [{ role: "user", content: "Respond with text instead.", timestamp: 1 }],
        tools: [
          {
            name: "ping",
            description: "Ping",
            parameters: Type.Object({ value: Type.String() }),
          },
        ],
      },
      { apiKey: mockToken(), transport: "sse", toolChoice: "required" },
    ).result();

    expect(requestedPayload).toMatchObject({ tool_choice: "required" });
  });

  it("sets Codex strict mode explicitly and honors constrained sampling", async () => {
    let requestedPayload: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse()),
    );

    await stream(
      CODEX_MODEL,
      {
        messages: [{ role: "user", content: "Use a tool", timestamp: 1 }],
        tools: [
          {
            name: "optional",
            description: "Optional constrained sampling",
            parameters: Type.Object({ value: Type.String() }),
            constrainedSampling: false,
          },
          {
            name: "strict",
            description: "Strict constrained sampling",
            parameters: Type.Object({ value: Type.String() }, { additionalProperties: false }),
            constrainedSampling: { type: "json_schema", strict: "prefer" },
          },
        ],
      },
      {
        apiKey: mockToken(),
        transport: "sse",
        onPayload: (payload) => {
          requestedPayload = payload;
        },
      },
    ).result();

    expect(requestedPayload).toMatchObject({
      tools: [
        { type: "function", name: "optional", strict: null },
        { type: "function", name: "strict", strict: true },
      ],
    });
  });

  it("uses the model capability map for minimal reasoning", async () => {
    let requestedPayload: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL, init?: RequestInit) => {
        requestedPayload = decodeCodexRequestBody(init?.body);
        return sseResponse();
      }),
    );
    const model = {
      ...CODEX_MODEL,
      id: "model-with-minimal-reasoning",
      thinkingLevelMap: { minimal: "low" },
    } satisfies Model<"openai-codex-responses">;

    await stream(model, TEXT_CONTEXT, {
      apiKey: mockToken(),
      reasoningEffort: "minimal",
      transport: "sse",
    }).result();

    expect(requestedPayload).toMatchObject({ reasoning: { effort: "low", summary: "auto" } });
  });

  it.each([
    ["gpt-5.1-codex", "flex", 0.5],
    ["gpt-5.1-codex", "priority", 2],
    ["gpt-5.5", "flex", 0.5],
    ["gpt-5.5", "priority", 2.5],
  ] satisfies ReadonlyArray<readonly [string, "flex" | "priority", number]>)(
    "prices %s %s service-tier usage from the requested tier when Codex echoes default",
    async (modelId, serviceTier, multiplier) => {
      const terminalEvent = {
        type: "response.completed",
        response: {
          status: "completed",
          service_tier: "default",
          usage: {
            input_tokens: 1_000_000,
            output_tokens: 1_000_000,
            total_tokens: 2_000_000,
            input_tokens_details: { cached_tokens: 0 },
          },
        },
      };
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => sseResponse(`data: ${JSON.stringify(terminalEvent)}\n\n`)),
      );
      const model = {
        ...CODEX_MODEL,
        id: modelId,
        name: modelId,
        cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
      } satisfies Model<"openai-codex-responses">;

      const result = await stream(model, TEXT_CONTEXT, {
        apiKey: mockToken(),
        serviceTier,
        transport: "sse",
      }).result();

      expect(result.usage.cost.input).toBe(multiplier);
      expect(result.usage.cost.output).toBe(2 * multiplier);
      expect(result.usage.cost.total).toBe(3 * multiplier);
    },
  );

  it("omits session affinity when sessionId is not provided", async () => {
    const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.has("session-id")).toBe(false);
      expect(headers.has("session_id")).toBe(false);
      expect(headers.has("x-client-request-id")).toBe(false);
      return sseResponse();
    });
    vi.stubGlobal("fetch", fetchMock);

    await stream(CODEX_MODEL, TEXT_CONTEXT, {
      apiKey: mockToken(),
      transport: "sse",
    }).result();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("forwards auto transport from streamSimple options and uses cached websocket context", async () => {
    const token = mockToken();
    const sentBodies: unknown[] = [];
    let capturedWebSocketHeaders: Record<string, string> | undefined;

    const fetchMock = vi.fn(async () => new Response("unexpected fetch", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    class MockWebSocket {
      private listeners = new Map<string, Set<(event: unknown) => void>>();

      constructor(
        _url: string,
        protocols?: string | string[] | { headers?: Record<string, string> },
      ) {
        if (protocols && typeof protocols === "object" && !Array.isArray(protocols)) {
          capturedWebSocketHeaders = protocols.headers;
        }
        queueMicrotask(() => this.dispatch("open", {}));
      }

      addEventListener(type: string, listener: (event: unknown) => void): void {
        let listeners = this.listeners.get(type);
        if (!listeners) {
          listeners = new Set();
          this.listeners.set(type, listeners);
        }
        listeners.add(listener);
      }

      removeEventListener(type: string, listener: (event: unknown) => void): void {
        this.listeners.get(type)?.delete(listener);
      }

      send(data: string): void {
        sentBodies.push(parseJson(data));
        const events = [
          {
            type: "response.output_item.added",
            item: {
              type: "message",
              id: "msg_1",
              role: "assistant",
              status: "in_progress",
              content: [],
            },
          },
          { type: "response.content_part.added", part: { type: "output_text", text: "" } },
          { type: "response.output_text.delta", delta: "Hello" },
          {
            type: "response.output_item.done",
            item: {
              type: "message",
              id: "msg_1",
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text: "Hello" }],
            },
          },
          {
            type: "response.completed",
            response: {
              status: "completed",
              end_turn: false,
              usage: {
                input_tokens: 5,
                output_tokens: 3,
                total_tokens: 8,
                input_tokens_details: { cached_tokens: 0 },
              },
            },
          },
        ];
        queueMicrotask(() => {
          for (const event of events) {
            this.dispatch("message", { data: JSON.stringify(event) });
          }
        });
      }

      close(): void {}

      private dispatch(type: string, event: unknown): void {
        for (const listener of this.listeners.get(type) ?? []) {
          listener(event);
        }
      }
    }

    vi.stubGlobal("WebSocket", MockWebSocket);

    const model = CODEX_MODEL;
    const context = TEXT_CONTEXT;

    const result = await streamSimple(model, context, {
      apiKey: token,
      sessionId: "session-auto",
      transport: "auto",
    }).result();

    expect(result.endTurn).toBe(false);
    expect(sentBodies).toHaveLength(1);
    expect(capturedWebSocketHeaders?.["session-id"]).toBe("session-auto");
    expect(capturedWebSocketHeaders?.session_id).toBeUndefined();
    expect(capturedWebSocketHeaders?.["x-client-request-id"]).toBe("session-auto");
    expect(global.fetch).not.toHaveBeenCalled();
    expect(getOpenAICodexWebSocketDebugStats("session-auto")).toMatchObject({
      cachedContextRequests: 1,
      fullContextRequests: 1,
    });
  });

  it("accepts a terminal websocket frame that finishes decoding after the socket closes", async () => {
    const token = mockToken();

    class MockWebSocket {
      static OPEN = 1;
      static CLOSED = 3;
      readyState = MockWebSocket.OPEN;
      private listeners = new Map<string, Set<(event: unknown) => void>>();

      constructor() {
        queueMicrotask(() => this.dispatch("open", {}));
      }

      addEventListener(type: string, listener: (event: unknown) => void): void {
        let listeners = this.listeners.get(type);
        if (!listeners) {
          listeners = new Set();
          this.listeners.set(type, listeners);
        }
        listeners.add(listener);
      }

      removeEventListener(type: string, listener: (event: unknown) => void): void {
        this.listeners.get(type)?.delete(listener);
      }

      send(): void {
        const encoded = new TextEncoder().encode(
          JSON.stringify({
            type: "response.completed",
            response: {
              id: "resp_1",
              status: "completed",
              usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 },
            },
          }),
        );
        const payload = new ArrayBuffer(encoded.byteLength);
        new Uint8Array(payload).set(encoded);

        queueMicrotask(() => {
          this.dispatch("message", {
            data: {
              arrayBuffer: () =>
                new Promise<ArrayBuffer>((resolve) => {
                  setTimeout(() => resolve(payload), 0);
                }),
            },
          });
          this.readyState = MockWebSocket.CLOSED;
          this.dispatch("close", { code: 1006, reason: "Connection ended", wasClean: false });
        });
      }

      close(): void {
        this.readyState = MockWebSocket.CLOSED;
      }

      private dispatch(type: string, event: unknown): void {
        for (const listener of this.listeners.get(type) ?? []) listener(event);
      }
    }

    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unexpected fetch", { status: 500 })),
    );

    const model = CODEX_MODEL;

    const result = await stream(
      model,
      { systemPrompt: "", messages: [] },
      {
        apiKey: token,
        sessionId: "terminal-close-race",
        transport: "auto",
      },
    ).result();

    expect(result.stopReason).toBe("stop");
    expect(result.responseId).toBe("resp_1");
    expect(global.fetch).not.toHaveBeenCalled();
    expect(getOpenAICodexWebSocketDebugStats("terminal-close-race")).toMatchObject({
      connectionsCreated: 1,
      websocketFailures: 0,
      sseFallbacks: 0,
    });
  });

  it("scopes cached websockets to the authenticated account", async () => {
    // Regression for #7284: rotating accounts must not reuse a socket authenticated by another account.
    const connectedHeaders: Record<string, string>[] = [];
    let responseId = 0;

    class MockWebSocket {
      static OPEN = 1;
      readyState = MockWebSocket.OPEN;
      private listeners = new Map<string, Set<(event: unknown) => void>>();

      constructor(
        _url: string,
        protocols?: string | string[] | { headers?: Record<string, string> },
      ) {
        const headers =
          protocols && typeof protocols === "object" && !Array.isArray(protocols)
            ? protocols.headers
            : undefined;
        connectedHeaders.push(headers ?? {});
        queueMicrotask(() => this.dispatch("open", {}));
      }

      addEventListener(type: string, listener: (event: unknown) => void): void {
        let listeners = this.listeners.get(type);
        if (!listeners) {
          listeners = new Set();
          this.listeners.set(type, listeners);
        }
        listeners.add(listener);
      }

      removeEventListener(type: string, listener: (event: unknown) => void): void {
        this.listeners.get(type)?.delete(listener);
      }

      send(): void {
        queueMicrotask(() => {
          this.dispatch("message", {
            data: JSON.stringify({
              type: "response.completed",
              response: {
                id: `resp_${++responseId}`,
                status: "completed",
                usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
              },
            }),
          });
        });
      }

      close(): void {
        this.readyState = 3;
      }

      private dispatch(type: string, event: unknown): void {
        for (const listener of this.listeners.get(type) ?? []) listener(event);
      }
    }

    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unexpected fetch", { status: 500 })),
    );

    const context: Context = { systemPrompt: "", messages: [] };

    await stream(CODEX_MODEL, context, {
      apiKey: mockToken("account-a"),
      sessionId: "shared-session",
      transport: "websocket-cached",
    }).result();
    await stream(CODEX_MODEL, context, {
      apiKey: mockToken("account-b"),
      sessionId: "shared-session",
      transport: "websocket-cached",
    }).result();
    await stream(CODEX_MODEL, context, {
      apiKey: mockToken("account-a"),
      sessionId: "shared-session",
      transport: "websocket-cached",
    }).result();

    expect(connectedHeaders.map((headers) => headers["chatgpt-account-id"])).toEqual([
      "account-a",
      "account-b",
    ]);
    expect(connectedHeaders.map((headers) => headers.authorization)).toEqual([
      `Bearer ${mockToken("account-a")}`,
      `Bearer ${mockToken("account-b")}`,
    ]);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(getOpenAICodexWebSocketDebugStats("shared-session")).toMatchObject({
      connectionsCreated: 2,
      connectionsReused: 1,
    });
  });

  it("closes one-shot websockets when cacheRetention is none", async () => {
    const token = mockToken();
    const sentBodies: unknown[] = [];
    let connections = 0;
    let closedConnections = 0;

    class MockWebSocket {
      private listeners = new Map<string, Set<(event: unknown) => void>>();

      constructor() {
        connections++;
        queueMicrotask(() => this.dispatch("open", {}));
      }

      addEventListener(type: string, listener: (event: unknown) => void): void {
        let listeners = this.listeners.get(type);
        if (!listeners) {
          listeners = new Set();
          this.listeners.set(type, listeners);
        }
        listeners.add(listener);
      }

      removeEventListener(type: string, listener: (event: unknown) => void): void {
        this.listeners.get(type)?.delete(listener);
      }

      send(data: string): void {
        sentBodies.push(parseJson(data));
        queueMicrotask(() => {
          this.dispatch("message", {
            data: JSON.stringify({
              type: "response.completed",
              response: {
                id: `resp_${connections}`,
                status: "completed",
                usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 },
              },
            }),
          });
        });
      }

      close(): void {
        closedConnections++;
      }

      private dispatch(type: string, event: unknown): void {
        for (const listener of this.listeners.get(type) ?? []) {
          listener(event);
        }
      }
    }

    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unexpected fetch", { status: 500 })),
    );

    const options = {
      apiKey: token,
      cacheRetention: "none",
      sessionId: "one-off-summary",
      transport: "auto",
    } satisfies Parameters<typeof stream>[2];

    await stream(CODEX_MODEL, TEXT_CONTEXT, options).result();
    await stream(CODEX_MODEL, TEXT_CONTEXT, options).result();

    expect(connections).toBe(2);
    expect(closedConnections).toBe(2);
    expect(sentBodies).toHaveLength(2);
    expect(sentBodies[0]).not.toHaveProperty("prompt_cache_key");
    expect(sentBodies[1]).not.toHaveProperty("prompt_cache_key");
    expect(getOpenAICodexWebSocketDebugStats("one-off-summary")).toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("falls back to SSE when websocket connect does not open before the connect timeout", async () => {
    vi.useFakeTimers();
    const token = mockToken();
    const encoder = new TextEncoder();
    const sse = buildSSEPayload({ status: "completed" });

    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url !== "https://chatgpt.com/backend-api/codex/responses") {
        throw new Error(`Unexpected URL: ${url}`);
      }

      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(sse));
            controller.close();
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    class MockWebSocket {
      private listeners = new Map<string, Set<(event: unknown) => void>>();

      addEventListener(type: string, listener: (event: unknown) => void): void {
        let listeners = this.listeners.get(type);
        if (!listeners) {
          listeners = new Set();
          this.listeners.set(type, listeners);
        }
        listeners.add(listener);
      }

      removeEventListener(type: string, listener: (event: unknown) => void): void {
        this.listeners.get(type)?.delete(listener);
      }

      send(): void {
        throw new Error("send should not be called before websocket open");
      }

      close(): void {}
    }

    vi.stubGlobal("WebSocket", MockWebSocket);

    const model = CODEX_MODEL;
    const context = TEXT_CONTEXT;

    const resultPromise = stream(model, context, {
      apiKey: token,
      sessionId: "ws-connect-timeout",
      transport: "auto",
      timeoutMs: 300_000,
      websocketConnectTimeoutMs: 50,
    }).result();

    await vi.advanceTimersByTimeAsync(50);

    const result = await resultPromise;
    expect(result.content.find((content) => content.type === "text")?.text).toBe("Hello");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getOpenAICodexWebSocketDebugStats("ws-connect-timeout")).toMatchObject({
      websocketFailures: 1,
      sseFallbacks: 1,
      websocketFallbackActive: true,
      lastWebSocketError: "WebSocket connect timeout after 50ms",
    });
  });

  it("reconnects once when the websocket connection limit is reached before output starts", async () => {
    const token = mockToken();
    let connections = 0;

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    class MockWebSocket extends EventTarget {
      private readonly limitReached = connections++ === 0;

      constructor() {
        super();
        queueMicrotask(() => this.dispatchEvent(new Event("open")));
      }

      send(): void {
        const event = this.limitReached
          ? { type: "error", error: { code: "websocket_connection_limit_reached" } }
          : {
              type: "response.completed",
              response: {
                id: "resp_1",
                status: "completed",
                usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 },
              },
            };
        queueMicrotask(() => {
          this.dispatchEvent(Object.assign(new Event("message"), { data: JSON.stringify(event) }));
        });
      }

      close(): void {}
    }

    vi.stubGlobal("WebSocket", MockWebSocket);

    const model = CODEX_MODEL;

    const result = await stream(
      model,
      { systemPrompt: "", messages: [] },
      {
        apiKey: token,
      },
    ).result();

    expect(result.stopReason).toBe("stop");
    expect(connections).toBe(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to SSE when a websocket is idle before the first event", async () => {
    vi.useFakeTimers();
    const token = mockToken();
    const sentBodies: unknown[] = [];
    const encoder = new TextEncoder();
    const sse = buildSSEPayload({ status: "completed" });

    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url !== "https://chatgpt.com/backend-api/codex/responses") {
        throw new Error(`Unexpected URL: ${url}`);
      }

      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(sse));
            controller.close();
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    class MockWebSocket {
      static OPEN = 1;
      readyState = MockWebSocket.OPEN;
      private listeners = new Map<string, Set<(event: unknown) => void>>();

      constructor(
        _url: string,
        _protocols?: string | string[] | { headers?: Record<string, string> },
      ) {
        queueMicrotask(() => this.dispatch("open", {}));
      }

      addEventListener(type: string, listener: (event: unknown) => void): void {
        let listeners = this.listeners.get(type);
        if (!listeners) {
          listeners = new Set();
          this.listeners.set(type, listeners);
        }
        listeners.add(listener);
      }

      removeEventListener(type: string, listener: (event: unknown) => void): void {
        this.listeners.get(type)?.delete(listener);
      }

      send(data: string): void {
        sentBodies.push(parseJson(data));
      }

      close(): void {
        this.readyState = 3;
      }

      private dispatch(type: string, event: unknown): void {
        for (const listener of this.listeners.get(type) ?? []) {
          listener(event);
        }
      }
    }

    vi.stubGlobal("WebSocket", MockWebSocket);

    const model = CODEX_MODEL;
    const context = TEXT_CONTEXT;

    const resultPromise = stream(model, context, {
      apiKey: token,
      sessionId: "ws-idle-before-start",
      transport: "auto",
      timeoutMs: 50,
    }).result();

    await vi.advanceTimersByTimeAsync(0);
    expect(sentBodies).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(50);

    const result = await resultPromise;
    expect(result.content.find((content) => content.type === "text")?.text).toBe("Hello");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getOpenAICodexWebSocketDebugStats("ws-idle-before-start")).toMatchObject({
      websocketFailures: 1,
      sseFallbacks: 1,
      websocketFallbackActive: true,
    });
  });

  it("errors when a websocket is idle after the stream started", async () => {
    vi.useFakeTimers();
    const token = mockToken();

    const fetchMock = vi.fn(async () => new Response("unexpected fetch", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    class MockWebSocket {
      static OPEN = 1;
      readyState = MockWebSocket.OPEN;
      private listeners = new Map<string, Set<(event: unknown) => void>>();

      constructor(
        _url: string,
        _protocols?: string | string[] | { headers?: Record<string, string> },
      ) {
        queueMicrotask(() => this.dispatch("open", {}));
      }

      addEventListener(type: string, listener: (event: unknown) => void): void {
        let listeners = this.listeners.get(type);
        if (!listeners) {
          listeners = new Set();
          this.listeners.set(type, listeners);
        }
        listeners.add(listener);
      }

      removeEventListener(type: string, listener: (event: unknown) => void): void {
        this.listeners.get(type)?.delete(listener);
      }

      send(): void {
        queueMicrotask(() => {
          this.dispatch("message", {
            data: JSON.stringify({
              type: "response.output_item.added",
              item: {
                type: "message",
                id: "msg_1",
                role: "assistant",
                status: "in_progress",
                content: [],
              },
            }),
          });
        });
      }

      close(): void {
        this.readyState = 3;
      }

      private dispatch(type: string, event: unknown): void {
        for (const listener of this.listeners.get(type) ?? []) {
          listener(event);
        }
      }
    }

    vi.stubGlobal("WebSocket", MockWebSocket);

    const model = CODEX_MODEL;
    const context = TEXT_CONTEXT;

    const resultPromise = stream(model, context, {
      apiKey: token,
      transport: "auto",
      timeoutMs: 50,
    }).result();

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(50);

    const result = await resultPromise;
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBe("WebSocket idle timeout after 50ms");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("opens a fresh cached websocket before the backend connection age limit", async () => {
    vi.useFakeTimers();
    const startedAt = new Date("2026-07-03T00:00:00Z");
    vi.setSystemTime(startedAt);
    const token = mockToken();
    const sentConnectionIds: number[] = [];
    let connections = 0;

    class MockWebSocket {
      static OPEN = 1;
      static CLOSED = 3;
      readyState = MockWebSocket.OPEN;
      private readonly connectionId = ++connections;
      private listeners = new Map<string, Set<(event: unknown) => void>>();

      constructor(
        _url: string,
        _protocols?: string | string[] | { headers?: Record<string, string> },
      ) {
        queueMicrotask(() => this.dispatch("open", {}));
      }

      addEventListener(type: string, listener: (event: unknown) => void): void {
        let listeners = this.listeners.get(type);
        if (!listeners) {
          listeners = new Set();
          this.listeners.set(type, listeners);
        }
        listeners.add(listener);
      }

      removeEventListener(type: string, listener: (event: unknown) => void): void {
        this.listeners.get(type)?.delete(listener);
      }

      send(): void {
        sentConnectionIds.push(this.connectionId);
        const responseId = `resp_${this.connectionId}`;
        queueMicrotask(() => {
          this.dispatch("message", {
            data: JSON.stringify({
              type: "response.completed",
              response: {
                id: responseId,
                status: "completed",
                usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 },
              },
            }),
          });
        });
      }

      close(): void {
        this.readyState = MockWebSocket.CLOSED;
      }

      private dispatch(type: string, event: unknown): void {
        for (const listener of this.listeners.get(type) ?? []) {
          listener(event);
        }
      }
    }

    vi.stubGlobal("WebSocket", MockWebSocket);

    const model = CODEX_MODEL;
    const sessionId = "aged-ws-session";
    const firstContext: Context = {
      systemPrompt: "You are a helpful assistant.",
      messages: [{ role: "user", content: "Say hello", timestamp: 1 }],
    };

    const first = await stream(model, firstContext, {
      apiKey: token,
      sessionId,
      transport: "websocket-cached",
    }).result();
    vi.setSystemTime(new Date(startedAt.getTime() + 56 * 60 * 1000));
    const secondContext: Context = {
      systemPrompt: "You are a helpful assistant.",
      messages: [
        ...firstContext.messages,
        first,
        { role: "user", content: "Now finish", timestamp: 2 },
      ],
    };

    await stream(model, secondContext, {
      apiKey: token,
      sessionId,
      transport: "websocket-cached",
    }).result();

    expect(connections).toBe(2);
    expect(sentConnectionIds).toEqual([1, 2]);
    expect(getOpenAICodexWebSocketDebugStats(sessionId)).toMatchObject({
      connectionsCreated: 2,
      connectionsReused: 0,
    });
  });

  it("sends only response input deltas in websocket-cached mode", async () => {
    const token = mockToken();
    const sentBodies: unknown[] = [];

    class MockWebSocket {
      static OPEN = 1;
      readyState = MockWebSocket.OPEN;
      private listeners = new Map<string, Set<(event: unknown) => void>>();

      constructor(
        _url: string,
        _protocols?: string | string[] | { headers?: Record<string, string> },
      ) {
        queueMicrotask(() => this.dispatch("open", {}));
      }

      addEventListener(type: string, listener: (event: unknown) => void): void {
        let listeners = this.listeners.get(type);
        if (!listeners) {
          listeners = new Set();
          this.listeners.set(type, listeners);
        }
        listeners.add(listener);
      }

      removeEventListener(type: string, listener: (event: unknown) => void): void {
        this.listeners.get(type)?.delete(listener);
      }

      send(data: string): void {
        sentBodies.push(parseJson(data));
        const responseId = `resp_${sentBodies.length}`;
        const outputEvents =
          sentBodies.length === 1
            ? [
                {
                  type: "response.output_item.added",
                  item: {
                    type: "custom_tool_call",
                    id: "ctc_1",
                    call_id: "call_1",
                    name: "sample_tool",
                    input: "",
                  },
                },
                { type: "response.custom_tool_call_input.delta", item_id: "ctc_1", delta: "abc" },
                { type: "response.custom_tool_call_input.done", item_id: "ctc_1", input: "abc" },
                {
                  type: "response.output_item.done",
                  item: {
                    type: "custom_tool_call",
                    id: "ctc_1",
                    call_id: "call_1",
                    name: "sample_tool",
                    input: "abc",
                  },
                },
              ]
            : [];
        const events = [
          { type: "response.created", response: { id: responseId } },
          ...outputEvents,
          {
            type: "response.completed",
            response: {
              id: responseId,
              status: "completed",
              usage: {
                input_tokens: 5,
                output_tokens: 3,
                total_tokens: 8,
                input_tokens_details: { cached_tokens: 0 },
              },
            },
          },
        ];
        queueMicrotask(() => {
          for (const event of events) {
            this.dispatch("message", { data: JSON.stringify(event) });
          }
        });
      }

      close(): void {
        this.readyState = 3;
      }

      private dispatch(type: string, event: unknown): void {
        for (const listener of this.listeners.get(type) ?? []) {
          listener(event);
        }
      }
    }

    vi.stubGlobal("WebSocket", MockWebSocket);

    const model: Model<"openai-codex-responses"> = {
      id: "gpt-5.1-codex",
      name: "GPT-5.1 Codex",
      api: "openai-codex-responses",
      provider: "openai-codex",
      baseUrl: "https://chatgpt.com/backend-api",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 400000,
      maxTokens: 128000,
      compat: { supportsOpenAIGrammarTools: true },
    };
    const firstContext: Context = {
      systemPrompt: "You are a helpful assistant.",
      messages: [{ role: "user", content: "Use the tool", timestamp: 1 }],
      tools: [
        {
          name: "sample_tool",
          description: "Sample tool",
          parameters: Type.Object({ payload: Type.String() }),
          constrainedSampling: { type: "grammar", variants: { openai_lark: "start: /[a-z]+/" } },
        },
      ],
    };

    const first = await stream(model, firstContext, {
      apiKey: token,
      sessionId: "session-1",
      transport: "websocket-cached",
    }).result();

    const secondContext: Context = {
      ...firstContext,
      messages: [
        ...firstContext.messages,
        first,
        {
          role: "toolResult",
          toolCallId: "call_1|ctc_1",
          toolName: "sample_tool",
          content: [{ type: "text", text: "real result" }],
          isError: false,
          timestamp: 2,
        },
        { role: "user", content: "Now finish", timestamp: 3 },
      ],
    };
    await stream(model, secondContext, {
      apiKey: token,
      sessionId: "session-1",
      transport: "websocket-cached",
    }).result();

    expect(sentBodies[0]).not.toHaveProperty("previous_response_id");
    expect(sentBodies).toMatchObject([
      {
        store: false,
        input: [{ role: "user", content: [{ type: "input_text", text: "Use the tool" }] }],
      },
      {
        store: false,
        previous_response_id: "resp_1",
        input: [
          { type: "custom_tool_call_output", call_id: "call_1", output: "real result" },
          { role: "user", content: [{ type: "input_text", text: "Now finish" }] },
        ],
      },
    ]);
    expect(getOpenAICodexWebSocketDebugStats("session-1")).toMatchObject({
      requests: 2,
      connectionsCreated: 1,
      connectionsReused: 1,
      cachedContextRequests: 2,
      storeTrueRequests: 0,
      fullContextRequests: 1,
      deltaRequests: 1,
      lastDeltaInputItems: 2,
      lastPreviousResponseId: "resp_1",
    });
  });

  it.each(["websocket", "sse"] satisfies ReadonlyArray<"websocket" | "sse">)(
    "recovers a missing cached websocket continuation via %s",
    async (recoveryTransport) => {
      const token = mockToken();
      const sessionId = `missing-continuation-${recoveryTransport}`;
      const fetchMock = vi.fn(async () => sseResponse());
      vi.stubGlobal("fetch", fetchMock);
      const sentBodies: Array<{ connectionId: number; body: unknown }> = [];
      let connections = 0;

      class MockWebSocket {
        static OPEN = 1;
        static CLOSED = 3;
        readyState = MockWebSocket.OPEN;
        private readonly connectionId = ++connections;
        private listeners = new Map<string, Set<(event: unknown) => void>>();

        constructor(
          _url: string,
          _protocols?: string | string[] | { headers?: Record<string, string> },
        ) {
          queueMicrotask(() => this.dispatch("open", {}));
        }

        addEventListener(type: string, listener: (event: unknown) => void): void {
          let listeners = this.listeners.get(type);
          if (!listeners) {
            listeners = new Set();
            this.listeners.set(type, listeners);
          }
          listeners.add(listener);
        }

        removeEventListener(type: string, listener: (event: unknown) => void): void {
          this.listeners.get(type)?.delete(listener);
        }

        send(data: string): void {
          sentBodies.push({ connectionId: this.connectionId, body: parseJson(data) });
          if (sentBodies.length === 2) {
            this.dispatchEvents([
              {
                type: "codex.rate_limits",
                plan_type: "plus",
                rate_limits: {
                  allowed: true,
                  limit_reached: false,
                  primary: {
                    used_percent: 7,
                    window_minutes: 10080,
                    reset_after_seconds: 556112,
                    reset_at: 1785269351,
                  },
                  secondary: null,
                },
                code_review_rate_limits: null,
                additional_rate_limits: null,
                credits: { has_credits: false, unlimited: false, balance: "0" },
                promo: null,
              },
              {
                type: "error",
                status: 400,
                error: {
                  code: "previous_response_not_found",
                  message: "Previous response with id 'resp_1' not found.",
                  param: "previous_response_id",
                },
              },
            ]);
            return;
          }
          if (sentBodies.length === 3 && recoveryTransport === "sse") {
            queueMicrotask(() => this.dispatch("error", { message: "retry websocket failed" }));
            return;
          }

          const response =
            sentBodies.length === 1
              ? { responseId: "resp_1", messageId: "msg_1", text: "Hello" }
              : { responseId: "resp_2", messageId: "msg_2", text: "Recovered" };
          this.dispatchEvents([
            { type: "response.created", response: { id: response.responseId } },
            {
              type: "response.output_item.added",
              output_index: 0,
              item: {
                type: "message",
                id: response.messageId,
                role: "assistant",
                status: "in_progress",
                content: [],
              },
            },
            {
              type: "response.output_item.done",
              output_index: 0,
              item: {
                type: "message",
                id: response.messageId,
                role: "assistant",
                status: "completed",
                content: [{ type: "output_text", text: response.text }],
              },
            },
            {
              type: "response.completed",
              response: {
                id: response.responseId,
                status: "completed",
                usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 },
              },
            },
          ]);
        }

        close(): void {
          this.readyState = MockWebSocket.CLOSED;
        }

        private dispatchEvents(events: unknown[]): void {
          queueMicrotask(() => {
            for (const event of events) {
              this.dispatch("message", { data: JSON.stringify(event) });
            }
          });
        }

        private dispatch(type: string, event: unknown): void {
          for (const listener of this.listeners.get(type) ?? []) {
            listener(event);
          }
        }
      }

      vi.stubGlobal("WebSocket", MockWebSocket);

      const model = CODEX_MODEL;
      const firstContext: Context = {
        systemPrompt: "You are a helpful assistant.",
        messages: [{ role: "user", content: "Say hello", timestamp: 1 }],
      };

      const first = await stream(model, firstContext, {
        apiKey: token,
        sessionId,
        transport: "websocket-cached",
      }).result();
      const secondContext: Context = {
        systemPrompt: "You are a helpful assistant.",
        messages: [
          ...firstContext.messages,
          first,
          { role: "user", content: "Now finish", timestamp: 2 },
        ],
      };
      const eventTypes: string[] = [];
      const secondStream = stream(model, secondContext, {
        apiKey: token,
        sessionId,
        transport: "websocket-cached",
      });
      for await (const event of secondStream) {
        eventTypes.push(event.type);
      }
      const second = await secondStream.result();

      expect(second.stopReason).toBe("stop");
      expect(second.content.find((content) => content.type === "text")?.text).toBe(
        recoveryTransport === "sse" ? "Hello" : "Recovered",
      );
      expect(eventTypes.filter((type) => type === "start")).toHaveLength(1);
      expect(eventTypes).not.toContain("error");
      expect(connections).toBe(2);
      expect(sentBodies).toHaveLength(3);
      expect(sentBodies.map((body) => body.connectionId)).toEqual([1, 1, 2]);
      expect(sentBodies[1]?.body).toMatchObject({
        previous_response_id: "resp_1",
        input: [{ role: "user", content: [{ type: "input_text", text: "Now finish" }] }],
      });
      const recoveryBody = sentBodies[2]?.body;
      expect(recoveryBody).not.toHaveProperty("previous_response_id");
      if (
        typeof recoveryBody !== "object" ||
        recoveryBody === null ||
        !("input" in recoveryBody) ||
        !Array.isArray(recoveryBody.input)
      ) {
        throw new Error("Expected recovery request input");
      }
      expect(recoveryBody.input).toHaveLength(3);
      expect(recoveryBody.input.at(-1)).toEqual({
        role: "user",
        content: [{ type: "input_text", text: "Now finish" }],
      });
      expect(fetchMock).toHaveBeenCalledTimes(recoveryTransport === "sse" ? 1 : 0);
      expect(getOpenAICodexWebSocketDebugStats(sessionId)).toMatchObject({
        requests: 3,
        connectionsCreated: 2,
        connectionsReused: 1,
        fullContextRequests: 2,
        deltaRequests: 1,
        websocketFailures: recoveryTransport === "sse" ? 1 : 0,
        sseFallbacks: recoveryTransport === "sse" ? 1 : 0,
      });
    },
  );

  it.each([
    ["retry-after-ms", { "content-type": "application/json", "retry-after-ms": "1500" }, 1500],
    ["retry-after seconds", { "content-type": "application/json", "retry-after": "60" }, 60_000],
    [
      "retry-after HTTP date",
      { "content-type": "application/json", "retry-after": "Wed, 13 May 2026 00:00:45 GMT" },
      45_000,
    ],
  ] satisfies ReadonlyArray<readonly [string, Record<string, string>, number]>)(
    "uses %s for SSE retries",
    async (_name, headers, expectedDelay) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-13T00:00:00Z"));
      let codexRequests = 0;

      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          codexRequests++;
          if (codexRequests === 1) {
            return new Response(
              JSON.stringify({ error: { code: "rate_limit_exceeded", message: "rate limited" } }),
              { status: 429, headers },
            );
          }
          return sseResponse();
        }),
      );

      const resultPromise = stream(CODEX_MODEL, TEXT_CONTEXT, {
        apiKey: mockToken(),
        transport: "sse",
        maxRetries: 1,
      }).result();
      await vi.advanceTimersByTimeAsync(0);
      expect(codexRequests).toBe(1);

      await vi.advanceTimersByTimeAsync(expectedDelay - 1);
      expect(codexRequests).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(codexRequests).toBe(2);

      const result = await resultPromise;
      expect(result.content.find((content) => content.type === "text")?.text).toBe("Hello");
    },
  );

  it.each([429, 503])(
    "fails immediately when a %i retry delay exceeds the limit",
    async (status) => {
      const token = mockToken();
      const fetchMock = vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: { code: "temporarily_unavailable", message: "retry later" } }),
            {
              status,
              headers: { "content-type": "application/json", "retry-after": "2" },
            },
          ),
      );
      vi.stubGlobal("fetch", fetchMock);

      const model = CODEX_MODEL;
      const context = TEXT_CONTEXT;

      const result = await stream(model, context, {
        apiKey: token,
        transport: "sse",
        maxRetries: 3,
        maxRetryDelayMs: 1000,
      }).result();

      expect(result.stopReason).toBe("error");
      expect(result.errorMessage).toBe("Server requested 2s retry delay (max: 1s)");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("zstd-compresses SSE request bodies", async () => {
    const token = mockToken();
    let capturedEncoding: string | null = null;
    let capturedBody: RequestInit["body"] | undefined;

    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url !== "https://chatgpt.com/backend-api/codex/responses") {
        throw new Error(`Unexpected URL: ${url}`);
      }
      const headers = new Headers(init?.headers);
      capturedEncoding = headers.get("content-encoding") ?? null;
      capturedBody = init?.body ?? undefined;
      return sseResponse();
    });
    vi.stubGlobal("fetch", fetchMock);

    const model = CODEX_MODEL;

    const largeText = "compress me ".repeat(400);
    await stream(
      model,
      {
        systemPrompt: "You are a helpful assistant.",
        messages: [{ role: "user", content: largeText, timestamp: 1 }],
      },
      { apiKey: token, transport: "sse" },
    ).result();

    expect(capturedEncoding).toBe("zstd");
    if (!(capturedBody instanceof Uint8Array)) {
      throw new Error("Expected a zstd-compressed request body");
    }
    const decoded = parseJson(Buffer.from(zstdDecompressSync(capturedBody)).toString("utf8"));
    expect(decoded).toMatchObject({
      input: [{ content: [{ text: largeText }] }],
    });

    capturedEncoding = null;
    capturedBody = undefined;
    await stream(
      model,
      {
        systemPrompt: "You are a helpful assistant.",
        messages: [{ role: "user", content: "hi", timestamp: 1 }],
      },
      { apiKey: token, transport: "sse" },
    ).result();

    expect(capturedEncoding).toBe("zstd");
    expect(capturedBody).toBeInstanceOf(Uint8Array);
  });

  it("uses exponential backoff across repeated SSE retries without retry headers", async () => {
    vi.useFakeTimers();
    let codexRequests = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        codexRequests++;
        if (codexRequests <= 3) {
          return new Response(
            JSON.stringify({ error: { code: "rate_limit_exceeded", message: "rate limited" } }),
            { status: 429, headers: { "content-type": "application/json" } },
          );
        }
        return sseResponse();
      }),
    );

    const resultPromise = stream(CODEX_MODEL, TEXT_CONTEXT, {
      apiKey: mockToken(),
      transport: "sse",
      maxRetries: 3,
    }).result();
    await vi.advanceTimersByTimeAsync(0);
    expect(codexRequests).toBe(1);

    let expectedRequests = 1;
    for (const delay of [1000, 2000, 4000]) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(codexRequests).toBe(expectedRequests);
      await vi.advanceTimersByTimeAsync(1);
      expectedRequests++;
      expect(codexRequests).toBe(expectedRequests);
    }

    const result = await resultPromise;
    expect(result.content.find((content) => content.type === "text")?.text).toBe("Hello");
    expect(codexRequests).toBe(4);
  });
});
