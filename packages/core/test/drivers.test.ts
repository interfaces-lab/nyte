import { asId, asSeq } from "@nyte-ai/schema";
import type {
  CallId,
  HeadName,
  Json,
  PatchEvent,
  RunId,
  SessionEvent,
  SessionId,
  WaitTarget,
} from "@nyte-ai/schema";
import { describe, expect, it } from "vitest";
import {
  driveInProcess,
  endRun,
  envelope,
  headRef,
  inboxRef,
  leaseRef,
  memoryStore,
  pollStore,
  runStep,
  sessionEvents,
} from "../src/index.ts";
import type { Durable, Kernel, StoreConnection } from "../src/index.ts";
import { isCovered } from "../src/session-state.ts";
import { fakeModels, open } from "./fake-models.ts";
import { completed, configuration, main, setup, startRun, until } from "./harness.ts";

function counting(store: StoreConnection): {
  readonly store: StoreConnection;
  readonly lists: string[];
  readonly sets: string[];
} {
  const lists: string[] = [];
  const sets: string[] = [];

  return {
    lists,
    sets,
    store: {
      ...store,
      refs: {
        ...store.refs,
        list(prefix) {
          lists.push(prefix);

          return store.refs.list(prefix);
        },
        set(updates) {
          sets.push(...updates.map((update) => update.name));

          return store.refs.set(updates);
        },
      },
    },
  };
}

function park(
  kernel: Kernel,
  session: SessionId,
  call: CallId,
  target: WaitTarget,
  run: RunId | null = null,
) {
  return runStep<Json>(kernel, {
    session,
    head: main,
    run,
    call,
    kind: "hook",
    replay: "safe",
    intent: { test: true },
    part: null,
    signal: new AbortController().signal,
    body: async (durable: Durable) => (await durable.wait(target)).kind,
    settle: async (ended) => ({ result: ended.kind === "done" ? ended.value : null, updates: [] }),
    decode: (result) => result,
  });
}

function deferred(): {
  readonly promise: Promise<void>;
  resolve(): void;
  reject(error: Error): void;
} {
  let resolve = (): void => undefined;
  let reject = (_error: Error): void => undefined;

  const promise = new Promise<void>((done, fail) => {
    resolve = () => done();
    reject = fail;
  });

  return { promise, resolve, reject };
}

describe("coverage (§42a, §42t)", () => {
  it("counts a cover's sessions as covered on an admit-only kernel until it closes", async () => {
    const { kernel, host } = await setup({ execution: { kind: "admit-only" } });
    const session = await host.sessions.create();
    const notified: string[] = [];
    kernel.wakes.subscribe((woken, head) => notified.push(`${woken}/${head}`));
    const owned = await host.execution.cover({ kind: "sessions", sessions: [session.id] });
    await session.send("One.");

    expect((await session.view()).messages[0]).toMatchObject({
      status: { kind: "pending", covered: true },
    });
    expect(notified).toEqual([`${session.id}/${main}`]);

    await owned.close();
    await session.send("Two.", { delivery: "queue" });

    expect((await session.view()).messages[1]).toMatchObject({
      status: { kind: "pending", covered: false },
    });
    expect(notified).toHaveLength(1);
  });

  it("covers the named sessions and their descendants (§42ac)", async () => {
    const { host } = await setup({ execution: { kind: "admit-only" } });
    const parent = await host.sessions.create();
    const child = await host.sessions.create({ parent: parent.id });
    const unrelated = await host.sessions.create();
    const owned = await host.execution.cover({ kind: "sessions", sessions: [parent.id] });
    await parent.send("Parent.");
    await child.send("Child.");
    await unrelated.send("Unrelated.");

    expect((await parent.view()).messages[0]).toMatchObject({ status: { covered: true } });
    expect((await child.view()).messages[0]).toMatchObject({ status: { covered: true } });
    expect((await unrelated.view()).messages[0]).toMatchObject({ status: { covered: false } });
    await owned.close();
  });

  it("drives a delegated child to completion on a run kernel covering only its parent, so the parent's task resolves (§42ac)", async () => {
    const store = memoryStore();
    const fake = fakeModels();

    fake.reply(
      {
        content: [
          {
            type: "toolCall",
            id: "call-task",
            name: "task",
            arguments: { prompt: "Find the answer.", title: "Finder" },
          },
        ],
      },
      { content: [{ type: "text", text: "The answer is 42." }] },
      { content: [{ type: "text", text: "The child found 42." }] },
    );

    const seed = await open(fake, { store, execution: { kind: "admit-only" } });
    const created = await seed.sessions.create();
    await seed.close();

    const host = await open(fake, {
      store,
      execution: { kind: "run", coverage: { kind: "sessions", sessions: [created.id] } },
    });

    const receipt = await host.session(created.id).send("Delegate it.");

    expect(await receipt.settled()).toMatchObject({ kind: "completed" });
    expect(fake.requests).toHaveLength(3);

    const children = await host.sessions.list({
      parents: { kind: "children", session: created.id },
    });

    expect(children.items).toHaveLength(1);
    await host.close();
  });

  it("keeps the lease of an advance in flight when its cover closes, until its turn ends (§42ac)", async () => {
    const store = await memoryStore().open();
    const x = await setup({ store, execution: { kind: "admit-only" } });
    const y = await setup({ store, execution: { kind: "admit-only" } });
    const session = await x.host.sessions.create();
    const head = { session: session.id, head: main };
    await session.send("Go.");
    const owned = await x.host.execution.cover({ kind: "sessions", sessions: [session.id] });
    const first = x.host.execution.advance(head);
    const turn = await x.script.started(1);
    await owned.close();

    expect(await store.refs.get(leaseRef(session.id, main))).not.toBeNull();

    const during = await Promise.race([
      y.host.execution.advance(head),
      y.script.started(1).then(() => "a second turn" as const),
    ]);

    expect(during).toMatchObject({ kind: "busy" });
    expect(await x.host.session(session.id).run(turn.input.run.id).stop()).toEqual({
      kind: "requested",
    });
    expect(await first).toEqual({ kind: "idle" });
    expect(turn.input.signal.aborted).toBe(true);
    expect(await store.refs.get(leaseRef(session.id, main))).toBeNull();
    expect(await y.host.execution.advance(head)).toEqual({ kind: "idle" });
    expect(y.script.turns).toHaveLength(0);
  });

  it("claims no lease and reads only the named sessions' calls when it covers", async () => {
    const recorded = counting(await memoryStore().open());
    const { host } = await setup({ store: recorded.store, execution: { kind: "admit-only" } });
    const covered = await host.sessions.create();
    await host.sessions.create();
    recorded.lists.length = 0;
    recorded.sets.length = 0;
    const owned = await host.execution.cover({ kind: "sessions", sessions: [covered.id] });

    expect(recorded.lists).toEqual([]);
    expect(recorded.sets).toEqual([]);
    await owned.close();
  });

  it("answers busy for a head this instance already drives, releasing nothing, so no second turn starts (§42y)", async () => {
    const store = await memoryStore().open();
    const x = await setup({ store, execution: { kind: "admit-only" } });
    const y = await setup({ store, execution: { kind: "admit-only" } });
    const session = await x.host.sessions.create();
    const head = { session: session.id, head: main };
    await session.send("Go.");
    const first = x.host.execution.advance(head);
    const turn = await x.script.started(1);

    expect(await x.host.execution.advance(head)).toMatchObject({ kind: "busy" });
    expect(await store.refs.get(leaseRef(session.id, main))).not.toBeNull();

    const taken = await Promise.race([
      y.host.execution.advance(head),
      y.script.started(1).then(() => "a second turn" as const),
    ]);

    expect(taken).toMatchObject({ kind: "busy" });
    expect([x.script.turns.length, y.script.turns.length]).toEqual([1, 0]);

    turn.finish();

    expect(await first).toEqual({ kind: "idle" });
  });

  it("releases the leases a cover owns when it closes, though another cover stays open (§42y)", async () => {
    const store = await memoryStore().open();
    const x = await setup({ store, execution: { kind: "admit-only" } });
    const y = await setup({ store, execution: { kind: "admit-only" } });
    const first = await x.host.sessions.create();
    const second = await x.host.sessions.create();
    await first.send("One.");
    await first.send("Two.", { delivery: "queue" });
    const other = await x.host.execution.cover({ kind: "sessions", sessions: [second.id] });
    const own = await x.host.execution.cover({ kind: "sessions", sessions: [first.id] });
    const head = { session: first.id, head: main };
    const step = x.host.execution.advance(head);
    (await x.script.started(1)).finish();

    expect(await step).toEqual({ kind: "continue" });
    expect(await store.refs.get(leaseRef(first.id, main))).not.toBeNull();

    await own.close();

    expect(await store.refs.get(leaseRef(first.id, main))).toBeNull();

    const taken = y.host.execution.advance(head);
    (await y.script.started(1)).finish();

    expect(await taken).toEqual({ kind: "idle" });
    await other.close();
  });

  it("holds no lease for a head parked on a wait (§42y)", async () => {
    const { kernel, host } = await setup({ execution: { kind: "admit-only" } });
    const session = await host.sessions.create();
    const owned = await host.execution.cover({ kind: "all" });

    const run = await startRun(
      kernel,
      session.id,
      main,
      { kind: "continuation", from: "wake" },
      configuration,
    );

    kernel.runs.end(run.id);
    const until = Date.now() + 60_000;

    expect(await park(kernel, session.id, asId("timer"), { kind: "timer", until }, run.id)).toEqual(
      { kind: "parked" },
    );
    expect(await host.execution.advance({ session: session.id, head: main })).toEqual({
      kind: "waiting",
      until,
    });
    expect(await kernel.store.refs.get(leaseRef(session.id, main))).toBeNull();
    await owned.close();
  });

  it("re-steps a head busy under a crashed process's lease once it expires, without new input (§42y)", async () => {
    const store = await memoryStore().open();
    const crashed = await setup({ store, execution: { kind: "admit-only" } });
    const session = await crashed.host.sessions.create();
    await session.send("Go.");
    void crashed.host.execution.advance({ session: session.id, head: main });
    await crashed.script.started(1);
    const expiresAt = Date.now() + 300;

    await store.refs.set([
      {
        name: leaseRef(session.id, main),
        target: await store.objects.put(
          envelope(
            "lease",
            { holder: crashed.kernel.hostId, instance: crashed.kernel.instance, expiresAt },
            0,
          ),
        ),
      },
    ]);

    const restarted = await setup({ store, execution: { kind: "admit-only" } });
    const driver = driveInProcess(restarted.kernel, { kind: "all" });
    const turn = await restarted.script.started(1);

    expect(Date.now()).toBeGreaterThanOrEqual(expiresAt);
    expect(turn.input.run.id).toBe(crashed.script.turns[0]?.input.run.id);
    await driver.close();
  });

  it("claims the lease when it advances a head, holds it through the turn and releases it on idle", async () => {
    const { kernel, host, script } = await setup({ execution: { kind: "admit-only" } });
    const session = await host.sessions.create();
    const owned = await host.execution.cover({ kind: "all" });
    await session.send("Go.");

    expect(await kernel.store.refs.get(leaseRef(session.id, main))).toBeNull();

    const step = host.execution.advance({ session: session.id, head: main });
    const turn = await script.started(1);

    expect(await kernel.store.refs.get(leaseRef(session.id, main))).not.toBeNull();

    turn.finish();

    expect(await step).toEqual({ kind: "idle" });
    expect(await kernel.store.refs.get(leaseRef(session.id, main))).toBeNull();
    await owned.close();
  });
});

describe("dispatch (§42p, §42s)", () => {
  it("admits with covered true and dispatches the head after the commit", async () => {
    const store = await memoryStore().open();
    const calls: { readonly session: SessionId; readonly head: HeadName }[] = [];
    const inboxes: boolean[] = [];

    const { host } = await setup({
      store,
      execution: {
        kind: "dispatch",
        async dispatch(target) {
          calls.push(target);
          inboxes.push((await store.refs.get(inboxRef(target.session, target.head))) !== null);
        },
      },
    });

    const session = await host.sessions.create();
    await session.send("Go.");
    await until(() => (calls.length === 1 ? true : undefined));

    expect((await session.view()).messages[0]).toMatchObject({
      status: { kind: "pending", covered: true },
    });
    expect(calls).toEqual([{ session: session.id, head: main }]);
    expect(inboxes).toEqual([true]);
  });

  it("dispatches a head once while a dispatch for it is pending, and again once it settles", async () => {
    const gates = [deferred(), deferred()];
    const calls: SessionId[] = [];

    const { host } = await setup({
      execution: {
        kind: "dispatch",
        dispatch: async ({ session }) => {
          calls.push(session);
          await gates[calls.length - 1]?.promise;
        },
      },
    });

    const session = await host.sessions.create();
    await session.send("One.");
    await session.send("Two.");
    await until(() => (calls.length === 1 ? true : undefined));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(calls).toHaveLength(1);

    gates[0]?.resolve();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await session.send("Three.");
    await until(() => (calls.length === 2 ? true : undefined));
    gates[1]?.resolve();
  });

  it("retries a rejected dispatch, and repair still finds its head owed", async () => {
    let attempts = 0;

    const { host } = await setup({
      execution: {
        kind: "dispatch",
        dispatch: async () => {
          attempts += 1;

          if (attempts === 1) throw new Error("The workflow service is down.");
        },
      },
    });

    const session = await host.sessions.create();
    await session.send("Go.");
    await until(() => (attempts === 2 ? true : undefined));

    expect(await host.execution.repair({ limit: 10 })).toEqual({
      runnable: [{ session: session.id, head: main }],
      next: null,
    });
    await until(() => (attempts === 3 ? true : undefined));
  });

  it("counts every session as covered on a dispatch kernel, before any dispatch resolves (§42p)", async () => {
    const gate = deferred();

    const { kernel, host } = await setup({
      execution: { kind: "dispatch", dispatch: () => gate.promise },
    });

    const session = await host.sessions.create();
    await session.send("Go.");

    expect(await isCovered(kernel, session.id)).toBe(true);
    gate.resolve();
  });
});

describe("poll (§42h, §42u)", () => {
  it("brings another instance's commits to a polling kernel's session events, with their revisions", async () => {
    const store = await memoryStore().open();
    const writer = await setup({ store });
    const reader = await setup({ store, poll: 10 });
    const session = await writer.host.sessions.create();
    const seen: (SessionEvent | PatchEvent)[] = [];
    const events = sessionEvents(reader.kernel, session.id, asSeq(0))[Symbol.asyncIterator]();
    const unpoll = pollStore(reader.kernel);

    void (async () => {
      for (;;) {
        const next = await events.next();

        if (next.done) return;
        seen.push(next.value.event);
      }
    })();

    await session.send("Hello.");
    const step = writer.host.execution.advance({ session: session.id, head: main });
    (await writer.script.started(1)).finish();
    await step;
    await until(() => (seen.some((event) => event.kind === "commit") ? true : undefined));
    const tip = await store.refs.get(headRef(session.id, main));

    expect(seen.filter((event) => event.kind === "input").map((event) => event.seq)).toEqual([
      ...new Set(seen.filter((event) => event.kind === "input").map((event) => event.seq)),
    ]);
    expect((await reader.host.session(session.id).head(main).view()).revision).toBe(tip?.revision);

    unpoll();
    await events.return?.();
  });

  it("wakes a wait parked in a polling kernel once another instance ends its target", async () => {
    const store = await memoryStore().open();
    const writer = await setup({ store });
    const reader = await setup({ store, poll: 10 });
    const parent = await writer.host.sessions.create();
    const child = await writer.host.sessions.create({ parent: parent.id });

    const run = await startRun(
      writer.kernel,
      child.id,
      main,
      { kind: "continuation", from: "wake" },
      configuration,
    );

    const notified: string[] = [];
    reader.kernel.wakes.subscribe((woken, head) => notified.push(`${woken}/${head}`));
    const call: CallId = asId("wait-child");

    expect(
      await park(reader.kernel, parent.id, call, { kind: "run", session: child.id, run: run.id }),
    ).toEqual({ kind: "parked" });

    const unpoll = pollStore(reader.kernel);
    await endRun(writer.kernel, child.id, run.id, completed);
    await until(() => (notified.length > 0 ? true : undefined));

    expect(notified).toEqual([`${parent.id}/${main}`]);
    unpoll();
  });

  it("shows a polling kernel another instance's input queued before its own, and runs both (§42h)", async () => {
    const store = await memoryStore().open();
    const a = await setup({ store, poll: 200, execution: { kind: "admit-only" } });
    const b = await setup({ store, execution: { kind: "admit-only" } });
    const session = await b.host.sessions.create();
    const unpoll = pollStore(a.kernel);
    const watch = a.host.session(session.id).head(main).watch()[Symbol.asyncIterator]();
    let shown = -1;

    void (async () => {
      for (;;) {
        const next = await watch.next();

        if (next.done) return;
        shown = next.value.messages.length;
      }
    })();

    await until(() => (shown >= 0 ? true : undefined));
    await b.host.session(session.id).send("From B.", { delivery: "queue" });
    await a.host.session(session.id).send("From A.", { delivery: "queue" });
    await until(() => (shown === 2 ? true : undefined), 3000);

    expect((await a.host.session(session.id).head(main).view()).messages).toHaveLength(2);

    const first = a.host.execution.advance({ session: session.id, head: main });
    (await a.script.started(1)).finish();

    expect(await first).toEqual({ kind: "continue" });

    const second = a.host.execution.advance({ session: session.id, head: main });
    (await a.script.started(2)).finish();

    expect(await second).toEqual({ kind: "idle" });
    expect(a.script.turns).toHaveLength(2);
    unpoll();
    await watch.return?.();
  });

  it("aborts a polling kernel's turn once another instance stops its run", async () => {
    const store = await memoryStore().open();
    const writer = await setup({ store });
    const driver = await setup({ store, poll: 10 });
    const session = await writer.host.sessions.create();
    await session.send("Go.");
    const unpoll = pollStore(driver.kernel);
    const step = driver.host.execution.advance({ session: session.id, head: main });
    const turn = await driver.script.started(1);

    expect(await writer.host.session(session.id).run(turn.input.run.id).stop()).toEqual({
      kind: "requested",
    });
    expect(await step).toEqual({ kind: "idle" });
    expect(turn.input.signal.aborted).toBe(true);
    expect(await driver.host.session(session.id).run(turn.input.run.id).settled()).toEqual({
      kind: "stopped",
    });
    unpoll();
  });
});
