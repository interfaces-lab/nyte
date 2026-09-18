import assert from "node:assert/strict";
import { afterEach, describe, test } from "vitest";
import { SessionObserver, type SessionUpdate } from "@nyte-ai/client";
import {
  MAIN,
  sessionId,
  type Nyte,
  type SessionEvent,
  type SessionMetadata,
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

function metadataAt(input: {
  readonly model: string;
  readonly estimatedTokens: number;
  readonly tip?: string | null;
  readonly name?: string;
}): SessionMetadata {
  return {
    session: {
      sessionId: SESSION,
      activation: { kind: "active" },
      createdAt: 0,
      lastActivityAt: 0,
      pinned: false,
      archived: false,
      heads: [{ head: MAIN, tip: input.tip ?? null }],
      config: { model: { id: input.model } },
      ...(input.name === undefined ? {} : { name: input.name }),
    },
    head: MAIN,
    config: { model: { id: input.model } },
    context: {
      estimatedTokens: input.estimatedTokens,
      usageTokens: 0,
      trailingTokens: 0,
      contextWindow: 1000,
    },
  };
}

function snapshotAt(input: {
  readonly seq: number;
  readonly tip: string | null;
  readonly model: string;
  readonly estimatedTokens: number;
}): SessionSnapshot {
  return {
    ...metadataAt(input),
    seq: input.seq,
    tip: input.tip,
    transcript: [],
    pending: [],
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

function headMovedEvent(seq: number, from: string | null, to: string | null): SessionEvent {
  return { seq, kind: "head_moved", head: MAIN, from, to, reason: "rewind" };
}

/** A watch that yields whatever is pushed, one batch per push, until aborted or failed. */
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

  /** The watch currently waiting for events throws; a later watch starts clean. */
  fail(cause: Error): void {
    const wake = this.waiting;
    this.waiting = undefined;
    wake?.reject(cause);
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
  readonly metadataCalls: number;
  /** The `afterSeq` each watch was opened from. */
  readonly watches: readonly (number | undefined)[];
  readonly updates: readonly SessionUpdate[];
  readonly errors: readonly Error[];
  readonly observer: SessionObserver;
  readonly selection: { version: number };
}

/** Each read takes the next scripted answer; the first snapshot is the initial read. */
function fixture(script: {
  readonly snapshot: () => Promise<SessionSnapshot | undefined>;
  readonly metadata?: () => Promise<SessionMetadata | undefined>;
}): Fixture {
  const source = new EventSource();
  const watches: (number | undefined)[] = [];
  const updates: SessionUpdate[] = [];
  const errors: Error[] = [];
  const counter = { snapshotCalls: 0, metadataCalls: 0 };
  const selection = { version: 0 };
  const nyte: Pick<Nyte, "sessions" | "watch"> = {
    sessions: {
      snapshot: () => {
        counter.snapshotCalls += 1;
        return script.snapshot();
      },
      metadata: () => {
        counter.metadataCalls += 1;
        return (script.metadata ?? unused)();
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
    watch: (input) => {
      watches.push("afterSeq" in input ? input.afterSeq : undefined);
      return source.watch(input.signal);
    },
  };
  const observer = new SessionObserver(nyte, {
    sessionId: SESSION,
    head: MAIN,
    retryMs: 5,
    selectionVersion: () => selection.version,
    onError: (error) => errors.push(error),
  });
  observer.subscribe((update) => updates.push(update));
  return {
    source,
    get snapshotCalls() {
      return counter.snapshotCalls;
    },
    get metadataCalls() {
      return counter.metadataCalls;
    },
    watches,
    updates,
    errors,
    observer,
    selection,
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

describe("SessionObserver subscriptions", () => {
  const open: SessionObserver[] = [];
  afterEach(() => {
    for (const observer of open.splice(0)) observer.close();
  });

  test("state is one stable object per update, and unsubscribing stops delivery", async () => {
    const f = fixture({
      snapshot: () =>
        Promise.resolve(snapshotAt({ seq: 0, tip: null, model: "a", estimatedTokens: 10 })),
      metadata: () => Promise.resolve(metadataAt({ model: "a", estimatedTokens: 10 })),
    });
    open.push(f.observer);
    const seen: SessionUpdate[] = [];
    const stop = f.observer.subscribe((update) => seen.push(update));
    const failing = f.observer.subscribe(() => {
      throw new Error("subscriber broke");
    });
    const first = await f.observer.start();
    assert.equal(f.observer.state, first);
    assert.equal(seen[0]?.state, first);
    assert.deepEqual(
      f.errors.map((e) => e.message),
      ["subscriber broke"],
    );
    failing();

    f.source.push(commitEvent(1, "c1", null));
    await until(() => f.observer.state?.transcript.tip === "c1");
    assert.equal(f.observer.state, f.updates.at(-1)?.state);
    assert.notEqual(f.observer.state, first);
    const delivered = (): number => seen.filter((u) => u.kind !== "metadata").length;
    assert.equal(delivered(), 2);

    stop();
    f.source.push(commitEvent(2, "c2", "c1"));
    await until(() => f.observer.state?.transcript.tip === "c2");
    assert.equal(delivered(), 2);
    assert.equal(f.updates.filter((u) => u.kind === "event").length, 2);
    assert.deepEqual(
      f.errors.map((e) => e.message),
      ["subscriber broke"],
    );
  });

  test("a failed first read is retried until a snapshot lands, and start resolves with it", async () => {
    let call = 0;
    const f = fixture({
      snapshot: () => {
        call += 1;
        return call === 1
          ? Promise.reject(new Error("store busy"))
          : Promise.resolve(snapshotAt({ seq: 3, tip: "c3", model: "a", estimatedTokens: 10 }));
      },
    });
    open.push(f.observer);
    const state = await f.observer.start();
    assert.equal(state.seq, 3);
    assert.equal(f.snapshotCalls, 2);
    assert.deepEqual(
      f.errors.map((e) => e.message),
      ["store busy"],
    );
    await until(() => f.watches.length === 1);
    assert.deepEqual(f.watches, [3]);
  });

  test("closing before the first read lands rejects start and drops the read", async () => {
    const pending = deferred<SessionSnapshot | undefined>();
    const f = fixture({ snapshot: () => pending.promise });
    const started = f.observer.start();
    f.observer.close();
    await assert.rejects(started, { message: /stopped before its snapshot/ });
    pending.resolve(snapshotAt({ seq: 1, tip: "c1", model: "a", estimatedTokens: 10 }));
    await settle();
    assert.equal(f.observer.state, undefined);
    assert.deepEqual(f.updates, []);
    await assert.rejects(f.observer.start(), { message: /closed/ });
  });
});

describe("SessionObserver metadata refresh", () => {
  const open: SessionObserver[] = [];
  afterEach(() => {
    for (const observer of open.splice(0)) observer.close();
  });

  test("publishes every folded event before one coalesced narrow read lands", async () => {
    const pending: Deferred<SessionMetadata | undefined>[] = [];
    const f = fixture({
      snapshot: () =>
        Promise.resolve(snapshotAt({ seq: 0, tip: null, model: "a", estimatedTokens: 10 })),
      metadata: () => {
        const next = deferred<SessionMetadata | undefined>();
        pending.push(next);
        return next.promise;
      },
    });
    open.push(f.observer);
    await f.observer.start();
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
    assert.equal(f.observer.state?.transcript.tip, "c4");
    assert.equal(f.observer.state?.context.estimatedTokens, 10);
    // The first event starts one read; the rest mark the head dirty behind it.
    assert.equal(f.metadataCalls, 1);
    assert.equal(pending.length, 1);

    pending[0]?.resolve(metadataAt({ model: "b", estimatedTokens: 40, tip: "c4" }));
    await until(() => pending.length === 2);
    assert.equal(f.metadataCalls, 2);
    pending[1]?.resolve(metadataAt({ model: "c", estimatedTokens: 44, tip: "c4", name: "Named" }));
    await until(() => f.updates.some((u) => u.kind === "metadata"));
    await settle();

    // The first read was overtaken by later commits and is not published; the
    // second applies onto the folded state, never replacing the transcript.
    assert.equal(f.updates.filter((u) => u.kind === "metadata").length, 1);
    assert.equal(f.metadataCalls, 2);
    assert.equal(f.snapshotCalls, 1);
    const last = f.updates.at(-1);
    assert.equal(last?.kind, "metadata");
    assert.equal(last?.selectedVersion, 0);
    assert.equal(last?.state.transcript.tip, "c4");
    assert.equal(last?.state.seq, 4);
    assert.deepEqual(last?.state.config, { model: { id: "c" } });
    assert.deepEqual(last?.state.info.config, { model: { id: "c" } });
    assert.equal(last?.state.info.name, "Named");
    assert.deepEqual(last?.state.info.heads, [{ head: MAIN, tip: "c4" }]);
    assert.equal(last?.state.context.estimatedTokens, 44);
    assert.equal(f.observer.state, last?.state);
    assert.deepEqual(f.errors, []);
  });

  test("text and progress never trigger a read; a rename and a queued or cancelled choice do", async () => {
    const f = fixture({
      snapshot: () =>
        Promise.resolve(snapshotAt({ seq: 0, tip: null, model: "a", estimatedTokens: 10 })),
      metadata: () => Promise.resolve(metadataAt({ model: "a", estimatedTokens: 10, name: "n" })),
    });
    open.push(f.observer);
    await f.observer.start();
    f.source.push(
      { seq: 1, kind: "text_delta", runId: "r", attempt: 0, index: 0, delta: "hi" },
      { seq: 2, kind: "tool_progress", runId: "r", callId: "c", progress: { text: "" } },
    );
    await until(() => f.observer.state?.seq === 2);
    await settle();
    assert.equal(f.metadataCalls, 0);

    f.source.push({ seq: 3, kind: "fact", key: "name", value: "n" });
    await until(() => f.updates.some((u) => u.kind === "metadata"));
    assert.equal(f.metadataCalls, 1);
    assert.equal(f.observer.state?.info.name, "n");

    // Another client's choice reaches the selected inputs through the same narrow read.
    f.source.push({ seq: 4, kind: "config_queued", head: MAIN, change: "choice" });
    await until(() => f.metadataCalls === 2);
    f.source.push({ seq: 5, kind: "queue_cancelled", change: "choice" });
    await until(() => f.metadataCalls === 3);
    await until(() => f.updates.filter((u) => u.kind === "metadata").length === 3);
    assert.equal(f.observer.state?.seq, 5);
    assert.equal(f.updates.at(-1)?.selectedVersion, 0);
  });

  test("refresh applies selected inputs only for the selection version it was asked for", async () => {
    const pending: Deferred<SessionMetadata | undefined>[] = [];
    const f = fixture({
      snapshot: () =>
        Promise.resolve(snapshotAt({ seq: 0, tip: null, model: "a", estimatedTokens: 10 })),
      metadata: () => {
        const next = deferred<SessionMetadata | undefined>();
        pending.push(next);
        return next.promise;
      },
    });
    open.push(f.observer);
    await f.observer.start();
    assert.equal(f.updates[0]?.selectedVersion, 0);

    f.selection.version = 1;
    f.observer.refresh();
    await until(() => pending.length === 1);
    // The user changed the selection again while the read was in flight.
    f.selection.version = 2;
    pending[0]?.resolve(metadataAt({ model: "stale", estimatedTokens: 20 }));
    await until(() => pending.length === 2);
    const first = f.updates.at(-1);
    assert.equal(first?.kind, "metadata");
    assert.equal(first?.selectedVersion, undefined);
    assert.deepEqual(first?.state.info.config, { model: { id: "a" } });
    assert.equal(first?.state.context.estimatedTokens, 20);

    pending[1]?.resolve(metadataAt({ model: "chosen", estimatedTokens: 21 }));
    await until(() => f.updates.filter((u) => u.kind === "metadata").length === 2);
    const second = f.updates.at(-1);
    assert.equal(second?.selectedVersion, 2);
    assert.deepEqual(second?.state.info.config, { model: { id: "chosen" } });
    assert.equal(f.snapshotCalls, 1);
    assert.deepEqual(f.errors, []);
  });

  test("drops a refresh that lands after resync", async () => {
    const initial = snapshotAt({ seq: 0, tip: null, model: "a", estimatedTokens: 10 });
    const resynced = snapshotAt({ seq: 1, tip: "c1", model: "r", estimatedTokens: 20 });
    const stale = deferred<SessionMetadata | undefined>();
    let call = 0;
    const f = fixture({
      snapshot: () => {
        call += 1;
        return Promise.resolve(call === 1 ? initial : resynced);
      },
      metadata: () => stale.promise,
    });
    open.push(f.observer);
    await f.observer.start();

    f.source.push(commitEvent(1, "c1", null));
    await until(() => f.metadataCalls === 1);

    const state = await f.observer.resync();
    assert.deepEqual(state.config, { model: { id: "r" } });
    stale.resolve(metadataAt({ model: "stale", estimatedTokens: 99 }));
    await settle();
    await settle();

    assert.equal(f.snapshotCalls, 2);
    assert.equal(f.metadataCalls, 1);
    assert.equal(
      f.updates.some((u) => u.kind === "metadata"),
      false,
    );
    assert.deepEqual(f.observer.state?.config, { model: { id: "r" } });
    assert.equal(f.observer.state?.context.estimatedTokens, 20);
    assert.deepEqual(f.errors, []);
  });

  test("reports a failed refresh and retries it", async () => {
    let call = 0;
    const f = fixture({
      snapshot: () =>
        Promise.resolve(snapshotAt({ seq: 0, tip: null, model: "a", estimatedTokens: 10 })),
      metadata: () => {
        call += 1;
        return call === 1
          ? Promise.reject(new Error("store busy"))
          : Promise.resolve(metadataAt({ model: "b", estimatedTokens: 30, tip: "c1" }));
      },
    });
    open.push(f.observer);
    await f.observer.start();

    f.source.push(commitEvent(1, "c1", null));
    await until(() => f.updates.some((u) => u.kind === "metadata"));

    assert.deepEqual(
      f.errors.map((e) => e.message),
      ["store busy"],
    );
    assert.equal(f.metadataCalls, 2);
    assert.equal(f.snapshotCalls, 1);
    assert.deepEqual(
      f.updates.map((u) => u.kind),
      ["snapshot", "event", "metadata"],
    );
    assert.equal(f.observer.state?.transcript.tip, "c1");
    assert.deepEqual(f.observer.state?.config, { model: { id: "b" } });
    assert.equal(f.observer.state?.context.estimatedTokens, 30);
  });
});

describe("SessionObserver recovery", () => {
  const open: SessionObserver[] = [];
  afterEach(() => {
    for (const observer of open.splice(0)) observer.close();
  });

  test("a bare head rewind keeps re-reading through a transient failure", async () => {
    let call = 0;
    const f = fixture({
      snapshot: () => {
        call += 1;
        if (call === 1)
          return Promise.resolve(
            snapshotAt({ seq: 2, tip: "c2", model: "a", estimatedTokens: 10 }),
          );
        if (call === 2) return Promise.reject(new Error("store busy"));
        return Promise.resolve(snapshotAt({ seq: 3, tip: "c1", model: "b", estimatedTokens: 20 }));
      },
      metadata: () => Promise.resolve(metadataAt({ model: "b", estimatedTokens: 20 })),
    });
    open.push(f.observer);
    await f.observer.start();

    // The head moved back to c1 and no commit follows to reach it.
    f.source.push(headMovedEvent(3, "c2", "c1"));
    await until(() => f.updates.filter((u) => u.kind === "snapshot").length === 2);
    f.source.push(commitEvent(4, "c3", "c1"));
    await until(() => f.observer.state?.transcript.tip === "c3");

    assert.deepEqual(
      f.errors.map((e) => e.message),
      ["store busy"],
    );
    assert.deepEqual(
      f.updates.filter((u) => u.kind !== "metadata").map((u) => u.kind),
      ["snapshot", "event", "snapshot", "event"],
    );
    assert.equal(f.observer.state?.expectedTip, undefined);
    assert.deepEqual(f.observer.state?.config, { model: { id: "b" } });
    assert.deepEqual(f.watches, [2, 3]);
  });

  test("a failed stream waits for a fresh snapshot before watching again", async () => {
    const pending: Deferred<SessionSnapshot | undefined>[] = [];
    let first = true;
    const f = fixture({
      snapshot: () => {
        if (first) {
          first = false;
          return Promise.resolve(
            snapshotAt({ seq: 0, tip: null, model: "a", estimatedTokens: 10 }),
          );
        }
        const next = deferred<SessionSnapshot | undefined>();
        pending.push(next);
        return next.promise;
      },
      metadata: () => Promise.resolve(metadataAt({ model: "a", estimatedTokens: 10 })),
    });
    open.push(f.observer);
    await f.observer.start();

    // c1 and c2 share seq 5; the stream dies between them, so 5 is no cursor.
    f.source.push(commitEvent(5, "c1", null));
    await until(() => f.observer.state?.transcript.tip === "c1");
    f.source.fail(new Error("stream lost"));
    await until(() => pending.length === 1);
    pending[0]?.reject(new Error("store busy"));
    await until(() => pending.length === 2);

    assert.deepEqual(
      f.errors.map((e) => e.message),
      ["stream lost", "store busy"],
    );
    assert.deepEqual(f.watches, [0]);

    pending[1]?.resolve(snapshotAt({ seq: 5, tip: "c2", model: "b", estimatedTokens: 20 }));
    await until(() => f.watches.length === 2);
    f.source.push(commitEvent(6, "c3", "c2"));
    await until(() => f.observer.state?.transcript.tip === "c3");

    assert.deepEqual(f.watches, [0, 5]);
    assert.deepEqual(
      f.updates.filter((u) => u.kind !== "metadata").map((u) => u.kind),
      ["snapshot", "event", "snapshot", "event"],
    );
    assert.equal(f.observer.state?.seq, 6);
  });

  test("closing during recovery or superseding the loop drops its late read", async () => {
    const pending: Deferred<SessionSnapshot | undefined>[] = [];
    let call = 0;
    const f = fixture({
      snapshot: () => {
        call += 1;
        if (call === 1)
          return Promise.resolve(
            snapshotAt({ seq: 0, tip: null, model: "a", estimatedTokens: 10 }),
          );
        if (call === 3)
          return Promise.resolve(
            snapshotAt({ seq: 3, tip: "c3", model: "r", estimatedTokens: 30 }),
          );
        const next = deferred<SessionSnapshot | undefined>();
        pending.push(next);
        return next.promise;
      },
    });
    open.push(f.observer);
    await f.observer.start();

    f.source.fail(new Error("stream lost"));
    await until(() => pending.length === 1);
    const resynced = await f.observer.resync();
    assert.equal(resynced.seq, 3);
    pending[0]?.resolve(snapshotAt({ seq: 9, tip: "c9", model: "old", estimatedTokens: 90 }));
    await settle();
    await settle();
    assert.equal(f.observer.state?.seq, 3);
    assert.deepEqual(f.watches, [0, 3]);

    f.source.fail(new Error("stream lost again"));
    await until(() => pending.length === 2);
    f.observer.close();
    pending[1]?.resolve(snapshotAt({ seq: 12, tip: "c12", model: "late", estimatedTokens: 1 }));
    await settle();
    await settle();

    assert.equal(f.observer.state?.seq, 3);
    assert.deepEqual(f.watches, [0, 3]);
    assert.equal(f.snapshotCalls, 4);
    assert.deepEqual(
      f.updates.map((u) => u.kind),
      ["snapshot", "snapshot"],
    );
    assert.deepEqual(
      f.errors.map((e) => e.message),
      ["stream lost", "stream lost again"],
    );
  });
});
