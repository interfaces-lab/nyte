import assert from "node:assert/strict";
import { afterEach, describe, test } from "vitest";
import { SessionFollower, type SessionUpdate } from "../src/client/session-follow.ts";
import {
  MAIN,
  sessionId,
  type Nyte,
  type SessionEvent,
  type SessionSnapshot,
} from "../src/kernel/sdk/types.ts";

const SESSION = sessionId("follow-test");

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (cause: Error) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  let reject: (cause: Error) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function snapshotAt(input: {
  readonly seq: number;
  readonly tip: string | null;
  readonly model: string;
  readonly estimatedTokens: number;
}): SessionSnapshot {
  return {
    seq: input.seq,
    head: MAIN,
    tip: input.tip,
    session: {
      sessionId: SESSION,
      activation: { kind: "active" },
      createdAt: 0,
      lastActivityAt: 0,
      pinned: false,
      archived: false,
      heads: [{ head: MAIN, tip: input.tip }],
      config: { model: { id: input.model } },
    },
    config: { model: { id: input.model } },
    transcript: [],
    pending: [],
    context: {
      estimatedTokens: input.estimatedTokens,
      usageTokens: 0,
      trailingTokens: 0,
      contextWindow: 1000,
    },
  };
}

function commitEvent(seq: number, oid: string, parent: string | null): SessionEvent {
  return {
    seq,
    kind: "commit",
    head: MAIN,
    item: {
      oid,
      commit: {
        kind: "commit",
        parent,
        at: seq,
        body: { kind: "message", message: { role: "user", content: `m${seq}`, timestamp: seq } },
      },
    },
  };
}

/** A watch that yields whatever is pushed, one batch per push, until aborted. */
class EventSource {
  private waiting: Deferred<readonly SessionEvent[]> | undefined;
  private queued: SessionEvent[] = [];

  push(...events: SessionEvent[]): void {
    if (this.waiting === undefined) {
      this.queued.push(...events);
      return;
    }
    const wake = this.waiting;
    this.waiting = undefined;
    wake.resolve(events);
  }

  async *watch(signal: AbortSignal | undefined): AsyncIterable<SessionEvent> {
    while (!signal?.aborted) {
      if (this.queued.length > 0) {
        const batch = this.queued;
        this.queued = [];
        yield* batch;
        continue;
      }
      const next = deferred<readonly SessionEvent[]>();
      this.waiting = next;
      signal?.addEventListener("abort", () => next.resolve([]), { once: true });
      yield* await next.promise;
    }
  }
}

function unused(): never {
  throw new Error("not scripted");
}

interface Fixture {
  readonly source: EventSource;
  readonly snapshotCalls: number;
  readonly updates: readonly SessionUpdate[];
  readonly errors: readonly Error[];
  readonly follower: SessionFollower;
}

/** Each snapshot call takes the next scripted answer; the first is the initial read. */
function fixture(script: () => Promise<SessionSnapshot | undefined>): Fixture {
  const source = new EventSource();
  const updates: SessionUpdate[] = [];
  const errors: Error[] = [];
  const counter = { snapshotCalls: 0 };
  const nyte: Pick<Nyte, "sessions" | "watch"> = {
    sessions: {
      snapshot: () => {
        counter.snapshotCalls += 1;
        return script();
      },
      create: unused,
      get: unused,
      list: unused,
      rename: unused,
      setPinned: unused,
      setArchived: unused,
      delete: unused,
      configure: unused,
    },
    watch: (input) => source.watch(input.signal),
  };
  const follower = new SessionFollower(nyte, {
    sessionId: SESSION,
    head: MAIN,
    retryMs: 5,
    onUpdate: (update) => updates.push(update),
    onError: (error) => errors.push(error),
  });
  return {
    source,
    get snapshotCalls() {
      return counter.snapshotCalls;
    },
    updates,
    errors,
    follower,
  };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function until(check: () => boolean, ms = 500): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("condition not met in time");
    await settle();
  }
}

describe("SessionFollower metadata refresh", () => {
  const open: SessionFollower[] = [];
  afterEach(() => {
    for (const follower of open.splice(0)) follower.close();
  });

  test("publishes every folded event before one coalesced refresh lands", async () => {
    const initial = snapshotAt({ seq: 0, tip: null, model: "a", estimatedTokens: 10 });
    const pending: Deferred<SessionSnapshot | undefined>[] = [];
    let first = true;
    const f = fixture(() => {
      if (first) {
        first = false;
        return Promise.resolve(initial);
      }
      const next = deferred<SessionSnapshot | undefined>();
      pending.push(next);
      return next.promise;
    });
    open.push(f.follower);
    await f.follower.start();
    assert.equal(f.snapshotCalls, 1);

    f.source.push(
      commitEvent(1, "c1", null),
      commitEvent(2, "c2", "c1"),
      commitEvent(3, "c3", "c2"),
      commitEvent(4, "c4", "c3"),
    );
    await until(() => f.updates.filter((u) => u.kind === "event").length === 4);

    assert.deepEqual(
      f.updates.map((u) => u.kind),
      ["snapshot", "event", "event", "event", "event"],
    );
    assert.equal(f.follower.state?.transcript.tip, "c4");
    assert.equal(f.follower.state?.context.estimatedTokens, 10);
    // The first event starts one read; the rest mark the head dirty behind it.
    assert.equal(f.snapshotCalls, 2);
    assert.equal(pending.length, 1);

    pending[0]?.resolve(snapshotAt({ seq: 4, tip: "c4", model: "b", estimatedTokens: 40 }));
    await until(() => pending.length === 2);
    assert.equal(f.snapshotCalls, 3);
    pending[1]?.resolve(snapshotAt({ seq: 4, tip: "c4", model: "c", estimatedTokens: 44 }));
    await until(() => f.updates.some((u) => u.kind === "metadata"));
    await settle();

    // The first read was overtaken by later commits and is not published; the
    // second applies onto the folded state, never replacing the transcript.
    assert.equal(f.updates.filter((u) => u.kind === "metadata").length, 1);
    assert.equal(f.snapshotCalls, 3);
    const last = f.updates.at(-1);
    assert.equal(last?.kind, "metadata");
    assert.equal(last?.state.transcript.tip, "c4");
    assert.equal(last?.state.seq, 4);
    assert.deepEqual(last?.state.config, { model: { id: "c" } });
    assert.deepEqual(last?.state.info.config, { model: { id: "c" } });
    assert.equal(last?.state.context.estimatedTokens, 44);
    assert.equal(f.follower.state, last?.state);
    assert.deepEqual(f.errors, []);
  });

  test("drops a refresh that lands after resync", async () => {
    const initial = snapshotAt({ seq: 0, tip: null, model: "a", estimatedTokens: 10 });
    const resynced = snapshotAt({ seq: 1, tip: "c1", model: "r", estimatedTokens: 20 });
    const stale = deferred<SessionSnapshot | undefined>();
    let call = 0;
    const f = fixture(() => {
      call += 1;
      if (call === 1) return Promise.resolve(initial);
      if (call === 2) return stale.promise;
      return Promise.resolve(resynced);
    });
    open.push(f.follower);
    await f.follower.start();

    f.source.push(commitEvent(1, "c1", null));
    await until(() => f.snapshotCalls === 2);

    const state = await f.follower.resync();
    assert.deepEqual(state.config, { model: { id: "r" } });
    stale.resolve(snapshotAt({ seq: 1, tip: "c1", model: "stale", estimatedTokens: 99 }));
    await settle();
    await settle();

    assert.equal(f.snapshotCalls, 3);
    assert.equal(
      f.updates.some((u) => u.kind === "metadata"),
      false,
    );
    assert.deepEqual(f.follower.state?.config, { model: { id: "r" } });
    assert.equal(f.follower.state?.context.estimatedTokens, 20);
    assert.deepEqual(f.errors, []);
  });

  test("reports a failed refresh and retries it", async () => {
    const initial = snapshotAt({ seq: 0, tip: null, model: "a", estimatedTokens: 10 });
    let call = 0;
    const f = fixture(() => {
      call += 1;
      if (call === 1) return Promise.resolve(initial);
      if (call === 2) return Promise.reject(new Error("store busy"));
      return Promise.resolve(snapshotAt({ seq: 1, tip: "c1", model: "b", estimatedTokens: 30 }));
    });
    open.push(f.follower);
    await f.follower.start();

    f.source.push(commitEvent(1, "c1", null));
    await until(() => f.updates.some((u) => u.kind === "metadata"));

    assert.deepEqual(
      f.errors.map((e) => e.message),
      ["store busy"],
    );
    assert.equal(f.snapshotCalls, 3);
    assert.deepEqual(
      f.updates.map((u) => u.kind),
      ["snapshot", "event", "metadata"],
    );
    assert.equal(f.follower.state?.transcript.tip, "c1");
    assert.deepEqual(f.follower.state?.config, { model: { id: "b" } });
    assert.equal(f.follower.state?.context.estimatedTokens, 30);
  });
});
