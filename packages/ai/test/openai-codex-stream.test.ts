import { normalizeContext } from "@nyte-ai/schema/model";
import { arch, platform, release } from "node:os";
import { zstdDecompressSync } from "node:zlib";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stream, streamSimple } from "../src/api/openai-codex-responses.ts";
import type { Model } from "../src/types.ts";
import {
  resetCodexStreams,
  mockToken,
  parseJson,
  decodeCodexRequestBody,
  buildSSEPayload,
  sseResponse,
  CODEX_MODEL,
  TEXT_CONTEXT,
} from "./openai-codex-fixture.ts";

afterEach(resetCodexStreams);

describe("openai-codex streaming", () => {
  it("sends account-scoped SSE headers and no session affinity without a session", async () => {
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
      expect(headers.has("session-id")).toBe(false);
      expect(headers.has("session_id")).toBe(false);
      expect(headers.has("x-client-request-id")).toBe(false);
      return sseResponse();
    });
    vi.stubGlobal("fetch", fetchMock);

    const resultStream = stream(CODEX_MODEL, normalizeContext(TEXT_CONTEXT), {
      apiKey: token,
      transport: "sse",
    });
    const eventTypes: string[] = [];
    for await (const event of resultStream) {
      eventTypes.push(event.type);
    }

    const result = await resultStream.result();
    expect(result.content.find((content) => content.type === "text")?.text).toBe("Hello");
    expect(eventTypes).toContain("text_delta");
    expect(eventTypes).toContain("done");
  });

  it("processes a terminal SSE event without a trailing blank line", async () => {
    const sse = buildSSEPayload({ status: "completed" }).trimEnd();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(sse)),
    );

    const result = await stream(CODEX_MODEL, normalizeContext(TEXT_CONTEXT), {
      apiKey: mockToken(),
      transport: "sse",
    }).result();

    expect(result.stopReason).toBe("stop");
    expect(result.content.find((content) => content.type === "text")?.text).toBe("Hello");
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
      stream(model, normalizeContext(context), { apiKey: token, transport: "sse" }).result(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Timed out waiting for completed SSE stream")), 1000);
      }),
    ]);

    expect(result.content.find((c) => c.type === "text")?.text).toBe("Hello");
    expect(result.stopReason).toBe("stop");
    expect(result.endTurn).toBe(false);
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

    const result = await stream(model, normalizeContext(context), {
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

    const resultStream = stream(model, normalizeContext(context), {
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

    await stream(CODEX_MODEL, normalizeContext(TEXT_CONTEXT), {
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

    await stream(CODEX_MODEL, normalizeContext(TEXT_CONTEXT), {
      apiKey: mockToken(),
      transport: "sse",
      sessionId,
    }).result();

    const clampedSessionId = "x".repeat(64);
    expect(capturedHeaders?.get("session-id")).toBe(clampedSessionId);
    expect(capturedHeaders?.has("session_id")).toBe(false);
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

    await streamSimple(model, normalizeContext(TEXT_CONTEXT), {
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
      normalizeContext({
        messages: [{ role: "user", content: "Respond with text instead.", timestamp: 1 }],
        tools: [
          {
            name: "ping",
            description: "Ping",
            parameters: Type.Object({ value: Type.String() }),
          },
        ],
      }),
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
      normalizeContext({
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
      }),
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

    await stream(model, normalizeContext(TEXT_CONTEXT), {
      apiKey: mockToken(),
      reasoningEffort: "minimal",
      transport: "sse",
    }).result();

    expect(requestedPayload).toMatchObject({ reasoning: { effort: "low", summary: "auto" } });
  });

  it.each([
    ["gpt-5.1-codex", "flex", 0.5],
    ["gpt-5.1-codex", "priority", 2],
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

      const result = await stream(model, normalizeContext(TEXT_CONTEXT), {
        apiKey: mockToken(),
        serviceTier,
        transport: "sse",
      }).result();

      expect(result.usage.cost.input).toBe(multiplier);
      expect(result.usage.cost.output).toBe(2 * multiplier);
      expect(result.usage.cost.total).toBe(3 * multiplier);
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

      const resultPromise = stream(CODEX_MODEL, normalizeContext(TEXT_CONTEXT), {
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

  it("fails immediately when a 503 retry delay exceeds the limit", async () => {
    const token = mockToken();
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: { code: "temporarily_unavailable", message: "retry later" } }),
          {
            status: 503,
            headers: { "content-type": "application/json", "retry-after": "2" },
          },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await stream(CODEX_MODEL, normalizeContext(TEXT_CONTEXT), {
      apiKey: token,
      transport: "sse",
      maxRetries: 3,
      maxRetryDelayMs: 1000,
    }).result();

    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBe("Server requested 2s retry delay (max: 1s). retry later");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

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
      normalizeContext({
        systemPrompt: "You are a helpful assistant.",
        messages: [{ role: "user", content: largeText, timestamp: 1 }],
      }),
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
  });

  it("uses the shared exponential backoff across repeated SSE retries without retry headers", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
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

    const resultPromise = stream(CODEX_MODEL, normalizeContext(TEXT_CONTEXT), {
      apiKey: mockToken(),
      transport: "sse",
      maxRetries: 3,
    }).result();
    await vi.advanceTimersByTimeAsync(0);
    expect(codexRequests).toBe(1);

    let expectedRequests = 1;
    for (const delay of [500, 1000, 2000]) {
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
