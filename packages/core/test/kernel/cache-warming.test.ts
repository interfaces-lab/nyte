/**
 * Prompt-cache warming through the SDK: the warm request repeats the request
 * the runner sent, its cost is billed on a chain beside the head and survives
 * a reopen, and the transcript and head tip never move for it.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { createAssistantMessageEventStream, type Api, type Context, type Model } from "@nyte-ai/ai";
import type { AssistantMessage, Usage } from "@nyte-ai/schema";
import type { StreamFn } from "../../src/kernel/loop/types.ts";
import { headRef } from "../../src/kernel/names.ts";
import { usageRef } from "../../src/kernel/sdk/cache-warming.ts";
import { createNyte } from "../../src/kernel/sdk/nyte.ts";
import type { Nyte, SessionId } from "../../src/kernel/sdk/types.ts";
import type { Store } from "../../src/kernel/store.ts";
import type { CacheWarmingMode, CacheWarmingStatus } from "../../src/kernel/cache-warmer.ts";
import { definePlugin, type Plugin } from "../../src/plugins/index.ts";
import { assistant, openStore, storePath, within } from "./helpers.ts";

/** Five-minute pricing with a 10.2 s cache lifetime, so a refresh is due 200 ms after dispatch. */
const model: Model<Api> = {
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
  promptCache: { short: 10.2 },
};

const replyUsage: Usage = {
  input: 0,
  output: 10,
  cacheRead: 100_000,
  cacheWrite: 0,
  totalTokens: 100_010,
  cost: { input: 0, output: 0.00025, cacheRead: 0.05, cacheWrite: 0, total: 0.05025 },
};

const warmUsage: Usage = {
  input: 0,
  output: 1,
  cacheRead: 100_000,
  cacheWrite: 0,
  totalTokens: 100_001,
  cost: { input: 0, output: 0.000025, cacheRead: 0.05, cacheWrite: 0, total: 0.050025 },
};

interface ProviderRequest {
  readonly context: Context;
  readonly maxTokens: number | undefined;
  readonly maxRetries: number | undefined;
  readonly sessionId: string | undefined;
  readonly signal: AbortSignal | undefined;
  readonly end: (text: string) => void;
}

/** Answers warm requests at once; holds real requests until the test ends them. */
function provider() {
  const requests: ProviderRequest[] = [];
  const waiters: ((request: ProviderRequest) => void)[] = [];
  const streamFn: StreamFn = (_model, context, streamOptions) => {
    const stream = createAssistantMessageEventStream();
    let ended = false;
    const request: ProviderRequest = {
      context,
      maxTokens: streamOptions?.maxTokens,
      maxRetries: streamOptions?.maxRetries,
      sessionId: streamOptions?.sessionId,
      signal: streamOptions?.signal,
      end: (text) => {
        if (ended) return;
        ended = true;
        const message: AssistantMessage = {
          ...assistant(text, { usage: streamOptions?.maxTokens === 1 ? warmUsage : replyUsage }),
          api: model.api,
          provider: model.provider,
          model: model.id,
        };
        stream.push({ type: "done", reason: "stop", message });
      },
    };
    requests.push(request);
    waiters.shift()?.(request);

    if (request.maxTokens === 1) request.end("");

    return stream;
  };
  let taken = 0;

  return {
    streamFn,
    requests,
    /** End whatever is still streaming, so a failed assertion cannot hang the close. */
    endAll: () => {
      for (const request of requests) request.end("");
    },
    nextRequest: (): Promise<ProviderRequest> => {
      const arrived = requests[taken];
      taken += 1;

      if (arrived !== undefined) return Promise.resolve(arrived);

      return within(new Promise<ProviderRequest>((resolve) => waiters.push(resolve)));
    },
  };
}

async function open(
  store: Store,
  streamFn: StreamFn,
  cacheWarming: () => CacheWarmingMode,
  plugins: readonly Plugin[] = [],
  catalog: Model<Api>[] = [model],
): Promise<Nyte> {
  return createNyte({
    store,
    streamFn,
    models: {
      getModels: () => catalog,
      getModel: (provider, id) =>
        catalog.find((item) => item.provider === provider && item.id === id),
      getAvailable: async () => catalog,
    },
    model,
    cacheWarming,
    plugins,
    env: { cwd: "/tmp/nowhere" },
  });
}

async function transcript(nyte: Nyte, sessionId: SessionId): Promise<string[]> {
  const turns = await nyte.messages.list({ sessionId });

  return turns.flatMap((turn) =>
    turn.kind === "turn"
      ? turn.parts.flatMap((part) =>
          part.kind === "user"
            ? [`user:${Array.isArray(part.content) ? "…" : part.content}`]
            : part.kind === "assistant"
              ? [`assistant:${part.text}`]
              : [part.kind],
        )
      : [turn.kind],
  );
}

async function until<T>(read: () => Promise<T | undefined>): Promise<T> {
  return within(
    (async () => {
      for (;;) {
        const value = await read();

        if (value !== undefined) return value;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    })(),
  );
}

async function statusWhen(
  nyte: Nyte,
  sessionId: SessionId,
  matches: (status: CacheWarmingStatus) => boolean,
): Promise<CacheWarmingStatus> {
  return until(async () => {
    const status = nyte.cacheWarming.status({ sessionId });

    return matches(status) ? status : undefined;
  });
}

test("a warm request repeats the dispatched request and bills beside the head without moving it", async () => {
  const path = storePath();
  const store = openStore(path);
  const scripted = provider();
  const catalog = [model, { ...model, id: "other-model", name: "Other model" }];
  const nyte = await open(store, scripted.streamFn, () => "streaming", [], catalog);
  const { sessionId: id } = await nyte.sessions.create();
  const inspection = await store.open(id);
  try {
    nyte.attach();
    await nyte.messages.send({ sessionId: id, content: "hi" });
    (await scripted.nextRequest()).end("hello");
    assert.deepEqual(await within(nyte.runs.wait({ sessionId: id })), { kind: "idle" });

    await nyte.messages.send({ sessionId: id, content: "more" });
    const real = await scripted.nextRequest();
    assert.notEqual(real.maxTokens, 1);
    const tipAtRequest = await inspection.refs.read(headRef("main"));
    const scheduled = nyte.cacheWarming.status({ sessionId: id });
    assert.equal(scheduled.state, "scheduled");
    assert.ok(scheduled.decision !== undefined);
    assert.deepEqual(
      {
        ...scheduled.decision,
        warmCost: scheduled.decision.warmCost.toFixed(6),
        expectedSavings: scheduled.decision.expectedSavings.toFixed(6),
      },
      {
        phase: "streaming",
        warmCost: "0.050025",
        missCost: 0.575,
        continuationProbability: 1,
        expectedSavings: "0.524975",
        economicsAvailable: true,
        action: "warm",
      },
    );

    catalog.pop();
    const warm = await scripted.nextRequest();
    assert.equal(warm.maxTokens, 1);
    assert.equal(warm.maxRetries, 0);
    assert.equal(warm.sessionId, id);
    assert.notEqual(warm.signal, real.signal);
    assert.deepEqual(warm.context, real.context);
    assert.deepEqual(
      warm.context.messages.flatMap((message) =>
        message.role === "user" || message.role === "assistant" ? [message.role] : [],
      ),
      ["user", "assistant", "user"],
    );

    const billed = await until(async () => {
      const oid = await inspection.refs.read(usageRef("main"));

      return oid === null ? undefined : inspection.objects.get(oid);
    });
    assert.ok(billed.kind === "commit" && billed.body.kind === "usage");
    assert.equal(billed.parent, null);
    assert.deepEqual(billed.body, {
      kind: "usage",
      operation: "cache_warm",
      provider: "anthropic",
      model: "claude-opus-4-6",
      usage: warmUsage,
    });
    assert.equal(await inspection.refs.read(headRef("main")), tipAtRequest);

    real.end("there");
    assert.deepEqual(await within(nyte.runs.wait({ sessionId: id })), { kind: "idle" });
    const settled = await statusWhen(nyte, id, (status) => status.state === "inactive");
    assert.equal(settled.reason, "agent run settled");
    assert.deepEqual(await transcript(nyte, id), [
      "user:hi",
      "assistant:hello",
      "user:more",
      "assistant:there",
    ]);
    const warmed = scripted.requests.filter((request) => request.maxTokens === 1).length;
    assert.ok(warmed >= 1);
    assert.deepEqual(
      (await nyte.heads.list({ sessionId: id })).map((head) => head.head),
      ["main"],
    );
  } finally {
    scripted.endAll();
    await nyte.close();
    await inspection.close();
    await store.close();
  }

  const reopened = openStore(path);
  const session = await reopened.open(id);
  try {
    const usages = (await session.objects.commits()).flatMap(({ commit }) =>
      commit.body.kind === "usage" ? [commit.body] : [],
    );
    assert.ok(usages.length >= 1);

    for (const usage of usages) {
      assert.deepEqual(usage, {
        kind: "usage",
        operation: "cache_warm",
        provider: "anthropic",
        model: "claude-opus-4-6",
        usage: warmUsage,
      });
    }
    assert.deepEqual(
      (await session.refs.list("refs/heads/")).map((ref) => ref.name),
      [headRef("main")],
    );
    assert.notEqual(await session.refs.read(usageRef("main")), null);
  } finally {
    await session.close();
  }
});

test("a plugin's stop decision ends warming before any request is sent", async () => {
  const store = openStore();
  const scripted = provider();
  const seen: string[] = [];
  const veto = definePlugin({
    id: "veto",
    session(api) {
      api.hook("cache_warming_decision", (event) => {
        seen.push(`${event.phase}:${event.action}:${event.model.modelId}`);

        return { action: "stop" };
      });
    },
  });
  const nyte = await open(store, scripted.streamFn, () => "idle", [veto]);
  const { sessionId: id } = await nyte.sessions.create();
  try {
    nyte.attach();
    await nyte.messages.send({ sessionId: id, content: "hi" });
    (await scripted.nextRequest()).end("hello");
    assert.deepEqual(await within(nyte.runs.wait({ sessionId: id })), { kind: "idle" });
    await nyte.messages.send({ sessionId: id, content: "more" });
    const real = await scripted.nextRequest();
    const stopped = await statusWhen(nyte, id, (status) => status.state === "inactive");
    assert.equal(stopped.reason, "stopped by extension");
    assert.equal(stopped.extensionOverride, true);
    assert.deepEqual(seen, ["streaming:warm:claude-opus-4-6"]);
    real.end("there");
    assert.deepEqual(await within(nyte.runs.wait({ sessionId: id })), { kind: "idle" });
    assert.equal(scripted.requests.length, 2);
  } finally {
    scripted.endAll();
    await nyte.close();
  }
});
