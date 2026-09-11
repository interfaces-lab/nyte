import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { test, vi } from "vitest";
import { createAssistantMessageEventStream, type Api, type Model } from "@nyte-ai/ai";
import { Type } from "typebox";
import { createNyte } from "../../src/kernel/sdk/nyte.ts";
import { sessionId } from "../../src/kernel/sdk/types.ts";
import { waitForHead } from "../../src/kernel/sdk/wait.ts";
import { headRef, runRef } from "../../src/kernel/names.ts";
import type { Session, Store } from "../../src/kernel/store.ts";
import { definePlugin, inlinePlugin } from "../../src/plugins/index.ts";
import { ToolWait } from "../../src/types.ts";
import {
  assistant,
  call,
  granted,
  openInProcessStore,
  openSession,
  openStore,
  within,
} from "./helpers.ts";

const model: Model<Api> = {
  id: "wait-model",
  name: "Wait",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 1_000,
};

async function fixture(store: Store = openStore(), existingId?: string) {
  const session = existingId === undefined ? await store.create() : await store.open(existingId);
  const id = sessionId(session.id);
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const providerSignals: AbortSignal[] = [];
  const nyte = await createNyte({
    store,
    model,
    models: { getModels: () => [model], getModel: () => model, getAvailable: async () => [model] },
    env: { cwd: "/tmp/nowhere" },
    plugins: [
      inlinePlugin(
        definePlugin({
          id: "question",
          session(api) {
            api.tools.add((draft) =>
              draft.set("ask", {
                name: "ask",
                description: "Ask a question",
                parameters: Type.Object({}),
                execute: async () => {
                  throw new ToolWait();
                },
                wake: async () => ({
                  kind: "settle",
                  result: {
                    content: [{ type: "text", text: "answered" }],
                    details: {},
                  },
                }),
              }),
            );
          },
        }),
      ),
    ],
    streamFn: (_model, context, options) => {
      if (options?.signal !== undefined) providerSignals.push(options.signal);
      const stream = createAssistantMessageEventStream();
      const tail = context.messages.at(-1);
      const asks = tail?.role === "user" && tail.content === "ask";
      const answer = asks ? assistant("", { calls: [call("question", "ask")] }) : assistant("done");
      started.resolve();
      void release.promise.then(() =>
        stream.push({ type: "done", reason: asks ? "toolUse" : "stop", message: answer }),
      );
      return stream;
    },
  });
  return { nyte, store, session, id, started, release, providerSignals };
}

test("pre-aborted SDK waits cancel even on an empty head and leave no listeners", async () => {
  const { nyte, id, session } = await fixture();
  const stop = new AbortController();
  stop.abort();
  try {
    const cursor = await session.events.last();
    assert.deepEqual(await nyte.runs.wait({ sessionId: id, signal: stop.signal }), {
      kind: "cancelled",
    });
    assert.equal(await session.events.last(), cursor);
    assert.deepEqual(await session.objects.list(), []);
    assert.deepEqual(await session.refs.list(""), []);
    assert.equal(getEventListeners(stop.signal, "abort").length, 0);
  } finally {
    await nyte.close();
  }
});

test("abort after live watch starts closes the watch and lets the provider finish", async () => {
  const { nyte, id, session, started, release, providerSignals } = await fixture();
  const watching = Promise.withResolvers<void>();
  let activeWatches = 0;
  const observed: Session = {
    ...session,
    close: () => session.close(),
    events: {
      append: (...args) => session.events.append(...args),
      read: (...args) => session.events.read(...args),
      last: () => session.events.last(),
      floor: () => session.events.floor(),
      trim: (...args) => session.events.trim(...args),
      async *watch(options) {
        activeWatches += 1;
        try {
          const iterator = session.events.watch(options)[Symbol.asyncIterator]();
          try {
            const next = iterator.next();
            watching.resolve();
            let result = await next;
            while (!result.done) {
              yield result.value;
              result = await iterator.next();
            }
          } finally {
            await iterator.return?.();
          }
        } finally {
          activeWatches -= 1;
        }
      },
    },
  };
  const stop = new AbortController();
  try {
    await nyte.messages.send({ sessionId: id, content: "hello" });
    nyte.attach();
    await within(started.promise);
    const lease = await session.leases.read(headRef("main"));
    assert.ok(lease);
    const preAborted = new AbortController();
    preAborted.abort();
    assert.deepEqual(await nyte.runs.wait({ sessionId: id, signal: preAborted.signal }), {
      kind: "cancelled",
    });
    const waiting = waitForHead(observed, { head: "main", signal: stop.signal });
    await within(watching.promise);
    const sdkStop = new AbortController();
    const sdkWaiting = nyte.runs.wait({ sessionId: id, signal: sdkStop.signal });
    sdkStop.abort();
    assert.deepEqual(await within(sdkWaiting, 250), { kind: "cancelled" });
    assert.equal(getEventListeners(sdkStop.signal, "abort").length, 0);
    stop.abort();
    assert.deepEqual(await within(waiting, 250), { kind: "cancelled" });
    assert.equal(activeWatches, 0);
    assert.equal(getEventListeners(stop.signal, "abort").length, 0);
    assert.equal((await session.leases.read(headRef("main")))?.owner, lease.owner);
    assert.equal((await session.leases.read(headRef("main")))?.fence, lease.fence);
    assert.equal((await nyte.runs.current({ sessionId: id }))?.abortRequested, undefined);
    assert.ok(providerSignals.every((signal) => !signal.aborted));
    release.resolve();
    assert.deepEqual(await within(nyte.runs.wait({ sessionId: id })), { kind: "idle" });
    assert.equal((await nyte.runs.current({ sessionId: id }))?.phase.kind, "done");
  } finally {
    stop.abort();
    release.resolve();
    await nyte.close();
  }
});

test.each(["empty", "done", "waiting"] as const)(
  "abort during %s lease polling clears its timer and preserves the holder",
  async (phase) => {
    // Fake time drives the store's own polling, so the store must share this thread.
    const seed = await fixture(openInProcessStore());
    seed.release.resolve();
    try {
      if (phase !== "empty") {
        await seed.nyte.messages.send({
          sessionId: seed.id,
          content: phase === "waiting" ? "ask" : "hello",
        });
        seed.nyte.attach();
        assert.equal(
          (await within(seed.nyte.runs.wait({ sessionId: seed.id }))).kind,
          phase === "waiting" ? "waiting" : "idle",
        );
      }
    } finally {
      // close awaits runner tasks and their real polling timers before fake time starts.
      await seed.nyte.close();
      await seed.session.close();
    }
    const { nyte, id, session, release } = await fixture(seed.store, seed.id);
    release.resolve();
    try {
      assert.equal(
        (await nyte.runs.current({ sessionId: id }))?.phase.kind,
        phase === "empty" ? undefined : phase,
      );
      const holder = granted(await session.leases.acquire(headRef("main"), 30_000));
      const before = await session.refs.read(runRef("main"));
      const cursor = await session.events.last();
      const stop = new AbortController();
      vi.useFakeTimers();
      try {
        const timers = vi.getTimerCount();
        const waiting = nyte.runs.wait({ sessionId: id, signal: stop.signal });
        await vi.advanceTimersByTimeAsync(0);
        assert.equal(vi.getTimerCount(), timers + 1);
        stop.abort();
        assert.deepEqual(await within(waiting, 250), { kind: "cancelled" });
        assert.equal(vi.getTimerCount(), timers);
        assert.equal(getEventListeners(stop.signal, "abort").length, 0);
        assert.deepEqual(await session.leases.read(headRef("main")), holder);
        assert.equal(await session.refs.read(runRef("main")), before);
        assert.equal(await session.events.last(), cursor);
        assert.equal((await nyte.runs.current({ sessionId: id }))?.abortRequested, undefined);
      } finally {
        stop.abort();
        vi.useRealTimers();
        await session.leases.release(holder);
      }
      if (phase === "waiting") {
        const waiting = (await nyte.sessions.snapshot({ sessionId: id }))?.parked?.find(
          (call) => call.callId === "question",
        );
        assert.ok(waiting);
        assert.equal(
          (
            await nyte.runs.reply({
              sessionId: id,
              callId: "question",
              waitId: waiting.waitId,
              reply: "yes",
            })
          ).kind,
          "signalled",
        );
        nyte.attach();
        assert.deepEqual(await within(nyte.runs.wait({ sessionId: id })), { kind: "idle" });
        assert.equal((await nyte.runs.current({ sessionId: id }))?.phase.kind, "done");
      } else {
        assert.deepEqual(await nyte.runs.wait({ sessionId: id }), { kind: "idle" });
      }
    } finally {
      await nyte.close();
    }
  },
);

test("a settled head removes the waiter's listener without aborting its signal", async () => {
  const session = await openSession();
  const stop = new AbortController();
  assert.deepEqual(await waitForHead(session, { head: "main", signal: stop.signal }), {
    kind: "idle",
  });
  assert.equal(stop.signal.aborted, false);
  assert.equal(getEventListeners(stop.signal, "abort").length, 0);
});

test("a corrupt run remains a failure and removes the waiter's abort listener", async () => {
  const session = await openSession();
  const [oid] = await session.objects.put([{ kind: "blob", value: "not a run" }]);
  assert.ok(oid);
  await session.refs.update([{ name: runRef("main"), from: null, to: oid }], { reason: "test" });
  const stop = new AbortController();
  await assert.rejects(
    waitForHead(session, { head: "main", signal: stop.signal }),
    /Corrupt run ref/u,
  );
  assert.equal(getEventListeners(stop.signal, "abort").length, 0);
});
