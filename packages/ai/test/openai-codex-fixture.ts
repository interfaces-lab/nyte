import { zstdDecompressSync } from "node:zlib";
import { vi } from "vitest";
import { closeOpenAICodexWebSocketSessions } from "../src/api/openai-codex-websocket.ts";
import type { Context, Model } from "../src/types.ts";

export function resetCodexStreams(): void {
  vi.unstubAllGlobals();
  closeOpenAICodexWebSocketSessions();
  vi.useRealTimers();
  vi.restoreAllMocks();
}

export function mockToken(accountId = "acc_test"): string {
  const payload = Buffer.from(
    JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: accountId } }),
    "utf8",
  ).toString("base64");
  return `aaa.${payload}.bbb`;
}

export function parseJson(value: string): unknown {
  const parsed: unknown = JSON.parse(value);
  return parsed;
}

export function decodeCodexRequestBody(body: RequestInit["body"] | undefined): unknown {
  if (typeof body === "string") {
    return parseJson(body);
  }
  if (body instanceof Uint8Array) {
    return parseJson(Buffer.from(zstdDecompressSync(body)).toString("utf8"));
  }
  return undefined;
}

export function buildSSEPayload(options: {
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

export function sseResponse(payload = buildSSEPayload({ status: "completed" })): Response {
  return new Response(payload, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

export const CODEX_MODEL = {
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

export const TEXT_CONTEXT = {
  systemPrompt: "You are a helpful assistant.",
  messages: [{ role: "user", content: "Say hello", timestamp: 1 }],
} satisfies Context;

export const completed = (id: string, response: Record<string, unknown> = {}) => ({
  type: "response.completed",
  response: {
    id,
    status: "completed",
    usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 },
    ...response,
  },
});

export interface FakeSocket {
  readonly id: number;
  readonly headers: Record<string, string> | undefined;
  readonly closed: boolean;
  readyState: number;
  dispatch(type: string, fields?: Record<string, unknown>): void;
  emit(...events: unknown[]): void;
}

export function fakeWebSockets(
  onSend: (socket: FakeSocket, body: unknown, index: number) => void = () => {},
  { opens = true } = {},
) {
  const sockets: FakeSocket[] = [];
  const sent: { socket: number; body: unknown }[] = [];
  class Socket extends EventTarget implements FakeSocket {
    readonly id = sockets.length + 1;
    readonly headers: Record<string, string> | undefined;
    closed = false;
    readyState = 1;

    constructor(_url: string, options?: { headers?: Record<string, string> }) {
      super();
      this.headers = options?.headers;
      sockets.push(this);
      if (opens) queueMicrotask(() => this.dispatch("open"));
    }

    send(data: string): void {
      const body = parseJson(data);
      sent.push({ socket: this.id, body });
      onSend(this, body, sent.length);
    }

    close(): void {
      this.readyState = 3;
      this.closed = true;
    }

    dispatch(type: string, fields: Record<string, unknown> = {}): void {
      this.dispatchEvent(Object.assign(new Event(type), fields));
    }

    emit(...events: unknown[]): void {
      queueMicrotask(() => {
        for (const event of events) this.dispatch("message", { data: JSON.stringify(event) });
      });
    }
  }
  vi.stubGlobal("WebSocket", Socket);
  return { sockets, sent };
}
