/**
 * The runner's cancellation under the interleavings a real host produces: a
 * run-ref event handled after the drive it was meant for has ended, and a
 * stopped run's final event arriving while the next run is already asking the
 * provider. The store is real; a gate holds one of its reads or one of its
 * events at the moment the test chooses, so the race is played, not hoped for.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { createAssistantMessageEventStream, type Api, type Model } from "@nyte-ai/ai";
import { isTerminalPhase } from "@nyte-ai/protocol";
import type { AssistantMessage } from "@nyte-ai/schema";
import type { Event, Obj, Run } from "../../src/kernel/model.ts";
import { runRef } from "../../src/kernel/names.ts";
import { createNyte } from "../../src/kernel/sdk/nyte.ts";
import type { Nyte, SessionId } from "../../src/kernel/sdk/types.ts";
import type { Session, Store } from "../../src/kernel/store.ts";
import type { StreamFn } from "../../src/kernel/loop/types.ts";
import { assistant, openStore, usage, within } from "./helpers.ts";

const model: Model<Api> = {
  id: "held-model",
  name: "Held",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 1_000,
};

interface ProviderRequest {
  readonly signal: AbortSignal | undefined;
  /** Ends the stream: cancelled when its signal was aborted, otherwise with the answer. */
  readonly end: () => void;
}

/**
 * A provider whose streams end only when the test ends them, whatever their
 * signal says. A cancelled request is visible on its signal, and a drive
 * blocked in a request stays blocked until the test lets it go.
 */
function heldProvider(): {
  readonly streamFn: StreamFn;
  readonly requests: ProviderRequest[];
  readonly nextRequest: () => Promise<ProviderRequest>;
  /** End whatever is still streaming, so a failed assertion cannot hang the close. */
  readonly endAll: () => void;
} {
  const requests: ProviderRequest[] = [];
  const waiters: ((request: ProviderRequest) => void)[] = [];
  const streamFn: StreamFn = (_model, context, streamOptions) => {
    const users = context.messages.filter((item) => item.role === "user").length;
    const answer: AssistantMessage = assistant(`saw ${String(users)}`, { usage });
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "start", partial: { ...answer, content: [] } });
    let ended = false;
    const request: ProviderRequest = {
      signal: streamOptions?.signal,
      end: () => {
        if (ended) return;
        ended = true;
        if (streamOptions?.signal?.aborted === true) {
          stream.push({
            type: "error",
            reason: "aborted",
            error: { ...answer, stopReason: "aborted", content: [] },
          });
          return;
        }
        stream.push({ type: "done", reason: "stop", message: answer });
      },
    };
    requests.push(request);
    waiters.shift()?.(request);
    return stream;
  };
  let taken = 0;
  return {
    streamFn,
    requests,
    /** Requests in arrival order, each handed out once; waits for one not yet made. */
    nextRequest: () => {
      const arrived = requests[taken];
      taken += 1;
      if (arrived !== undefined) return Promise.resolve(arrived);
      return within(new Promise<ProviderRequest>((resolve) => waiters.push(resolve)));
    },
    endAll: () => {
      for (const request of requests) request.end();
    },
  };
}

interface Held<T> {
  readonly value: T;
  readonly release: () => void;
}

/**
 * A store whose sessions can hold one object read or one watched event. The
 * hold is armed once and reports what it caught with its release, so the test
 * can act on the store in between: that is the interleaving under test.
 */
function gatedStore(base: Store): {
  readonly store: Store;
  readonly holdRead: (matches: (object: Obj) => boolean) => Promise<Held<Obj>>;
  readonly holdEvent: (matches: (event: Event) => Promise<boolean>) => Promise<Held<Event>>;
  /** Let every held read and event go, so a failed assertion cannot hang the close. */
  readonly releaseAll: () => void;
} {
  let readGate:
    | { matches: (object: Obj) => boolean; caught: (held: Held<Obj>) => void }
    | undefined;
  let eventGate:
    | { matches: (event: Event) => Promise<boolean>; caught: (held: Held<Event>) => void }
    | undefined;
  const releases = new Set<() => void>();
  const hold = <T>(value: T, caught: (held: Held<T>) => void): Promise<void> =>
    new Promise<void>((resolve) => {
      const release = (): void => {
        releases.delete(release);
        resolve();
      };
      releases.add(release);
      caught({ value, release });
    });
  const gateSession = (session: Session): Session => ({
    id: session.id,
    refs: session.refs,
    leases: session.leases,
    close: () => session.close(),
    objects: {
      put: (objects) => session.objects.put(objects),
      chain: (from, options) => session.objects.chain(from, options),
      list: () => session.objects.list(),
      commits: () => session.objects.commits(),
      delete: (oids) => session.objects.delete(oids),
      get: async (oid) => {
        const object = await session.objects.get(oid);
        if (object === undefined || readGate === undefined || !readGate.matches(object)) {
          return object;
        }
        const { caught } = readGate;
        readGate = undefined;
        await hold(object, caught);
        return object;
      },
    },
    events: {
      append: (events, options) => session.events.append(events, options),
      read: (options) => session.events.read(options),
      last: () => session.events.last(),
      floor: () => session.events.floor(),
      trim: (beforeSeq) => session.events.trim(beforeSeq),
      watch: (options) => ({
        async *[Symbol.asyncIterator]() {
          for await (const event of session.events.watch(options)) {
            if (eventGate !== undefined && (await eventGate.matches(event))) {
              const { caught } = eventGate;
              eventGate = undefined;
              await hold(event, caught);
            }
            yield event;
          }
        },
      }),
    },
  });
  return {
    store: {
      create: async (options) => gateSession(await base.create(options)),
      open: async (id) => gateSession(await base.open(id)),
      list: () => base.list(),
      delete: (id) => base.delete(id),
      close: () => base.close(),
    },
    holdRead: (matches) =>
      within(new Promise<Held<Obj>>((caught) => (readGate = { matches, caught }))),
    holdEvent: (matches) =>
      within(new Promise<Held<Event>>((caught) => (eventGate = { matches, caught }))),
    releaseAll: () => {
      for (const release of releases) release();
    },
  };
}

function isRun(object: Obj): object is Run {
  return object.kind === "run";
}

async function open(store: Store, streamFn: StreamFn): Promise<Nyte> {
  return createNyte({
    store,
    streamFn,
    models: {
      getModels: () => [model],
      getModel: (_provider, id) => (id === model.id ? model : undefined),
      getAvailable: async () => [model],
    },
    model,
    plugins: [],
    env: { cwd: "/tmp/nowhere" },
  });
}

async function currentRun(session: Session): Promise<Run | undefined> {
  const oid = await session.refs.read(runRef("main"));
  const object = oid === null ? undefined : await session.objects.get(oid);
  return object !== undefined && isRun(object) ? object : undefined;
}

/** Flag the run as another host's participant would: a ref write, with no local drive to cancel. */
async function flagFromElsewhere(session: Session): Promise<Run> {
  const oid = await session.refs.read(runRef("main"));
  const run = await currentRun(session);
  assert.ok(run !== undefined && !isTerminalPhase(run.phase));
  const [flagged] = await session.objects.put([{ ...run, abortRequested: true }]);
  assert.ok(flagged !== undefined);
  const outcome = await session.refs.update([{ name: runRef("main"), from: oid, to: flagged }], {
    reason: "abort",
  });
  assert.ok(outcome.ok);
  return run;
}

/** Watch the store, not the runner, until the run has a terminal phase. */
async function untilRunEnds(session: Session, runId: string): Promise<void> {
  const stop = new AbortController();
  try {
    await within(
      (async () => {
        for await (const event of session.events.watch({ afterSeq: 0, signal: stop.signal })) {
          if (event.kind !== "ref" || event.name !== runRef("main")) continue;
          const run = await currentRun(session);
          if (run?.id === runId && isTerminalPhase(run.phase)) return;
        }
      })(),
    );
  } finally {
    stop.abort();
  }
}

async function transcript(nyte: Nyte, id: SessionId): Promise<string[]> {
  const turns = await nyte.messages.list({ sessionId: id });
  return turns.flatMap((turn) =>
    turn.kind === "turn"
      ? turn.parts.flatMap((part) =>
          part.kind === "user"
            ? [`user:${Array.isArray(part.content) ? "…" : part.content}`]
            : part.kind === "assistant"
              ? [`assistant:${part.text}`]
              : [],
        )
      : [],
  );
}

const flaggedLive = (object: Obj): boolean =>
  isRun(object) && object.abortRequested === true && !isTerminalPhase(object.phase);

/**
 * Stop the live run from another host and hold the runner's read of it. Every
 * event before that one has been handled once the read is caught, so what the
 * test asserts about the request under way is about a settled runner, and the
 * release then proves a genuine stop still cancels that request.
 */
async function stopFromElsewhere(
  gate: ReturnType<typeof gatedStore>,
  other: Session,
  request: ProviderRequest,
): Promise<void> {
  const reading = gate.holdRead(flaggedLive);
  await flagFromElsewhere(other);
  const barrier = await reading;
  assert.equal(request.signal?.aborted, false);
  const cancelled = within(
    new Promise<void>((resolve) =>
      request.signal?.addEventListener("abort", () => resolve(), { once: true }),
    ),
  );
  barrier.release();
  await cancelled;
  request.end();
}

test("a run-ref read paused across the end of a stopped drive cannot cancel the drive that replaced it", async () => {
  const base = openStore();
  const gate = gatedStore(base);
  const provider = heldProvider();
  const nyte = await open(gate.store, provider.streamFn);
  try {
    const { sessionId: id } = await nyte.sessions.create();
    const other = await base.open(id);
    nyte.attach();
    await nyte.messages.send({ sessionId: id, content: "hi" });
    const first = await provider.nextRequest();
    const stopped = await currentRun(other);
    assert.ok(stopped !== undefined);

    // The runner reads the flagged run for the abort event. The drive is still
    // blocked in the provider, so this is the only read a flagged live run gets.
    const paused = gate.holdRead(flaggedLive);
    assert.equal((await nyte.runs.abort({ sessionId: id })).kind, "requested");
    const held = await paused;
    assert.ok(isRun(held.value) && held.value.id === stopped.id);
    assert.equal(first.signal?.aborted, true);

    // While that read is paused: the interrupted answer lands and the stopped
    // run ends. The runner's own event loop is behind the paused read, so an
    // attachment wakes it for the steer, which starts the next run.
    first.end();
    await nyte.messages.send({ sessionId: id, content: "do this instead", lane: "steer" });
    await untilRunEnds(other, stopped.id);
    nyte.attach();
    const second = await provider.nextRequest();
    const fresh = await currentRun(other);
    assert.ok(fresh !== undefined);
    assert.notEqual(fresh.id, stopped.id);
    assert.equal(fresh.phase.kind, "respond");
    assert.equal(second.signal?.aborted, false);
    held.release();
    await stopFromElsewhere(gate, other, second);
    assert.deepEqual(await nyte.runs.wait({ sessionId: id }), { kind: "idle" });
    const ended = await currentRun(other);
    assert.equal(ended?.id, fresh.id);
    assert.equal(ended?.phase.kind, "aborted");
    assert.deepEqual(await transcript(nyte, id), ["user:hi", "user:do this instead"]);
    assert.deepEqual(await nyte.messages.pending({ sessionId: id }), []);
  } finally {
    gate.releaseAll();
    provider.endAll();
    await nyte.close();
  }
});

test("a stopped run's final event, delivered while the next run is asking the provider, cancels nothing", async () => {
  const base = openStore();
  const gate = gatedStore(base);
  const provider = heldProvider();
  const nyte = await open(gate.store, provider.streamFn);
  try {
    const { sessionId: id } = await nyte.sessions.create();
    const other = await base.open(id);
    nyte.attach();
    await nyte.messages.send({ sessionId: id, content: "hi" });
    const first = await provider.nextRequest();
    const stopped = await currentRun(other);
    assert.ok(stopped !== undefined);

    // Hold the event that ends the stopped run: its payload keeps the flag.
    const delayed = gate.holdEvent(async (event) => {
      if (event.kind !== "ref" || event.name !== runRef("main") || event.to === null) return false;
      const object = await other.objects.get(event.to);
      return object !== undefined && isRun(object) && isTerminalPhase(object.phase);
    });
    assert.equal((await nyte.runs.abort({ sessionId: id })).kind, "requested");
    first.end();
    const held = await delayed;
    assert.ok(held.value.kind === "ref" && held.value.to !== null);
    const payload = await other.objects.get(held.value.to);
    assert.ok(payload !== undefined && isRun(payload));
    assert.equal(payload.id, stopped.id);
    assert.equal(payload.phase.kind, "aborted");
    assert.equal(payload.abortRequested, true);

    await nyte.messages.send({ sessionId: id, content: "do this instead", lane: "steer" });
    const second = await provider.nextRequest();
    const fresh = await currentRun(other);
    assert.ok(fresh !== undefined);
    assert.notEqual(fresh.id, stopped.id);
    assert.equal(second.signal?.aborted, false);

    held.release();
    await stopFromElsewhere(gate, other, second);
    assert.deepEqual(await nyte.runs.wait({ sessionId: id }), { kind: "idle" });
    assert.equal((await currentRun(other))?.phase.kind, "aborted");
    assert.deepEqual(await transcript(nyte, id), ["user:hi", "user:do this instead"]);
  } finally {
    gate.releaseAll();
    provider.endAll();
    await nyte.close();
  }
});
