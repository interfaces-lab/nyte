import { asId, asSeq } from "@nyte-ai/schema";
import type { CallId, HeadName, Json, RunId, SessionId, WaitTarget } from "@nyte-ai/schema";
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import {
  callRef,
  decodeCallRecord,
  decodePartRecord,
  decodeRunRecord,
  decodeSessionRecord,
  endRun,
  envelope,
  landing,
  leaseRef,
  memoryStore,
  move,
  partRef,
  publishSet,
  receiptRef,
  runRef,
  runStep,
  sessionRef,
  stopRun,
} from "../src/index.ts";
import type { Kernel, PartRecord, Plugin, StoreConnection } from "../src/index.ts";
import { kernelOver, world } from "./fake-env.ts";
import { fakeModels, open } from "./fake-models.ts";
import { completed, configuration, livePart, main, setup, startRun, until } from "./harness.ts";

function park(
  kernel: Kernel,
  session: SessionId,
  call: CallId,
  target: WaitTarget | { readonly kind: "any" | "all"; readonly targets: readonly WaitTarget[] },
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
    body: async (durable) => (await durable.wait(target)).kind,
    settle: async (ended) => ({ result: ended.kind === "done" ? ended.value : null, updates: [] }),
    decode: (result) => result,
  });
}

function interrupting(store: StoreConnection) {
  let armed: {
    match: (names: readonly string[]) => boolean;
    before: () => Promise<unknown>;
  } | null = null;

  const wrapped: StoreConnection = {
    ...store,
    refs: {
      ...store.refs,
      async set(updates) {
        const pending = armed;

        if (pending !== null && pending.match(updates.map((update) => update.name))) {
          armed = null;
          await pending.before();
        }

        return store.refs.set(updates);
      },
    },
  };

  return {
    store: wrapped,
    arm(match: (names: readonly string[]) => boolean, before: () => Promise<unknown>): void {
      armed = { match, before };
    },
  };
}

async function record<T>(
  store: StoreConnection,
  name: string,
  decode: (object: Json | null) => T | null,
): Promise<T | null> {
  const ref = await store.refs.get(name);

  return ref?.target ? decode(await store.objects.get(ref.target)) : null;
}

async function endSilently(store: StoreConnection, session: SessionId, run: RunId): Promise<void> {
  const ref = await store.refs.get(sessionRef(session));
  const found = await record(store, sessionRef(session), decodeSessionRecord);
  const runRefNow = await store.refs.get(runRef(session, run));
  assert(found !== null && ref !== null && runRefNow !== null);

  await store.refs.set([
    { name: runRef(session, run), target: null, expect: runRefNow.revision },
    {
      name: sessionRef(session),
      target: await store.objects.put(
        envelope(
          "session",
          {
            ...found,
            heads: found.heads.map((head) =>
              head.name === main
                ? { ...head, lastRun: { id: run, end: completed, endedAt: 1 } }
                : head,
            ),
          },
          1,
        ),
      ),
      expect: ref.revision,
    },
  ]);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("liveness across instances (D2)", () => {
  it("1.2 (A F3): the stop fence leaves a part another instance settled as the store has it", async () => {
    const store = await memoryStore().open();
    const a = await setup({ store, execution: { kind: "admit-only" } });
    const b = await setup({ store, execution: { kind: "admit-only" } });
    const session = await a.host.sessions.create();
    const run = await startRun(
      a.kernel,
      session.id,
      main,
      { kind: "continuation", from: "wake" },
      configuration,
    );
    const part = asId<"part">(`${run.id}:1:0`);
    await livePart(a.kernel, session.id, run.id, part, "Partial.");
    const hold = a.kernel.folds.acquire(session.id, asId("local"));
    await hold.ready();
    const live = await record(store, partRef(session.id, part), decodePartRecord);
    assert(live !== null);

    const settled: PartRecord = {
      ...live,
      state: { markdown: "The full answer B streamed.", signature: null },
      version: 2,
      status: { kind: "settled", commit: asId("c1"), endedAt: 1 },
    };

    const updates = [
      {
        name: partRef(session.id, part),
        target: await store.objects.put(envelope("part", settled, 1)),
      },
    ];

    await publishSet(b.kernel, updates, await store.refs.set(updates));

    expect(await stopRun(a.kernel, session.id, run.id)).toEqual({ kind: "requested" });
    expect(await record(store, partRef(session.id, part), decodePartRecord)).toMatchObject({
      version: 2,
      status: { kind: "settled" },
    });
    hold.release();
  });

  it("1.4 (A F5): an input admitted while its run ends is scheduled for the next turn, not joined to the ended run", async () => {
    const memory = await memoryStore().open();
    const wrapped = interrupting(memory);
    const { kernel, host } = await setup({ store: wrapped.store });
    const session = await host.sessions.create();
    const run = await startRun(
      kernel,
      session.id,
      main,
      { kind: "continuation", from: "wake" },
      configuration,
    );
    const woken: HeadName[] = [];
    kernel.wakes.subscribe((_session, head) => woken.push(head));

    wrapped.arm(
      (names) => names.some((name) => name.includes("/receipts/")),
      () => endRun(kernel, session.id, run.id, completed),
    );

    const receipt = await session.send("Steer.");
    const message = (await session.view()).messages.find((entry) => entry.id === receipt.message);

    expect(message).toMatchObject({
      status: { kind: "pending", schedule: { kind: "next-turn", reason: "idle" } },
    });
    expect(woken).toContain(main);
  });

  it("2.1 (E E1): a child's end on an instance holding none of the parent's waits settles the parked call and wakes the parent", async () => {
    const store = await memoryStore().open();
    const p = await setup({ store, execution: { kind: "admit-only" } });
    const dispatched: string[] = [];

    const c = await setup({
      store,
      execution: {
        kind: "dispatch",
        dispatch: async ({ session, head }) => {
          dispatched.push(`${session}/${head}`);
        },
      },
    });

    const parent = await p.host.sessions.create();
    const child = await p.host.sessions.create({ parent: parent.id });
    const run = await startRun(
      p.kernel,
      child.id,
      main,
      { kind: "continuation", from: "wake" },
      configuration,
    );
    const call: CallId = asId("task");

    expect(
      await park(p.kernel, parent.id, call, { kind: "run", session: child.id, run: run.id }),
    ).toEqual({
      kind: "parked",
    });

    await endRun(c.kernel, child.id, run.id, completed);
    await until(() => (dispatched.length > 0 ? true : undefined));

    expect(dispatched).toEqual([`${parent.id}/${main}`]);
    expect(await record(store, callRef(parent.id, call), decodeCallRecord)).toMatchObject({
      waiting: null,
      waits: [{ kind: "run", run: run.id, end: completed }],
    });
    expect((await c.host.session(parent.id).view()).messages).toEqual([]);
  });

  it("2.2 (E E2) + C2: repair settles a wait whose target ended unseen, then reports and wakes the parent head", async () => {
    const store = await memoryStore().open();
    const p = await setup({ store, execution: { kind: "admit-only" } });
    const parent = await p.host.sessions.create();
    const child = await p.host.sessions.create({ parent: parent.id });
    const own = await startRun(
      p.kernel,
      parent.id,
      main,
      { kind: "continuation", from: "wake" },
      configuration,
    );
    const run = await startRun(
      p.kernel,
      child.id,
      main,
      { kind: "continuation", from: "wake" },
      configuration,
    );
    const call: CallId = asId("task");

    expect(
      await park(
        p.kernel,
        parent.id,
        call,
        { kind: "run", session: child.id, run: run.id },
        own.id,
      ),
    ).toEqual({ kind: "parked" });

    await endSilently(store, child.id, run.id);
    const dispatched: string[] = [];

    const r = await setup({
      store,
      execution: {
        kind: "dispatch",
        dispatch: async ({ session, head }) => {
          dispatched.push(`${session}/${head}`);
        },
      },
    });

    const page = await r.host.execution.repair({ limit: 10 });

    expect(page.runnable).toContainEqual({ session: parent.id, head: main });
    await until(() => (dispatched.includes(`${parent.id}/${main}`) ? true : undefined));
    expect(await record(store, runRef(parent.id, own.id), decodeRunRecord)).toMatchObject({
      waiting: null,
      parked: [],
    });
  });

  it("2.3 (E E3): a send to a head whose run is live and driven nowhere dispatches the head", async () => {
    const dispatched: string[] = [];

    const { kernel, host } = await setup({
      execution: {
        kind: "dispatch",
        dispatch: async ({ session, head }) => {
          dispatched.push(`${session}/${head}`);
        },
      },
    });

    const session = await host.sessions.create();
    await startRun(kernel, session.id, main, { kind: "continuation", from: "wake" }, configuration);
    await session.send("Are you there?");
    await until(() => (dispatched.length > 0 ? true : undefined));

    expect(dispatched).toEqual([`${session.id}/${main}`]);
  });

  it("2.7 (A F8): a renewal answering fenced abandons the turn and leaves the run live for the new holder", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const store = await memoryStore().open();
    const { host, script } = await setup({ store });
    const session = await host.sessions.create();
    await session.send("Go.");
    const step = host.execution.advance({ session: session.id, head: main });
    const turn = await script.started(1);

    await store.refs.set([
      {
        name: leaseRef(session.id, main),
        target: await store.objects.put(
          envelope(
            "lease",
            { holder: "other", instance: "other", expiresAt: Date.now() + 30_000 },
            0,
          ),
        ),
      },
    ]);

    vi.advanceTimersByTime(10_000);
    await until(() => (turn.input.signal.aborted ? true : undefined));

    expect(await step).toEqual({ kind: "fenced" });
    expect(await store.refs.get(runRef(session.id, turn.input.run.id))).not.toBeNull();
  });

  it("audit 5 (2.7): the new holder resumes and ends the run a fenced advance abandoned", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const store = await memoryStore().open();
    const a = await setup({ store });
    const b = await setup({ store });
    const session = await a.host.sessions.create();
    await session.send("Go.");
    const stepped = a.host.execution.advance({ session: session.id, head: main });
    const first = await a.script.started(1);

    await store.refs.set([
      {
        name: leaseRef(session.id, main),
        target: await store.objects.put(
          envelope(
            "lease",
            {
              holder: b.kernel.hostId,
              instance: b.kernel.instance,
              expiresAt: Date.now() + 30_000,
            },
            0,
          ),
        ),
      },
    ]);

    await vi.advanceTimersByTimeAsync(10_000);

    expect(await stepped).toEqual({ kind: "fenced" });
    expect(a.kernel.runs.get(first.input.run.id)).toBeUndefined();

    const resumed = b.host.execution.advance({ session: session.id, head: main });
    const next = await b.script.started(1);

    expect(next.input.run.id).toBe(first.input.run.id);
    next.finish(completed);
    await resumed;
    expect(await session.run(first.input.run.id).settled()).toEqual(completed);
  });

  it("F7 (A F7): revising an input that landed meanwhile edits it instead of throwing stale", async () => {
    let land: (() => Promise<unknown>) | null = null;

    const { kernel, host } = await setup({
      execution: { kind: "admit-only" },
      admit: async () => {
        const pending = land;
        land = null;
        await pending?.();

        return { action: "continue" };
      },
    });

    const session = await host.sessions.create();
    const draft = await session.send("Draft.", { delivery: "queue" });
    land = () => landing(kernel, session.id, main, [draft.message], null);
    const edited = await session.send("Draft v2.", { replace: draft.message });

    expect(edited.message).not.toBe(draft.message);
    expect((await session.view()).messages.map((entry) => entry.id)).toEqual([edited.message]);
  });

  it("F12 (A F12): a stop of a run another instance drives leaves no run entry here", async () => {
    const store = await memoryStore().open();
    const a = await setup({ store, execution: { kind: "admit-only" } });
    const b = await setup({ store, execution: { kind: "admit-only" } });
    const session = await b.host.sessions.create();
    const run = await startRun(
      b.kernel,
      session.id,
      main,
      { kind: "continuation", from: "wake" },
      configuration,
    );

    expect(await stopRun(a.kernel, session.id, run.id)).toEqual({ kind: "requested" });
    expect(a.kernel.runs.get(run.id)).toBeUndefined();
  });

  it("5.6 (F F1): a duplicate move with the same id replays the first receipt and moves once", async () => {
    const store = await memoryStore().open();
    const { kernel, host } = await setup({ store, execution: { kind: "admit-only" } });
    const session = await host.sessions.create();
    await session.send("One.");
    await landing(
      kernel,
      session.id,
      main,
      (await session.view()).messages.map((entry) => asId(entry.id)),
      null,
    );
    const id = asId<"receipt">("move-1");

    const [first, second] = await Promise.all([
      move(kernel, session.id, main, { kind: "start" }, { id }),
      move(kernel, session.id, main, { kind: "start" }, { id }),
    ]);

    expect(await first.settled()).toMatchObject({ kind: "moved" });
    expect(await second.settled()).toMatchObject({ kind: "moved" });
    const log = await store.refs.log(session.id, asSeq(0), 1000);

    expect(log.filter((entry) => entry.kind === "head" && entry.reason === "moved")).toHaveLength(
      1,
    );
  });

  it("5.7 (F F2): an input admitted after the guard read fails the move's set, which reads again and answers pending-input", async () => {
    const memory = await memoryStore().open();
    const wrapped = interrupting(memory);
    const { kernel, host } = await setup({
      store: wrapped.store,
      execution: { kind: "admit-only" },
    });
    const session = await host.sessions.create();
    await session.send("One.");
    await landing(
      kernel,
      session.id,
      main,
      (await session.view()).messages.map((entry) => asId(entry.id)),
      null,
    );
    const tip = await memory.refs.get(`sessions/${session.id}/heads/${main}`);

    wrapped.arm(
      (names) => names.includes(receiptRef(session.id, asId("move-2"))),
      () => session.send("Queued.", { delivery: "queue" }),
    );

    const moved = await move(kernel, session.id, main, { kind: "start" }, { id: asId("move-2") });

    expect(await moved.settled()).toMatchObject({ kind: "pending-input" });
    expect((await memory.refs.get(`sessions/${session.id}/heads/${main}`))?.revision).toBe(
      tip?.revision,
    );
  });

  it("audit 1 (2.1): a cold child end offers its outcome to an any([job, run]) wait without judging the job", async () => {
    const { kernel, host, provider, workspace } = await world();
    const parent = await host.sessions.create({ workspace });
    const child = await host.sessions.create({ parent: parent.id });
    const job = await host
      .workspace(workspace)
      .jobs.start({ command: "sleep 600", session: parent.id });
    const own = await startRun(
      kernel,
      parent.id,
      main,
      { kind: "continuation", from: "wake" },
      configuration,
    );
    const run = await startRun(
      kernel,
      child.id,
      main,
      { kind: "continuation", from: "wake" },
      configuration,
    );
    const call: CallId = asId("mixed");

    const target = {
      kind: "any",
      targets: [
        { kind: "job", job: job.id },
        { kind: "run", session: child.id, run: run.id },
      ],
    } satisfies Parameters<typeof park>[3];

    expect(await park(kernel, parent.id, call, target, own.id)).toEqual({ kind: "parked" });
    const cold = kernelOver(kernel.store, provider);
    const woken: string[] = [];
    cold.wakes.subscribe((session, head) => woken.push(`${session}/${head}`));
    await endRun(cold, child.id, run.id, completed);

    expect(await record(kernel.store, callRef(parent.id, call), decodeCallRecord)).toMatchObject({
      waiting: null,
      waits: [{ kind: "run", run: run.id, end: completed }],
    });
    expect(woken).toContain(`${parent.id}/${main}`);
  });

  it("audit 3 (A F7): a revise that finds its target landed runs before_send once", async () => {
    let landNow: (() => Promise<unknown>) | null = null;
    let seen = 0;

    const plugin: Plugin<"core"> = {
      id: "edit-hook",
      hooks: {
        before_send: async (submission) => {
          seen += 1;
          const pending = landNow;
          landNow = null;
          await pending?.();

          return {
            action: "modify",
            value: { ...submission, content: `Fixed:${seen}` },
          };
        },
      },
    };

    await using host = await open(fakeModels(), {
      plugins: [plugin],
      execution: { kind: "admit-only" },
    });

    const session = await host.sessions.create();
    const draft = await session.send("Draft", { delivery: "queue" });
    seen = 0;
    landNow = () => landing(host.kernel, session.id, main, [draft.message], null);
    const edited = await session.send("Fixed", { replace: draft.message });

    expect(seen).toBe(1);
    expect((await session.view()).messages).toMatchObject([
      { id: edited.message, content: "Fixed:1" },
    ]);
  });

  it("audit 4 (A F12): a cold move or edit that fences a run another instance drives leaves no run entry here", async () => {
    const store = await memoryStore().open();
    const a = await setup({ store, execution: { kind: "admit-only" } });
    const b = await setup({ store, execution: { kind: "admit-only" } });
    const session = await b.host.sessions.create();
    const sent = await session.send("One.");
    await landing(b.kernel, session.id, main, [sent.message], null);
    const moved = await startRun(
      b.kernel,
      session.id,
      main,
      { kind: "continuation", from: "wake" },
      configuration,
    );
    const receipt = await move(a.kernel, session.id, main, { kind: "start" }, { running: "stop" });

    expect(await receipt.settled()).toMatchObject({ kind: "moved" });
    await endRun(b.kernel, session.id, moved.id, { kind: "stopped" });
    expect(a.kernel.runs.get(moved.id)).toBeUndefined();

    const again = await session.send("Two.");
    await landing(b.kernel, session.id, main, [again.message], null);
    const edited = await startRun(
      b.kernel,
      session.id,
      main,
      { kind: "continuation", from: "wake" },
      configuration,
    );
    await a.host.session(session.id).send("Edit.", { replace: again.message });
    await endRun(b.kernel, session.id, edited.id, { kind: "stopped" });

    expect(a.kernel.runs.get(edited.id)).toBeUndefined();
  });
});
