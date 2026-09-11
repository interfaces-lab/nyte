import type { ResponseUsage } from "openai/resources/responses/responses.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stream } from "../src/api/openai-codex-responses.ts";
import type { Model } from "../src/types.ts";

const model: Model<"openai-codex-responses"> = {
  id: "gpt-5.4",
  name: "Usage fixture",
  api: "openai-codex-responses",
  provider: "openai-codex",
  baseUrl: "https://codex.test",
  reasoning: true,
  input: ["text"],
  cost: { input: 1_000_000, output: 2_000_000, cacheRead: 3_000_000, cacheWrite: 4_000_000 },
  contextWindow: 400_000,
  maxTokens: 128_000,
};
const apiKey = `test.${Buffer.from(
  JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "usage-fixture" } }),
).toString("base64")}.test`;
const usage = {
  input_tokens: 100,
  output_tokens: 50,
  total_tokens: 150,
  input_tokens_details: { cached_tokens: 30, cache_write_tokens: 10 },
  output_tokens_details: { reasoning_tokens: 20 },
} satisfies ResponseUsage & { input_tokens_details: { cache_write_tokens: number } };
const zeroUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function terminalFrame(type: string, usageJson: string | undefined): string {
  return JSON.stringify({
    type,
    response: {
      id: "resp_usage",
      status:
        type === "response.failed"
          ? "failed"
          : type === "response.incomplete"
            ? "incomplete"
            : "completed",
      output: [],
      end_turn: true,
      service_tier: "default",
      incomplete_details: type === "response.incomplete" ? { reason: "max_output_tokens" } : null,
      error: { code: "server_error", message: "Provider failed after generating tokens" },
      usage: usageJson === undefined ? undefined : "__usage__",
    },
  }).replace('"__usage__"', usageJson ?? "null");
}

async function runFixture(transport: "sse" | "websocket", terminal: string, terminalOnly = false) {
  const frames = terminalOnly
    ? [terminal]
    : [
        JSON.stringify({
          type: "response.output_item.added",
          output_index: 0,
          item: {
            type: "message",
            id: "msg_usage",
            role: "assistant",
            status: "in_progress",
            content: [],
          },
        }),
        JSON.stringify({
          type: "response.output_text.delta",
          output_index: 0,
          delta: "Partial answer",
        }),
        terminal,
      ];
  if (transport === "websocket") {
    class FixtureWebSocket extends EventTarget {
      readyState = 1;
      constructor() {
        super();
        queueMicrotask(() => this.dispatchEvent(new Event("open")));
      }
      send() {
        queueMicrotask(() => {
          for (const data of frames) this.dispatchEvent(new MessageEvent("message", { data }));
        });
      }
      close() {
        this.readyState = 3;
      }
    }
    vi.stubGlobal("WebSocket", FixtureWebSocket);
  }
  const source = stream(
    model,
    { messages: [] },
    {
      apiKey,
      transport,
      serviceTier: "priority",
      fetch: async () => {
        if (transport !== "sse") throw new Error("Unexpected SSE fallback");
        const bytes = new TextEncoder().encode(
          frames.map((frame) => `data: ${frame}\n\n`).join(""),
        );
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              for (let offset = 0; offset < bytes.length; offset += 37) {
                controller.enqueue(bytes.slice(offset, offset + 37));
              }
              controller.close();
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        );
      },
    },
  );
  const eventTypes = [];
  for await (const event of source) eventTypes.push(event.type);
  return { message: await source.result(), eventTypes };
}

afterEach(() => vi.unstubAllGlobals());

for (const transport of ["sse", "websocket"] satisfies ("sse" | "websocket")[]) {
  describe(`${transport} terminal usage`, () => {
    it.each(["response.completed", "response.done", "response.incomplete", "response.failed"])(
      "retains and prices supplied usage on %s",
      async (type) => {
        const result = await runFixture(transport, terminalFrame(type, JSON.stringify(usage)));
        expect(result.message.usage).toEqual({
          input: 60,
          output: 50,
          cacheRead: 30,
          cacheWrite: 10,
          reasoning: 20,
          totalTokens: 150,
          cost: { input: 120, output: 200, cacheRead: 180, cacheWrite: 80, total: 580 },
        });
        expect(result.message.content).toEqual([{ type: "text", text: "Partial answer" }]);
        expect(result.message.responseId).toBe("resp_usage");
        expect(result.message.endTurn).toBe(true);
        expect(result.message.stopReason).toBe(
          type === "response.failed" ? "error" : type === "response.incomplete" ? "length" : "stop",
        );
        if (type === "response.failed") {
          expect(result.message.errorMessage).toBe("Provider failed after generating tokens");
          expect(result.eventTypes).toContain("error");
          expect(result.eventTypes).not.toContain("done");
        }
      },
    );

    it.each([JSON.stringify(usage), '{"input_tokens":-1}'])(
      "reports a failure-only frame without falling back to SSE: %s",
      async (usageJson) => {
        const result = await runFixture(
          transport,
          terminalFrame("response.failed", usageJson),
          true,
        );
        expect(result.message.stopReason).toBe("error");
        expect(result.message.errorMessage).not.toContain("Unexpected SSE fallback");
        expect(result.message.usage.totalTokens).toBe(
          usageJson === JSON.stringify(usage) ? 150 : 0,
        );
        if (transport === "websocket") expect(result.eventTypes).toEqual(["error"]);
      },
    );

    it.each([undefined, "null"])("does not invent absent failed usage: %s", async (usageJson) => {
      const result = await runFixture(transport, terminalFrame("response.failed", usageJson));
      expect(result.message.usage).toEqual(zeroUsage);
      expect(result.message.stopReason).toBe("error");
      expect(result.message.errorMessage).toBe("Provider failed after generating tokens");
    });

    it("accepts explicit zero counts and omitted optional details", async () => {
      const result = await runFixture(
        transport,
        terminalFrame(
          "response.completed",
          '{"input_tokens":0,"output_tokens":0,"total_tokens":0}',
        ),
      );
      expect(result.message.stopReason).toBe("stop");
      expect(result.message.usage).toEqual({ ...zeroUsage, reasoning: 0 });
    });

    for (const field of [
      "input_tokens",
      "output_tokens",
      "total_tokens",
      "cached_tokens",
      "cache_write_tokens",
      "reasoning_tokens",
    ]) {
      it.each(["-1", "1.5", '"7"', "null", "true", "1e400"])(
        `rejects ${field} = %s without recording usage or cost`,
        async (value) => {
          const invalidUsage = JSON.stringify(usage).replace(
            new RegExp(`"${field}":\\d+`),
            `"${field}":${value}`,
          );
          for (const type of ["response.completed", "response.failed"]) {
            const result = await runFixture(transport, terminalFrame(type, invalidUsage));
            expect(result.message.stopReason).toBe("error");
            expect(result.message.errorMessage).toContain(
              "finite non-negative integer token counts",
            );
            expect(result.message.usage).toEqual(zeroUsage);
            expect(result.eventTypes).not.toContain("done");
          }
        },
      );
    }

    it.each([
      '"invalid"',
      "[]",
      '{"input_tokens_details":[]}',
      '{"output_tokens_details":"invalid"}',
    ])("rejects malformed usage containers: %s", async (usageJson) => {
      const result = await runFixture(transport, terminalFrame("response.completed", usageJson));
      expect(result.message.stopReason).toBe("error");
      expect(result.message.errorMessage).toContain("Invalid OpenAI Responses usage");
      expect(result.message.usage).toEqual(zeroUsage);
    });
  });
}
