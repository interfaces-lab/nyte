import { createAssistantMessageEventStream } from "@nyte-ai/ai/utils/event-stream";
import type { AssistantMessageEventStream } from "@nyte-ai/ai/utils/event-stream";
import { asId } from "@nyte-ai/schema";
import type { ModelInfo, ToolOutcome, Usage } from "@nyte-ai/schema";
import type { AssistantMessage } from "@nyte-ai/schema/model";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agentLoop } from "../src/agent/agent-loop.ts";
import type {
  LoopConfig,
  LoopEnd,
  LoopEvent,
  LoopInput,
  LoopRequest,
  LoopResponse,
} from "../src/agent/agent-loop.ts";
import { dev } from "../src/util/dev-log.ts";
import { testModel } from "./fake-models.ts";

type Reply = {
  readonly content?: AssistantMessage["content"];
  readonly stopReason?: "stop" | "length" | "toolUse";
  readonly error?: string;
};

interface Seen {
  readonly requests: LoopRequest[];
  readonly executed: string[];
}

const MODEL = testModel("model");

const INFO: ModelInfo = {
  ref: { provider: MODEL.provider, id: MODEL.id },
  name: MODEL.name,
  reasoning: false,
  thinking: ["off"],
  defaultThinking: "off",
  fast: null,
  contextWindow: MODEL.contextWindow,
  compactAt: MODEL.contextWindow,
  maxOutput: 1_000,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

const OK: ToolOutcome = { kind: "ok", content: [], output: null, parts: [] };

const NONE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: null,
  total: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

afterEach(() => {
  dev.on();
});

function call(id: string, name: string): AssistantMessage["content"][number] {
  return { type: "toolCall", id, name, arguments: {} };
}

function said(text: string): AssistantMessage["content"][number] {
  return { type: "text", text };
}

function buildMessage(content: AssistantMessage["content"]): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: MODEL.api,
    provider: MODEL.provider,
    model: MODEL.id,
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 0,
  };
}

function streamReply(reply: Reply | undefined): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const content = reply?.content ?? [];
  const calls = content.some((block) => block.type === "toolCall");
  const partial = buildMessage(content);

  stream.push({ type: "start", partial });

  for (const [contentIndex, block] of content.entries()) {
    if (block.type === "text") {
      stream.push({ type: "text_start", contentIndex, partial });
      stream.push({ type: "text_delta", contentIndex, delta: block.text, partial });
      stream.push({ type: "text_end", contentIndex, content: block.text, partial });
    }

    if (block.type === "toolCall") {
      stream.push({ type: "toolcall_start", contentIndex, partial });
      stream.push({ type: "toolcall_end", contentIndex, toolCall: block, partial });
    }
  }

  if (reply?.error !== undefined) {
    stream.push({
      type: "error",
      reason: "error",
      error: { ...partial, stopReason: "error", errorMessage: reply.error },
    });

    return stream;
  }

  const stopReason = reply?.stopReason ?? (calls ? "toolUse" : "stop");
  stream.push({ type: "done", reason: stopReason, message: { ...partial, stopReason } });

  return stream;
}

function abortable(signal: AbortSignal): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const partial = buildMessage([said("Hal")]);
  stream.push({ type: "start", partial });
  stream.push({ type: "text_start", contentIndex: 0, partial });
  stream.push({ type: "text_delta", contentIndex: 0, delta: "Hal", partial });

  signal.addEventListener(
    "abort",
    () =>
      stream.push({
        type: "error",
        reason: "aborted",
        error: { ...partial, stopReason: "aborted", errorMessage: "Request was aborted" },
      }),
    { once: true },
  );

  return stream;
}

function respondWith(events: AssistantMessageEventStream): LoopResponse {
  return {
    events,
    settled: events.result().then(() => undefined),
  };
}

function scripted(
  replies: readonly Reply[],
  patch: Partial<LoopConfig> = {},
): { readonly config: LoopConfig; readonly seen: Seen } {
  const queue = [...replies];
  const seen: Seen = { requests: [], executed: [] };

  const config: LoopConfig = {
    attempt: 1,
    retry: { enabled: true, maxRetries: 2, baseDelayMs: 1, maxAgentDelayMs: 5 },
    async prepareRequest(request) {
      seen.requests.push(request);

      return {
        kind: "request",
        request: {
          model: INFO.ref,
          thinking: "off",
          step: "assistant",
          attempt: request.attempt,
          options: { sampling: {}, headers: {} },
        },
        model: MODEL,
        info: INFO,
        context: { messages: [] },
        at: 0,
        usage: () => ({ ...NONE, output: 1, total: 1 }),
      };
    },
    stream: async () => respondWith(streamReply(queue.shift())),
    tools: {
      async execute(toolCall) {
        seen.executed.push(toolCall.name);

        return OK;
      },
    },
    settleResponse: async () => undefined,
    boundary: async () => [],
    ...patch,
  };

  return { config, seen };
}

async function collect(
  config: LoopConfig,
  signal: AbortSignal = new AbortController().signal,
): Promise<{ readonly events: readonly LoopEvent[]; readonly end: LoopEnd }> {
  const loop = agentLoop(config, signal);
  const events: LoopEvent[] = [];

  for await (const event of loop) events.push(event);

  return { events, end: await loop.result() };
}

function kinds(events: readonly LoopEvent[]): readonly string[] {
  return events.map((event) =>
    event.type === "tool_start" || event.type === "tool_end"
      ? `${event.type}:${event.call.name}`
      : event.type,
  );
}

function landed(...deliveries: readonly LoopInput["delivery"][]): readonly LoopInput[] {
  return deliveries.map((delivery, index) => ({
    message: asId(`m${index}`),
    delivery,
    source: { kind: "user" },
  }));
}

describe("agentLoop", () => {
  it("runs a single turn to done: block events, message_end, turn_end, loop_end", async () => {
    const { config, seen } = scripted([{ content: [said("Hello.")] }]);
    const { events, end } = await collect(config);

    expect(kinds(events)).toEqual([
      "turn_start",
      "message_start",
      "message_update",
      "message_update",
      "message_end",
      "turn_end",
      "loop_end",
    ]);
    expect(end).toEqual({ reason: "done", usage: { ...NONE, output: 1, total: 1 } });
    expect(seen.requests.map((request) => request.attempt)).toEqual([1]);
  });

  it("runs a tool batch in order, then prepares a second request", async () => {
    const { config, seen } = scripted([
      { content: [call("a", "read"), call("b", "write")] },
      { content: [said("Done.")] },
    ]);

    const { events, end } = await collect(config);

    expect(seen.executed).toEqual(["read", "write"]);
    expect(kinds(events).filter((kind) => kind.startsWith("tool_"))).toEqual([
      "tool_start:read",
      "tool_end:read",
      "tool_start:write",
      "tool_end:write",
    ]);
    expect(seen.requests.map((request) => request.attempt)).toEqual([1, 1]);
    expect(end.reason).toBe("done");
  });

  it("lands steering after a tool batch and goes on", async () => {
    const boundaries = [landed("steer"), landed()];

    const { config, seen } = scripted(
      [{ content: [call("a", "read")] }, { content: [said("Steered.")] }],
      { boundary: async () => boundaries.shift() ?? [] },
    );

    const { end } = await collect(config);

    expect(seen.requests).toHaveLength(2);
    expect(boundaries).toEqual([]);
    expect(end.reason).toBe("done");
  });

  it("follows up at the stop point only for an input that is not an attach", async () => {
    const boundaries = [landed("attach", "steer"), landed("attach")];

    const { config, seen } = scripted([{ content: [said("One.")] }, { content: [said("Two.")] }], {
      boundary: async () => boundaries.shift() ?? [],
    });

    const { end } = await collect(config);

    expect(seen.requests).toHaveLength(2);
    expect(boundaries).toEqual([]);
    expect(end.reason).toBe("done");
  });

  it("ends parked once the batch ran, every result emitted, no boundary and no second request", async () => {
    let boundaries = 0;

    const { config, seen } = scripted([{ content: [call("a", "wait"), call("b", "read")] }], {
      tools: {
        execute: async (toolCall): Promise<ToolOutcome | { readonly kind: "parked" }> =>
          toolCall.name === "wait" ? { kind: "parked" } : OK,
      },
      boundary: async () => {
        boundaries += 1;

        return [];
      },
    });

    const { events, end } = await collect(config);

    expect(
      events.flatMap((event) =>
        event.type === "tool_end" ? [[event.call.name, event.result.kind]] : [],
      ),
    ).toEqual([
      ["wait", "parked"],
      ["read", "ok"],
    ]);
    expect(kinds(events).slice(-2)).toEqual(["turn_end", "loop_end"]);
    expect(end).toEqual({ reason: "parked", usage: { ...NONE, output: 1, total: 1 } });
    expect([boundaries, seen.requests.length]).toEqual([0, 1]);
  });

  it("stops when the signal aborts: no further call runs", async () => {
    const controller = new AbortController();

    const { config, seen } = scripted([{ content: [call("a", "first"), call("b", "second")] }], {
      tools: {
        async execute(toolCall) {
          seen.executed.push(toolCall.name);
          controller.abort();

          return OK;
        },
      },
    });

    const { events, end } = await collect(config, controller.signal);

    expect(seen.executed).toEqual(["first"]);
    expect(end).toEqual({ reason: "stopped", response: null });
    expect(events.at(-1)).toEqual({ type: "loop_end", end: { reason: "stopped", response: null } });
  });

  it("ends stopped when the signal aborts mid-stream, through the stream's own aborted end", async () => {
    const controller = new AbortController();

    const { config, seen } = scripted([], {
      stream: async (_prepared, signal) => respondWith(abortable(signal)),
      settleResponse: async () => {
        throw new Error("No response finished.");
      },
    });

    const loop = agentLoop(config, controller.signal);
    const events: LoopEvent[] = [];

    for await (const event of loop) {
      events.push(event);

      if (event.type === "message_update") controller.abort();
    }

    expect(await loop.result()).toMatchObject({
      reason: "stopped",
      response: { usage: { output: 1 } },
    });
    expect(kinds(events)).not.toContain("message_end");
    expect(seen.requests).toHaveLength(1);
  });

  it("ends stopped after an abort during settleResponse: at the next call, or at the next request", async () => {
    const calling = new AbortController();

    const called = scripted([{ content: [call("a", "read")] }], {
      settleResponse: async () => {
        calling.abort();
      },
    });

    expect((await collect(called.config, calling.signal)).end).toEqual({
      reason: "stopped",
      response: null,
    });
    expect(called.seen.executed).toEqual([]);

    const asking = new AbortController();

    const continued = scripted([{ content: [said("One.")] }], {
      settleResponse: async () => {
        asking.abort();
      },
      boundary: async () => landed("steer"),
    });

    expect((await collect(continued.config, asking.signal)).end).toEqual({
      reason: "stopped",
      response: null,
    });
    expect(continued.seen.requests).toHaveLength(1);
  });

  it("fails on a stream error that is not retried, without message_end", async () => {
    const { config } = scripted([{ content: [said("Half")], error: "Invalid API key" }]);
    const { events, end } = await collect(config);

    expect(kinds(events)).not.toContain("message_end");
    expect(end).toMatchObject({ reason: "failed", failure: { message: "Invalid API key" } });
  });

  it("retries a retryable failure at the next attempt after turn_retry, then succeeds", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });

    try {
      const { config, seen } = scripted([
        { content: [said("Half")], error: "503 Service Unavailable" },
        { content: [said("Whole.")] },
      ]);

      const { events, end } = await collect(config);
      const retry = events.find((event) => event.type === "turn_retry");

      expect(retry).toMatchObject({ attempt: 2, failure: { class: "overloaded" } });
      expect(seen.requests.map((request) => request.attempt)).toEqual([1, 2]);
      expect(end.reason).toBe("done");
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits out the provider's retry-after, and fails at once when it asks for longer than the policy waits", async () => {
    const limited = "429 Too Many Requests: server requested 0.2s retry delay";

    const within = scripted([{ error: limited }, { content: [said("Whole.")] }], {
      retry: { enabled: true, maxRetries: 2, baseDelayMs: 1, maxAgentDelayMs: 1_000 },
    });

    const started = Date.now();
    const { events, end } = await collect(within.config);
    const retry = events.find((event) => event.type === "turn_retry");

    expect(retry).toMatchObject({ failure: { class: "rate_limit", retryAfterMs: 200 } });
    expect(retry?.type === "turn_retry" ? retry.until - started : 0).toBeGreaterThanOrEqual(200);
    expect(end.reason).toBe("done");

    const beyond = scripted([{ error: limited }, { content: [said("Whole.")] }]);

    expect((await collect(beyond.config)).end).toMatchObject({
      reason: "failed",
      failure: { class: "rate_limit", retryAfterMs: 200 },
    });
    expect(beyond.seen.requests).toHaveLength(1);
  });

  it("fails exhausted credit at once, though the provider answers it with 429", async () => {
    const { config, seen } = scripted([
      { error: '429 {"type":"error","error":{"type":"extra_usage_out_of_credits"}}' },
      { content: [said("Whole.")] },
    ]);

    expect((await collect(config)).end).toMatchObject({
      reason: "failed",
      failure: { class: "quota" },
    });
    expect(seen.requests).toHaveLength(1);
  });

  it("hands a context overflow to the next prepareRequest, then retries once it is prepared; a second overflow fails", async () => {
    const overflow = "prompt is too long: 213462 tokens > 200000 maximum";

    const { config, seen } = scripted([
      { error: overflow },
      { content: [said("Fits.")] },
      { error: overflow },
      { error: overflow },
    ]);

    const { events, end } = await collect(config);

    expect(
      seen.requests.map((request) => [request.attempt, request.overflow?.class ?? null]),
    ).toEqual([
      [1, null],
      [2, "context_window"],
    ]);
    expect(kinds(events).slice(0, 4)).toEqual([
      "turn_start",
      "turn_start",
      "turn_retry",
      "message_start",
    ]);
    expect(end.reason).toBe("done");

    const again = scripted([{ error: overflow }, { error: overflow }]);

    expect((await collect(again.config)).end).toMatchObject({
      reason: "failed",
      failure: { class: "context_window" },
    });
    expect(again.seen.requests).toHaveLength(2);
  });

  it("fails a stream that ends without done or error as a provider failure, never stopped (D7, A F15)", async () => {
    const { config, seen } = scripted([], {
      async stream() {
        const events = streamReply({ content: [said("Half")] });
        const unfinished = createAssistantMessageEventStream();

        for await (const event of events) {
          if (event.type === "done") break;
          unfinished.push(event);
        }

        unfinished.end();

        return respondWith(unfinished);
      },
    });

    const { events, end } = await collect(config);

    expect(end).toEqual({
      reason: "failed",
      failure: { class: "provider", message: "The response ended without a result." },
      response: null,
    });
    expect(kinds(events)).not.toContain("turn_retry");
    expect(seen.requests).toHaveLength(1);
  });

  it("carries the failed request's model info on turn_retry, so the turn can charge it (D6)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });

    try {
      const { config } = scripted([
        { content: [said("Half")], error: "503 Service Unavailable" },
        { content: [said("Whole.")] },
      ]);

      const retry = (await collect(config)).events.find((event) => event.type === "turn_retry");

      expect(retry).toMatchObject({ response: { usage: { total: 1 }, prepared: { info: INFO } } });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("dev log (§46)", () => {
  it("writes one DEV line per call, and nothing once off", () => {
    const lines: string[] = [];
    dev.on((line) => lines.push(line));
    dev("test", "ping", { id: "a", bytes: new Uint8Array(3) });
    dev.off();
    dev("test", "silent", { id: "b" });

    expect(lines).toEqual(['DEV:test ping {"id":"a","bytes":"<3 bytes>"}']);
  });
});
