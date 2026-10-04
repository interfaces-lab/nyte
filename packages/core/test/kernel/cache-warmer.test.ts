import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type Api,
  type AssistantMessage,
  type Context,
  createAssistantMessageEventStream,
  type Model,
  type ModelsSimpleStreamOptions,
  type Usage,
} from "@nyte-ai/ai";
import {
  CacheWarmer,
  type CacheWarmingAction,
  type CacheWarmingDecision,
  type CacheWarmingDecisionEvent,
  type CacheWarmingMode,
  type CacheWarmRequest,
  type CacheWarmUsage,
  formatCacheWarmingStatus,
  formatCacheWarmingUsage,
  getCacheWarmingDelayMs,
  getPromptCacheTtlMs,
  isReplayable,
} from "../../src/kernel/cache-warmer.ts";

const adaptiveModel: Model<Api> = {
  id: "claude-opus-4-6",
  name: "Claude Opus 4.6",
  api: "anthropic-messages",
  provider: "anthropic",
  baseUrl: "https://example.invalid",
  reasoning: true,
  input: ["text"],
  cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  contextWindow: 1_000_000,
  maxTokens: 128_000,
  compat: { forceAdaptiveThinking: true },
  promptCache: { short: 300, long: 3600 },
};
const budgetModel: Model<Api> = {
  ...adaptiveModel,
  id: "claude-sonnet-4-5",
  cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  compat: undefined,
};
const openaiModel: Model<Api> = {
  id: "gpt-5",
  name: "GPT-5",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.invalid",
  reasoning: true,
  input: ["text"],
  cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
  contextWindow: 400_000,
  maxTokens: 128_000,
  promptCache: { short: 300, long: 86_400 },
};
const unknownModel: Model<Api> = { ...adaptiveModel, promptCache: undefined };

const warmUsage: Usage = {
  input: 0,
  output: 1,
  cacheRead: 100,
  cacheWrite: 0,
  totalTokens: 101,
  cost: { input: 0, output: 0, cacheRead: 0.01, cacheWrite: 0, total: 0.01 },
};

function response(
  model: Model<Api>,
  stopReason: AssistantMessage["stopReason"] = "length",
): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: warmUsage,
    stopReason,
    timestamp: 0,
  };
}

const requestContext: Context = {
  systemPrompt: "Be brief.",
  messages: [{ role: "user", content: "hi", timestamp: 0 }],
  tools: [
    {
      name: "read",
      description: "Read a file",
      parameters: { type: "object", properties: { path: { type: "string" } } },
    },
  ],
};

function fakeRuntime(
  options: {
    result?: (model: Model<Api>) => Promise<AssistantMessage>;
    decide?: (event: CacheWarmingDecisionEvent) => CacheWarmingAction | Promise<CacheWarmingAction>;
    mode?: CacheWarmingMode;
    promptTokens?: number;
  } = {},
) {
  const calls: Array<{ model: Model<Api>; context: Context; options: ModelsSimpleStreamOptions }> =
    [];
  const events: CacheWarmingDecisionEvent[] = [];
  const appended: CacheWarmUsage[] = [];
  const warmed: CacheWarmUsage[] = [];
  const state = { mode: options.mode ?? "idle", promptTokens: options.promptTokens ?? 100_000 };
  const warmer = new CacheWarmer({
    streamSimple: (model, context, streamOptions) => {
      calls.push({ model, context, options: streamOptions });
      const stream = createAssistantMessageEventStream();
      void (options.result ?? (async (m: Model<Api>) => response(m)))(model).then((message) =>
        stream.end(message),
      );
      return stream;
    },
    promptTokens: () => state.promptTokens,
    appendUsage: async (usage) => {
      await Promise.resolve();
      appended.push(usage);
    },
    getMode: () => state.mode,
    decide: async (event) => {
      events.push(event);
      return options.decide?.(event) ?? event.action;
    },
  });
  warmer.onWarmed = (usage) => {
    if (!appended.includes(usage)) throw new Error("warmed before the usage was persisted");
    warmed.push(usage);
  };
  return { warmer, calls, events, appended, warmed, state };
}

function request(
  model: Model<Api> = adaptiveModel,
  options: ModelsSimpleStreamOptions = {},
): CacheWarmRequest {
  return { model, context: requestContext, options: { cacheRetention: "short", ...options } };
}

const current = () => true;

afterEach(() => vi.useRealTimers());

describe("cache warming", () => {
  it("derives eligibility and timing from retention and provider behavior", () => {
    expect([
      getPromptCacheTtlMs(adaptiveModel, undefined),
      getPromptCacheTtlMs(adaptiveModel, { cacheRetention: "long" }),
      getPromptCacheTtlMs(adaptiveModel, { cacheRetention: "none" }),
      getPromptCacheTtlMs(adaptiveModel, { env: { NYTE_CACHE_RETENTION: "short" } }),
      getPromptCacheTtlMs(openaiModel, { cacheRetention: "long" }),
      getPromptCacheTtlMs(unknownModel, undefined),
    ]).toEqual([3_600_000, 3_600_000, undefined, 300_000, 86_400_000, undefined]);
    expect([
      getCacheWarmingDelayMs(300_000),
      getCacheWarmingDelayMs(60_000),
      getCacheWarmingDelayMs(10_000),
    ]).toEqual([270_000, 50_000, undefined]);
    expect([
      isReplayable(budgetModel, { reasoning: "medium" }),
      isReplayable(budgetModel, undefined),
      isReplayable(adaptiveModel, { reasoning: "medium" }),
      isReplayable(openaiModel, { reasoning: "medium" }),
    ]).toEqual([false, true, true, true]);
  });

  it("replays profitable requests and preserves options across repeated refreshes", async () => {
    vi.useFakeTimers();
    const { warmer, calls, events, appended, warmed } = fakeRuntime();
    const signal = new AbortController().signal;
    const transformHeaders = async () => ({});

    warmer.start(
      request(adaptiveModel, { reasoning: "high", signal, sessionId: "s", transformHeaders }),
      current,
    );
    expect(warmer.status).toMatchObject({ state: "scheduled", nextWarmAt: Date.now() + 270_000 });
    await vi.advanceTimersByTimeAsync(269_999);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);

    expect(calls[0]?.model).toBe(adaptiveModel);
    expect(calls[0]?.context).toEqual(requestContext);
    expect(calls[0]?.options).toEqual({
      cacheRetention: "short",
      reasoning: "high",
      sessionId: "s",
      transformHeaders,
      maxTokens: 1,
      maxRetries: 0,
      signal: calls[0]?.options.signal,
    });
    expect(calls[0]?.options.signal).not.toBe(signal);
    expect(events[0]).toMatchObject({
      type: "cache_warming_decision",
      continuationProbability: 1,
      action: "warm",
    });
    expect(events[0]?.missCost).toBeCloseTo(0.575);
    expect(events[0]?.warmCost).toBeCloseTo(0.050025);
    expect(appended).toEqual([
      {
        operation: "cache_warm",
        provider: "anthropic",
        model: "claude-opus-4-6",
        usage: warmUsage,
      },
    ]);
    expect(warmed).toEqual(appended);

    await vi.advanceTimersByTimeAsync(270_000);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.context).toEqual(requestContext);
    warmer.cancel();
    expect(warmer.status).toEqual({ state: "inactive", reason: "inactive" });
  });

  it("does not issue refreshes after their safe deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { warmer, calls } = fakeRuntime();
    warmer.start(request(), current);

    // A five-minute cache is scheduled for 4m30s and retains 15 seconds of
    // the 30-second expiry margin. Simulate a timer delayed by sleep.
    vi.setSystemTime(285_001);
    await vi.runOnlyPendingTimersAsync();

    expect(calls).toHaveLength(0);
    expect(warmer.status).toMatchObject({
      state: "inactive",
      reason: "cache refresh deadline missed",
    });
  });

  it("rechecks the deadline after an extension decision", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { warmer, calls, events } = fakeRuntime({
      decide: async (): Promise<CacheWarmingAction> => {
        await Promise.resolve();
        vi.setSystemTime(285_001);
        return "warm";
      },
    });
    warmer.start(request(), current);
    await vi.runOnlyPendingTimersAsync();

    expect(events).toHaveLength(1);
    expect(calls).toHaveLength(0);
    expect(warmer.status).toMatchObject({
      state: "inactive",
      reason: "cache refresh deadline missed",
    });
  });

  it("applies economic decisions and extension overrides", async () => {
    vi.useFakeTimers();
    const unprofitable = fakeRuntime({ promptTokens: 5_000 });
    unprofitable.warmer.start(request(), current);
    await vi.advanceTimersByTimeAsync(270_000);
    expect(unprofitable.calls).toHaveLength(0);
    expect(unprofitable.warmer.status).toMatchObject({
      state: "inactive",
      reason: "expected savings below threshold",
      decision: { action: "stop", economicsAvailable: true },
      extensionOverride: false,
    });

    const forced = fakeRuntime({ promptTokens: 5_000, decide: () => "warm" });
    forced.warmer.start(request(), current);
    await vi.advanceTimersByTimeAsync(270_000);
    expect(forced.calls).toHaveLength(1);
    expect(forced.warmed[0]?.note).toBe("extension override");
    forced.warmer.cancel();

    const vetoed = fakeRuntime({ decide: () => "stop" });
    vetoed.warmer.start(request(), current);
    await vi.advanceTimersByTimeAsync(270_000);
    expect(vetoed.calls).toHaveLength(0);
    expect(vetoed.warmer.status).toMatchObject({
      state: "inactive",
      reason: "stopped by extension",
      extensionOverride: true,
    });

    const failing = fakeRuntime({
      decide: (): CacheWarmingAction => {
        throw new Error("plugin failure");
      },
    });
    failing.warmer.start(request(), current);
    await vi.advanceTimersByTimeAsync(270_000);
    expect(failing.calls).toHaveLength(1);
    expect(failing.warmed[0]?.note).toBeUndefined();
    failing.warmer.cancel();

    const unavailable = fakeRuntime({ promptTokens: 0 });
    unavailable.warmer.start(request(), current);
    expect(unavailable.warmer.status).toMatchObject({
      state: "inactive",
      reason: "cache economics unavailable",
    });
    await vi.advanceTimersByTimeAsync(270_000);
    expect(unavailable.calls).toHaveLength(0);
  });

  it("reads the prompt size at decision time", async () => {
    vi.useFakeTimers();
    const runtime = fakeRuntime({ promptTokens: 5_000 });
    runtime.warmer.start(request(), current);
    runtime.state.promptTokens = 100_000;
    await vi.advanceTimersByTimeAsync(270_000);
    expect(runtime.calls).toHaveLength(1);
    expect(runtime.events[0]?.missCost).toBeCloseTo(0.575);
    runtime.warmer.cancel();
  });

  it("stops for unsupported requests, context changes, and mode changes", async () => {
    vi.useFakeTimers();
    const unsupported = fakeRuntime();
    unsupported.state.mode = "off";
    unsupported.warmer.start(request(), current);
    expect(unsupported.warmer.status.reason).toBe("cache warming disabled");
    unsupported.state.mode = "idle";
    unsupported.warmer.start(request(unknownModel), current);
    expect(unsupported.warmer.status.reason).toBe("cache lifetime unavailable");
    unsupported.warmer.start(request(adaptiveModel, { cacheRetention: "none" }), current);
    expect(unsupported.warmer.status.reason).toBe("request disabled prompt caching");
    unsupported.warmer.start(request(budgetModel, { reasoning: "high" }), current);
    expect(unsupported.warmer.status.reason).toBe("request cannot be replayed safely");

    let stillCurrent = true;
    unsupported.warmer.start(request(), () => stillCurrent);
    stillCurrent = false;
    expect(unsupported.warmer.status.reason).toBe("conversation context changed");
    await vi.advanceTimersByTimeAsync(270_000);
    expect(unsupported.calls).toHaveLength(0);

    unsupported.warmer.start(request(), current);
    unsupported.state.mode = "off";
    expect(unsupported.warmer.status.reason).toBe("cache warming disabled");
    await vi.advanceTimersByTimeAsync(270_000);
    expect(unsupported.calls).toHaveLength(0);

    unsupported.state.mode = "idle";
    unsupported.warmer.start(request(), current);
    unsupported.state.mode = "off";
    unsupported.warmer.onModeChanged();
    unsupported.state.mode = "idle";
    expect(unsupported.warmer.status.reason).toBe("cache warming disabled");

    const streaming = fakeRuntime({ mode: "streaming", promptTokens: 400_000 });
    streaming.warmer.start(request(), current);
    streaming.warmer.onAgentSettled();
    expect(streaming.warmer.status.reason).toBe("agent run settled");

    const idle = fakeRuntime({ promptTokens: 400_000 });
    idle.warmer.start(request(), current);
    idle.warmer.onAgentSettled();
    expect(idle.warmer.status).toMatchObject({
      state: "scheduled",
      decision: { phase: "idle", continuationProbability: 0.15 },
    });
    idle.state.mode = "streaming";
    idle.warmer.onModeChanged();
    expect(idle.warmer.status.reason).toBe("agent run settled");
  });

  it("enforces the fixed one-hour and thirty-minute horizons", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const streaming = fakeRuntime({ promptTokens: 400_000 });
    streaming.warmer.start(request(adaptiveModel, { cacheRetention: "long" }), current);
    await vi.advanceTimersByTimeAsync(3_240_000);
    expect(streaming.calls).toHaveLength(1);
    expect(streaming.warmer.status).toMatchObject({
      state: "inactive",
      reason: "one-hour safety limit reached",
    });

    vi.setSystemTime(0);
    const idle = fakeRuntime({ promptTokens: 400_000 });
    idle.warmer.start(request(adaptiveModel, { cacheRetention: "long" }), current);
    idle.warmer.onAgentSettled();
    expect(idle.warmer.status).toMatchObject({
      state: "inactive",
      reason: "30-minute idle safety limit reached",
    });

    vi.setSystemTime(0);
    const short = fakeRuntime({ promptTokens: 400_000 });
    short.warmer.start(request(), current);
    await vi.advanceTimersByTimeAsync(270_000 * 6);
    expect(short.calls).toHaveLength(6);
    short.warmer.onAgentSettled();
    await vi.advanceTimersByTimeAsync(270_000);
    expect(short.calls).toHaveLength(6);
    expect(short.warmer.status).toMatchObject({
      state: "inactive",
      reason: "30-minute idle safety limit reached",
    });
  });

  it("aborts replaced requests and does not record failed refreshes", async () => {
    vi.useFakeTimers();
    const release = Promise.withResolvers<void>();
    const pending = fakeRuntime({
      result: async (model) => {
        await release.promise;
        return response(model);
      },
    });
    pending.warmer.start(request(), current);
    await vi.advanceTimersByTimeAsync(270_000);
    expect(pending.warmer.status.state).toBe("refreshing");
    pending.warmer.start(request(), current);
    expect(pending.calls[0]?.options.signal?.aborted).toBe(true);
    release.resolve();
    pending.warmer.cancel();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(pending.calls).toHaveLength(1);
    expect(pending.appended).toHaveLength(0);

    const failed = fakeRuntime({ result: async (model) => response(model, "error") });
    failed.warmer.start(request(), current);
    await vi.advanceTimersByTimeAsync(270_000);
    expect(failed.appended).toHaveLength(0);
    expect(failed.warmer.status.state).toBe("scheduled");
    await vi.advanceTimersByTimeAsync(270_000);
    expect(failed.calls).toHaveLength(2);
    failed.warmer.cancel();
  });

  it("formats status and usage entries", () => {
    const decision: CacheWarmingDecision = {
      phase: "idle",
      warmCost: 0.013,
      missCost: 0.621,
      continuationProbability: 0.6,
      expectedSavings: 0.36,
      economicsAvailable: true,
      action: "warm",
    };
    expect(formatCacheWarmingStatus({ state: "scheduled", nextWarmAt: 222_000, decision }, 0)).toBe(
      "Decision in 3m 42s (60% continuation probability, expected savings $0.360 >= $0.050 -> warm)",
    );
    expect(formatCacheWarmingStatus({ state: "inactive", reason: "agent run settled" })).toBe(
      "Inactive (agent run settled)",
    );
    const usage = {
      ...warmUsage,
      cost: {
        input: 0.00004,
        output: 0.00005,
        cacheRead: 0.02940725,
        cacheWrite: 0,
        total: 0.02949725,
      },
    };
    expect(formatCacheWarmingUsage({ usage, note: "extension override" })).toBe(
      "Cache warmed (extension override): $0.029497",
    );
  });
});
