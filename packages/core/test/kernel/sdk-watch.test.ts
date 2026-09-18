import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { setImmediate } from "node:timers/promises";
import type { Api, Model } from "@nyte-ai/ai";
import { test } from "vitest";
import { CursorExpired } from "@nyte-ai/protocol";
import { type EventBody } from "../../src/kernel/model.ts";
import { queueTipRef } from "../../src/kernel/names.ts";
import { createNyte } from "../../src/kernel/sdk/nyte.ts";
import { watchSession, type NoticeListener } from "../../src/kernel/sdk/watch.ts";
import {
  NyteClosed,
  UnknownSession,
  sessionId,
  type SessionEvent,
} from "../../src/kernel/sdk/types.ts";
import type { Session, Store } from "../../src/kernel/store.ts";
import { definePlugin, inlinePlugin } from "../../src/plugins/index.ts";
import type { Diagnostics } from "../../src/plugins/types.ts";
import { message, openSession, openStore, seedHead, user, within } from "./helpers.ts";

const model: Model<Api> = {
  id: "watch-model",
  name: "Watch",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 10_000,
  maxTokens: 1_000,
};

/** Forward the real backend and observe only iterator lifetime and startup. */
function observe(session: Session) {
  const started = Promise.withResolvers<void>();
  let active = 0;
  const wrapped: Session = {
    ...session,
    close: () => session.close(),
    events: {
      append: (...args) => session.events.append(...args),
      read: (...args) => session.events.read(...args),
      last: () => session.events.last(),
      floor: () => session.events.floor(),
      trim: (...args) => session.events.trim(...args),
      async *watch(input) {
        active += 1;
        const iterator = session.events.watch(input)[Symbol.asyncIterator]();
        try {
          let result = iterator.next();
          started.resolve();
          for (;;) {
            const next = await result;
            if (next.done) return;
            yield next.value;
            result = iterator.next();
          }
        } finally {
          await iterator.return?.();
          active -= 1;
        }
      },
    },
  };
  return { session: wrapped, started: started.promise, active: () => active };
}

async function fixture() {
  const store = openStore();
  const session = await store.create();
  let observed: ReturnType<typeof observe> | undefined;
  const forwarding: Store = {
    create: (input) => store.create(input),
    async open(id) {
      const opened = await store.open(id);
      if (id !== session.id) return opened;
      observed = observe(opened);
      return observed.session;
    },
    list: () => store.list(),
    delete: (id) => store.delete(id),
    close: () => store.close(),
  };
  const diagnostics = Promise.withResolvers<Diagnostics>();
  let activations = 0;
  const nyte = await createNyte({
    store: forwarding,
    model,
    models: { getModels: () => [model], getModel: () => model, getAvailable: async () => [model] },
    streamFn: () => {
      throw new Error("Watch must not invoke a provider");
    },
    env: { cwd: "/tmp/watch-fixture" },
    plugins: [
      inlinePlugin(
        definePlugin({
          id: "watch-notices",
          session(api) {
            activations += 1;
            diagnostics.resolve(api.diagnostics);
          },
        }),
      ),
    ],
  });
  const id = sessionId(session.id);
  await nyte.sessions.get({ sessionId: id });
  assert.ok(observed);
  return { nyte, store, session, observed, id, diagnostics, activations: () => activations };
}

async function next(iterator: AsyncIterator<SessionEvent>): Promise<SessionEvent> {
  const result = await within(iterator.next());
  assert.equal(result.done, false);
  if (result.done) assert.fail("Watch ended before the expected event");
  return result.value;
}

async function live(f: Awaited<ReturnType<typeof fixture>>, signal?: AbortSignal) {
  const iterator = f.nyte.watch({ sessionId: f.id, live: true, signal })[Symbol.asyncIterator]();
  assert.equal((await next(iterator)).kind, "synced");
  assert.equal((await next(iterator)).kind, "activation_changed");
  await within(f.observed.started);
  return iterator;
}

async function finish(iterator: AsyncIterator<SessionEvent>) {
  if (iterator.return === undefined) assert.fail("Watch must support early return");
  assert.deepEqual(await within(iterator.return()), { done: true, value: undefined });
}

function durable(message: string): EventBody {
  return { kind: "notice", owner: "durable", level: "info", message };
}

test("sustained plugin notices drain in order while waiting and paused, then durable data arrives", async () => {
  const f = await fixture();
  try {
    await f.nyte.plugins.list({ sessionId: f.id });
    const diagnostics = await f.diagnostics.promise;
    const iterator = await live(f);
    const cursor = await f.session.events.last();
    for (let index = 0; index < 1_000; index += 1) {
      const waiting = iterator.next();
      // Drain generator resume microtasks so this notice reaches an idle waiter.
      await setImmediate();
      diagnostics.notify({ message: `waiting-${index}`, title: "Watch", sound: true });
      const result = await within(waiting);
      assert.deepEqual(result.value, {
        seq: cursor,
        kind: "notification",
        owner: "watch-notices",
        message: `waiting-${index}`,
        title: "Watch",
        sound: true,
      });
    }
    // The generator remains suspended at the last notification yield.
    for (let index = 0; index < 1_000; index += 1) {
      diagnostics.notify({ message: `paused-${index}` });
    }
    for (let index = 0; index < 1_000; index += 1) {
      assert.deepEqual(await next(iterator), {
        seq: cursor,
        kind: "notification",
        owner: "watch-notices",
        message: `paused-${index}`,
        sound: false,
      });
    }
    assert.equal(await f.session.events.last(), cursor);
    await f.session.events.append([durable("after-notices")]);
    assert.deepEqual(await next(iterator), {
      seq: cursor + 1,
      kind: "diagnostic",
      owner: "durable",
      level: "info",
      message: "after-notices",
    });
    await finish(iterator);
    assert.equal(f.observed.active(), 0);
  } finally {
    await f.nyte.close();
  }
});

test.each(["abort", "return", "break"] as const)(
  "%s drains an idle durable read after a notice and preserves later session use",
  async (exit) => {
    const f = await fixture();
    const stop = new AbortController();
    try {
      await f.nyte.plugins.list({ sessionId: f.id });
      const diagnostics = await f.diagnostics.promise;
      const iterator = await live(f, stop.signal);
      diagnostics.notify({ message: "leave" });
      assert.equal((await next(iterator)).kind, "notification");
      assert.equal(f.observed.active(), 1);
      if (exit === "abort") {
        const waiting = iterator.next();
        stop.abort();
        assert.deepEqual(await within(waiting), { done: true, value: undefined });
      } else if (exit === "return") {
        await finish(iterator);
      } else {
        const iterable = { [Symbol.asyncIterator]: () => iterator };
        diagnostics.notify({ message: "break-here" });
        await within(
          (async () => {
            for await (const event of iterable) {
              assert.ok(event.kind === "notification" && event.message === "break-here");
              break;
            }
          })(),
        );
      }
      assert.equal(stop.signal.aborted, exit === "abort");
      assert.equal(getEventListeners(stop.signal, "abort").length, 0);
      assert.equal(f.observed.active(), 0);
      diagnostics.notify({ message: "departed" });
      await f.nyte.sessions.rename({ sessionId: f.id, name: "still usable" });
      assert.equal((await f.nyte.sessions.get({ sessionId: f.id }))?.name, "still usable");
      const fresh = await live(f);
      await f.session.events.append([durable("fresh")]);
      const event = await next(fresh);
      assert.ok(event.kind === "diagnostic" && event.message === "fresh");
      await finish(fresh);
      assert.equal(f.observed.active(), 0);
    } finally {
      stop.abort();
      await f.nyte.close();
    }
  },
);

test("watching does not instantiate plugins; later activation publishes its inventory", async () => {
  const f = await fixture();
  try {
    const iterator = await live(f);
    assert.equal(f.activations(), 0);
    await f.nyte.plugins.list({ sessionId: f.id });
    const event = await next(iterator);
    assert.equal(event.kind, "plugins_changed");
    assert.equal(f.activations(), 1);
    await finish(iterator);
  } finally {
    await f.nyte.close();
  }
});

test("synced follows all equal-seq queue and commit siblings at the captured cursor", async () => {
  const f = await fixture();
  try {
    const before = await f.session.events.last();
    const [first] = await f.session.objects.put([
      { kind: "change", previous: null, body: message(user("queued-1")), at: 1 },
    ]);
    assert.ok(first);
    const [second] = await f.session.objects.put([
      { kind: "change", previous: first, body: message(user("queued-2")), at: 2 },
    ]);
    assert.ok(second);
    await f.session.refs.update([{ name: queueTipRef("main", "queue"), from: null, to: second }], {
      reason: "test",
    });
    const commits = await seedHead(f.session, "main", [
      message(user("one")),
      message(user("two")),
      message(user("three")),
    ]);
    const target = await f.session.events.last();
    const iterator = f.nyte.watch({ sessionId: f.id, afterSeq: before })[Symbol.asyncIterator]();
    const seen: SessionEvent[] = [];
    for (;;) {
      const event = await next(iterator);
      seen.push(event);
      if (event.kind === "synced") break;
    }
    assert.deepEqual(
      seen.map((event) => event.kind),
      [
        "activation_changed",
        "queued",
        "queued",
        "head_moved",
        "commit",
        "commit",
        "commit",
        "synced",
      ],
    );
    assert.deepEqual(
      seen.filter((event) => event.kind === "queued").map((event) => event.item.change),
      [first, second],
    );
    assert.deepEqual(
      seen.filter((event) => event.kind === "commit").map((event) => event.item.oid),
      commits,
    );
    assert.ok(seen.slice(3).every((event) => event.seq === target));
    await f.session.events.append([durable("beyond-target")]);
    const appended = await next(iterator);
    assert.ok(appended.kind === "diagnostic" && appended.message === "beyond-target");
    await finish(iterator);
    const fresh = await live(f);
    await f.session.events.append([durable("live-only")]);
    const liveEvent = await next(fresh);
    assert.ok(liveEvent.kind === "diagnostic" && liveEvent.message === "live-only");
    await finish(fresh);
  } finally {
    await f.nyte.close();
  }
});

test("expired cursors fail before first yield and slow replay expires and drains", async () => {
  const f = await fixture();
  const stop = new AbortController();
  try {
    await f.session.events.append(
      Array.from({ length: 1_024 }, (_, index) => durable(String(index))),
    );
    const iterator = f.nyte
      .watch({ sessionId: f.id, afterSeq: 0, signal: stop.signal })
      [Symbol.asyncIterator]();
    assert.equal((await next(iterator)).kind, "activation_changed");
    assert.equal((await next(iterator)).kind, "fact");
    const floor = (await f.session.events.last()) - 1;
    await f.session.events.trim(floor);
    await assert.rejects(
      within(
        (async () => {
          for (;;) {
            const result = await iterator.next();
            if (result.done) assert.fail("Replay must report expiry");
            assert.notEqual(result.value.kind, "synced");
          }
        })(),
      ),
      CursorExpired,
    );
    assert.equal(f.observed.active(), 0);
    assert.equal(getEventListeners(stop.signal, "abort").length, 0);
    const expired = f.nyte
      .watch({ sessionId: f.id, afterSeq: 0, signal: stop.signal })
      [Symbol.asyncIterator]();
    await assert.rejects(expired.next(), CursorExpired);
    assert.equal(getEventListeners(stop.signal, "abort").length, 0);
    const fresh = await live(f);
    await finish(fresh);
  } finally {
    await f.nyte.close();
  }
});

test.each(["sdk", "session", "store", "delete"] as const)(
  "%s close ends an idle SDK watch",
  async (close) => {
    const f = await fixture();
    const stop = new AbortController();
    try {
      const iterator = await live(f, stop.signal);
      const drain = (async () => {
        try {
          while (!(await iterator.next()).done) {
            // Deletion can deliver its marker before removal, or close first.
          }
        } catch (cause) {
          // Physical removal may win before the pooled handle closes. The
          // backend then reports the missing session instead of a marker.
          assert.equal(close, "delete");
          assert.ok(cause instanceof Error);
          assert.equal(cause.name, "UnknownSession");
          assert.equal(cause.message, `Unknown session: ${f.id}`);
        }
      })();
      if (close === "sdk") await f.nyte.close();
      if (close === "session") await f.observed.session.close();
      if (close === "store") await f.store.close();
      if (close === "delete") {
        await f.nyte.sessions.delete({ sessionId: f.id });
        assert.equal(await f.nyte.sessions.get({ sessionId: f.id }), undefined);
      }
      await within(drain);
      assert.equal(f.observed.active(), 0);
      assert.equal(getEventListeners(stop.signal, "abort").length, 0);
    } finally {
      await f.nyte.close();
    }
  },
);

test("unknown session and closed SDK remain errors before first yield", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      f.nyte
        .watch({ sessionId: sessionId("missing") })
        [Symbol.asyncIterator]()
        .next(),
      UnknownSession,
    );
    await f.nyte.close();
    await assert.rejects(
      f.nyte.watch({ sessionId: f.id })[Symbol.asyncIterator]().next(),
      NyteClosed,
    );
  } finally {
    await f.nyte.close();
  }
});

test("cursor read failure retains identity and removes subscriptions and caller listeners", async () => {
  const session = await openSession();
  const failure = new Error("read failed");
  let subscriptions = 0;
  const stop = new AbortController();
  const observed = observe(session);
  const iterator = watchSession({
    session: {
      ...observed.session,
      events: {
        ...observed.session.events,
        read: async () => {
          throw failure;
        },
      },
    },
    input: { sessionId: sessionId(session.id), signal: stop.signal },
    activation: async () => ({ kind: "inactive" }),
    subscribe: () => {
      subscriptions += 1;
      return () => {
        subscriptions -= 1;
      };
    },
  })[Symbol.asyncIterator]();
  await assert.rejects(iterator.next(), (cause) => cause === failure);
  assert.equal(subscriptions, 0);
  assert.equal(observed.active(), 0);
  assert.equal(getEventListeners(stop.signal, "abort").length, 0);
});

test("activation changes during replay cursor capture are retained in order", async () => {
  const session = await openSession();
  const observed = observe(session);
  let listener: NoticeListener | undefined;
  let resolving = false;
  let changed = false;
  const iterator = watchSession({
    session: {
      ...observed.session,
      events: {
        ...observed.session.events,
        async last() {
          if (resolving && !changed) {
            changed = true;
            await listener?.({ kind: "activation_changed", activation: { kind: "active" } });
          }
          return session.events.last();
        },
      },
    },
    input: { sessionId: sessionId(session.id), live: true },
    activation: async () => {
      resolving = true;
      return { kind: "inactive" };
    },
    subscribe: (next) => {
      listener = next;
      return () => {
        listener = undefined;
      };
    },
  })[Symbol.asyncIterator]();
  assert.equal((await next(iterator)).kind, "synced");
  const replay = await next(iterator);
  const change = await next(iterator);
  assert.deepEqual(
    [replay, change],
    [
      { seq: 0, kind: "activation_changed", activation: { kind: "inactive" } },
      { seq: 0, kind: "activation_changed", activation: { kind: "active" } },
    ],
  );
  await finish(iterator);
  assert.equal(listener, undefined);
  assert.equal(observed.active(), 0);
});

test("cold activation notices retain every transition during resolution", async () => {
  const session = await openSession();
  let listener: NoticeListener | undefined;
  const iterator = watchSession({
    session,
    input: { sessionId: sessionId(session.id), live: true },
    activation: async () => {
      assert.ok(listener);
      await listener({ kind: "activation_changed", activation: { kind: "inactive" } });
      await listener({ kind: "activation_changed", activation: { kind: "active" } });
      return { kind: "active" };
    },
    subscribe: (next) => {
      listener = next;
      return () => {
        listener = undefined;
      };
    },
  })[Symbol.asyncIterator]();
  assert.equal((await next(iterator)).kind, "synced");
  assert.deepEqual(await next(iterator), {
    seq: 0,
    kind: "activation_changed",
    activation: { kind: "inactive" },
  });
  assert.deepEqual(await next(iterator), {
    seq: 0,
    kind: "activation_changed",
    activation: { kind: "active" },
  });
  await session.events.append([durable("after-activation")]);
  const appended = await next(iterator);
  assert.ok(appended.kind === "diagnostic" && appended.message === "after-activation");
  await finish(iterator);
  assert.equal(listener, undefined);
});

test("default replay delivers its full durable history before a consumer breaks on synced", async () => {
  const f = await fixture();
  try {
    const commits = await seedHead(f.session, "main", [
      message(user("first")),
      message(user("second")),
    ]);
    const target = await f.session.events.last();
    const seen: SessionEvent[] = [];
    await within(
      (async () => {
        for await (const event of f.nyte.watch({ sessionId: f.id })) {
          seen.push(event);
          if (event.kind === "synced") break;
        }
      })(),
    );
    assert.deepEqual(
      seen.filter((event) => event.kind === "commit").map((event) => event.item.oid),
      commits,
    );
    assert.deepEqual(
      seen.filter((event) => event.kind === "synced"),
      [{ seq: target, kind: "synced" }],
    );
    assert.equal(seen.at(-1)?.kind, "synced");
    assert.equal(f.observed.active(), 0);
  } finally {
    await f.nyte.close();
  }
});
