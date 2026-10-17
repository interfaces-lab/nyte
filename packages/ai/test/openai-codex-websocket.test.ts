import { normalizeContext } from "@nyte-ai/schema/model";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stream, streamSimple } from "../src/api/openai-codex-responses.ts";
import { closeOpenAICodexWebSocketSessions } from "../src/api/openai-codex-websocket.ts";
import type { Context, Model } from "../src/types.ts";
import {
  resetCodexStreams,
  mockToken,
  sseResponse,
  CODEX_MODEL,
  TEXT_CONTEXT,
  completed,
  fakeWebSockets,
} from "./openai-codex-fixture.ts";

afterEach(resetCodexStreams);

describe("openai-codex websocket streaming", () => {
  it("forwards auto transport from streamSimple options and continues over the cached websocket", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unexpected fetch", { status: 500 })),
    );
    const { sockets, sent } = fakeWebSockets((socket, _body, index) =>
      socket.emit(completed(`resp_${index}`, { end_turn: false })),
    );
    const options = {
      apiKey: mockToken(),
      sessionId: "session-auto",
      transport: "auto",
    } satisfies Parameters<typeof streamSimple>[2];

    const first = await streamSimple(CODEX_MODEL, normalizeContext(TEXT_CONTEXT), options).result();
    await streamSimple(
      CODEX_MODEL,
      normalizeContext({
        ...TEXT_CONTEXT,
        messages: [
          ...TEXT_CONTEXT.messages,
          first,
          { role: "user", content: "More", timestamp: 2 },
        ],
      }),
      options,
    ).result();

    expect(first.endTurn).toBe(false);
    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.headers?.["session-id"]).toBe("session-auto");
    expect(sockets[0]?.headers?.session_id).toBeUndefined();
    expect(sockets[0]?.headers?.["x-client-request-id"]).toBe("session-auto");
    expect(sent[1]?.body).toMatchObject({ previous_response_id: "resp_1" });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("accepts a terminal websocket frame that finishes decoding after the socket closes", async () => {
    const { sockets } = fakeWebSockets((socket) => {
      const encoded = new TextEncoder().encode(JSON.stringify(completed("resp_1")));
      const payload = new ArrayBuffer(encoded.byteLength);
      new Uint8Array(payload).set(encoded);
      queueMicrotask(() => {
        socket.dispatch("message", {
          data: {
            arrayBuffer: () =>
              new Promise<ArrayBuffer>((resolve) => {
                setTimeout(() => resolve(payload), 0);
              }),
          },
        });
        socket.readyState = 3;
        socket.dispatch("close", { code: 1006, reason: "Connection ended", wasClean: false });
      });
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unexpected fetch", { status: 500 })),
    );

    const result = await stream(CODEX_MODEL, normalizeContext({ systemPrompt: "", messages: [] }), {
      apiKey: mockToken(),
      sessionId: "terminal-close-race",
      transport: "auto",
    }).result();

    expect(result.stopReason).toBe("stop");
    expect(result.responseId).toBe("resp_1");
    expect(sockets).toHaveLength(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("scopes cached websockets to the authenticated account, so a rotated account never reuses another's socket (#7284)", async () => {
    const { sockets, sent } = fakeWebSockets((socket, _body, index) =>
      socket.emit(completed(`resp_${index}`)),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unexpected fetch", { status: 500 })),
    );

    for (const account of ["account-a", "account-b", "account-a"]) {
      await stream(CODEX_MODEL, normalizeContext({ systemPrompt: "", messages: [] }), {
        apiKey: mockToken(account),
        sessionId: "shared-session",
        transport: "websocket-cached",
      }).result();
    }

    expect(sockets.map((socket) => socket.headers?.["chatgpt-account-id"])).toEqual([
      "account-a",
      "account-b",
    ]);
    expect(sockets.map((socket) => socket.headers?.authorization)).toEqual([
      `Bearer ${mockToken("account-a")}`,
      `Bearer ${mockToken("account-b")}`,
    ]);
    expect(sent.map((entry) => entry.socket)).toEqual([1, 2, 1]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("closes one-shot websockets when cacheRetention is none", async () => {
    const { sockets, sent } = fakeWebSockets((socket, _body, index) =>
      socket.emit(completed(`resp_${index}`)),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unexpected fetch", { status: 500 })),
    );

    const options = {
      apiKey: mockToken(),
      cacheRetention: "none",
      sessionId: "one-off-summary",
      transport: "auto",
    } satisfies Parameters<typeof stream>[2];

    await stream(CODEX_MODEL, normalizeContext(TEXT_CONTEXT), options).result();
    await stream(CODEX_MODEL, normalizeContext(TEXT_CONTEXT), options).result();

    expect(sockets).toHaveLength(2);
    expect(sockets.every((socket) => socket.closed)).toBe(true);
    expect(sent).toHaveLength(2);
    expect(sent[0]?.body).not.toHaveProperty("prompt_cache_key");
    expect(sent[1]?.body).not.toHaveProperty("prompt_cache_key");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("falls back to SSE when websocket connect does not open, and stays on SSE for the session", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => sseResponse());
    vi.stubGlobal("fetch", fetchMock);
    const { sockets, sent } = fakeWebSockets(undefined, { opens: false });
    const options = {
      apiKey: mockToken(),
      sessionId: "ws-connect-timeout",
      transport: "auto",
      timeoutMs: 300_000,
      websocketConnectTimeoutMs: 50,
    } satisfies Parameters<typeof stream>[2];

    const first = stream(CODEX_MODEL, normalizeContext(TEXT_CONTEXT), options).result();
    await vi.advanceTimersByTimeAsync(50);

    expect((await first).content.find((content) => content.type === "text")?.text).toBe("Hello");
    expect(sent).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const second = await stream(CODEX_MODEL, normalizeContext(TEXT_CONTEXT), options).result();
    expect(second.stopReason).toBe("stop");
    expect(sockets).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    closeOpenAICodexWebSocketSessions(options.sessionId);
    fakeWebSockets((socket) => socket.emit(completed("resp_after_cleanup", { end_turn: true })));

    const resumed = await stream(CODEX_MODEL, normalizeContext(TEXT_CONTEXT), options).result();

    expect(resumed.stopReason).toBe("stop");
    expect(resumed.endTurn).toBe(true);
  });

  it("reconnects once when the websocket connection limit is reached before output starts", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { sockets } = fakeWebSockets((socket) =>
      socket.emit(
        socket.id === 1
          ? { type: "error", error: { code: "websocket_connection_limit_reached" } }
          : completed("resp_1"),
      ),
    );

    const result = await stream(CODEX_MODEL, normalizeContext({ systemPrompt: "", messages: [] }), {
      apiKey: mockToken(),
    }).result();

    expect(result.stopReason).toBe("stop");
    expect(sockets).toHaveLength(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to SSE when a websocket is idle before the first event", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => sseResponse());
    vi.stubGlobal("fetch", fetchMock);
    const { sent } = fakeWebSockets();

    const resultPromise = stream(CODEX_MODEL, normalizeContext(TEXT_CONTEXT), {
      apiKey: mockToken(),
      sessionId: "ws-idle-before-start",
      transport: "auto",
      timeoutMs: 50,
    }).result();

    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(50);

    const result = await resultPromise;
    expect(result.content.find((content) => content.type === "text")?.text).toBe("Hello");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("errors when a websocket is idle after the stream started", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response("unexpected fetch", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    fakeWebSockets((socket) =>
      socket.emit({
        type: "response.output_item.added",
        item: {
          type: "message",
          id: "msg_1",
          role: "assistant",
          status: "in_progress",
          content: [],
        },
      }),
    );

    const resultPromise = stream(CODEX_MODEL, normalizeContext(TEXT_CONTEXT), {
      apiKey: mockToken(),
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
    const { sockets, sent } = fakeWebSockets((socket) =>
      socket.emit(completed(`resp_${socket.id}`)),
    );
    const options = {
      apiKey: mockToken(),
      sessionId: "aged-ws-session",
      transport: "websocket-cached",
    } satisfies Parameters<typeof stream>[2];

    const first = await stream(CODEX_MODEL, normalizeContext(TEXT_CONTEXT), options).result();
    vi.setSystemTime(new Date(startedAt.getTime() + 56 * 60 * 1000));
    await stream(
      CODEX_MODEL,
      normalizeContext({
        ...TEXT_CONTEXT,
        messages: [
          ...TEXT_CONTEXT.messages,
          first,
          { role: "user", content: "Now finish", timestamp: 2 },
        ],
      }),
      options,
    ).result();

    expect(sockets).toHaveLength(2);
    expect(sent.map((entry) => entry.socket)).toEqual([1, 2]);
  });

  it("sends only response input deltas in websocket-cached mode", async () => {
    const { sent } = fakeWebSockets((socket, _body, index) =>
      socket.emit(
        { type: "response.created", response: { id: `resp_${index}` } },
        ...(index === 1
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
          : []),
        completed(`resp_${index}`),
      ),
    );

    const model: Model<"openai-codex-responses"> = {
      ...CODEX_MODEL,
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

    const first = await stream(model, normalizeContext(firstContext), {
      apiKey: mockToken(),
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
    await stream(model, normalizeContext(secondContext), {
      apiKey: mockToken(),
      sessionId: "session-1",
      transport: "websocket-cached",
    }).result();

    expect(sent.map((entry) => entry.socket)).toEqual([1, 1]);
    expect(sent[0]?.body).not.toHaveProperty("previous_response_id");
    expect(sent.map((entry) => entry.body)).toMatchObject([
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
  });

  it.each(["websocket", "sse"] satisfies ReadonlyArray<"websocket" | "sse">)(
    "recovers a missing cached websocket continuation via %s",
    async (recoveryTransport) => {
      const sessionId = `missing-continuation-${recoveryTransport}`;
      const fetchMock = vi.fn(async () => sseResponse());
      vi.stubGlobal("fetch", fetchMock);
      const { sockets, sent } = fakeWebSockets((socket, _body, index) => {
        if (index === 2) {
          socket.emit(
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
          );
          return;
        }
        if (index === 3 && recoveryTransport === "sse") {
          queueMicrotask(() => socket.dispatch("error", { message: "retry websocket failed" }));
          return;
        }
        const reply =
          index === 1
            ? { responseId: "resp_1", messageId: "msg_1", text: "Hello" }
            : { responseId: "resp_2", messageId: "msg_2", text: "Recovered" };
        socket.emit(
          { type: "response.created", response: { id: reply.responseId } },
          {
            type: "response.output_item.added",
            output_index: 0,
            item: {
              type: "message",
              id: reply.messageId,
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
              id: reply.messageId,
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text: reply.text }],
            },
          },
          completed(reply.responseId),
        );
      });

      const first = await stream(CODEX_MODEL, normalizeContext(TEXT_CONTEXT), {
        apiKey: mockToken(),
        sessionId,
        transport: "websocket-cached",
      }).result();
      const eventTypes: string[] = [];
      const secondStream = stream(
        CODEX_MODEL,
        normalizeContext({
          ...TEXT_CONTEXT,
          messages: [
            ...TEXT_CONTEXT.messages,
            first,
            { role: "user", content: "Now finish", timestamp: 2 },
          ],
        }),
        { apiKey: mockToken(), sessionId, transport: "websocket-cached" },
      );
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
      expect(sockets).toHaveLength(2);
      expect(sent.map((entry) => entry.socket)).toEqual([1, 1, 2]);
      expect(sent[1]?.body).toMatchObject({
        previous_response_id: "resp_1",
        input: [{ role: "user", content: [{ type: "input_text", text: "Now finish" }] }],
      });
      const recoveryBody = sent[2]?.body;
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
    },
  );
});
