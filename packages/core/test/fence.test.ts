import { asId } from "@nyte-ai/schema";
import type { Message, RefUpdate, RunId, SetOutcome } from "@nyte-ai/schema";
import { describe, expect, it } from "vitest";
import { landing } from "../src/engine/admission.ts";
import { stopRun } from "../src/engine/fence.ts";
import { move } from "../src/engine/move.ts";
import {
  decodeRunRecord,
  headRef,
  leaseRef,
  memoryStore,
  receiptRef,
  runRef,
} from "../src/store.ts";
import type { Plugin, Store, StoreConnection } from "../src/index.ts";
import { fakeModels, open, testModel } from "./fake-models.ts";
import {
  completed,
  configuration,
  label,
  livePart,
  main,
  setup,
  startRun,
  usage,
} from "./harness.ts";

function hooked(
  connection: StoreConnection,
  set: (updates: readonly RefUpdate[], inner: StoreConnection["refs"]) => Promise<SetOutcome>,
): StoreConnection {
  return {
    ...connection,
    refs: { ...connection.refs, set: (updates) => set(updates, connection.refs) },
  };
}

function hookedStore(
  set: (updates: readonly RefUpdate[], inner: StoreConnection["refs"]) => Promise<SetOutcome>,
): Store {
  const inner = memoryStore();

  return {
    open: async () => hooked(await inner.open(), set),
    close: () => inner.close(),
  };
}

function labels(updates: readonly RefUpdate[]): readonly string[] {
  return updates.flatMap((update) => (update.events ?? []).map(label));
}

function createdRun(updates: readonly RefUpdate[]) {
  for (const event of updates.flatMap((update) => update.events ?? []))
    if (event.kind === "part" && event.change === "created" && event.run) return event.run;

  return null;
}

describe("the stop fence (ADV round 2)", () => {
  it("fails a part the turn opens while the fence is read: the open wins, the fence loses and fails it on its next pass (A-2 N4, D-2 N5, bench stop-fence)", async () => {
    const fake = fakeModels({ models: [testModel("model")] });
    fake.reply({ content: [{ type: "text", text: "A partial answer" }], hold: true });
    const fenceRead = Promise.withResolvers<void>();
    const opened = Promise.withResolvers<void>();
    const committed: (readonly string[])[] = [];
    let stop: ((run: ReturnType<typeof createdRun>) => Promise<unknown>) | null = null;
    let stopped: Promise<unknown> | null = null;
    let fenced = false;

    const store = hookedStore(async (updates, inner) => {
      const run = createdRun(updates);

      if (run !== null && stop !== null && stopped === null) {
        stopped = stop(run);
        await fenceRead.promise;
        const outcome = await inner.set(updates);
        opened.resolve();

        return outcome;
      }

      if (labels(updates).includes("run:stopping") && !fenced) {
        fenced = true;
        fenceRead.resolve();
        await opened.promise;
      }

      const outcome = await inner.set(updates);

      if (outcome.kind === "set") committed.push(labels(updates));

      return outcome;
    });

    await using host = await open(fake, { store });
    const session = await host.sessions.create();
    stop = (run) => (run === null ? Promise.resolve() : session.run(run).stop());
    const receipt = await session.send("Go.");

    expect(await receipt.settled()).toEqual({ kind: "stopped" });
    expect(await stopped).toEqual({ kind: "requested" });
    expect(committed.find((set) => set.includes("run:stopping"))).toEqual([
      "run:stopping",
      "part:failed",
    ]);

    const part = (await session.view()).messages.find((message) => message.kind === "part");

    expect(part).toMatchObject({ status: { kind: "failed", failure: { class: "aborted" } } });
  });

  it("opens no part once the fence landed first: the open loses its compare-and-set on the run, reads stopping and the turn ends stopped (A-2 N4, D-2 N5)", async () => {
    const fake = fakeModels({ models: [testModel("model")] });
    fake.reply({ content: [{ type: "text", text: "A partial answer" }], hold: true });
    let stop: ((run: ReturnType<typeof createdRun>) => Promise<unknown>) | null = null;
    let stopped: unknown = null;

    const store = hookedStore(async (updates, inner) => {
      const run = createdRun(updates);

      if (run !== null && stop !== null && stopped === null) stopped = await stop(run);

      return inner.set(updates);
    });

    await using host = await open(fake, { store });
    const session = await host.sessions.create();
    stop = (run) => (run === null ? Promise.resolve() : session.run(run).stop());
    const receipt = await session.send("Go.");

    expect(await receipt.settled()).toEqual({ kind: "stopped" });
    expect(stopped).toEqual({ kind: "requested" });
    expect((await session.view()).messages.filter((message) => message.kind === "part")).toEqual(
      [],
    );
  });

  it("reads only the run's parts: the fence's object reads do not grow with the session's other parts (A-2 N6)", async () => {
    const reads = async (count: number): Promise<number> => {
      const memory = await memoryStore().open();
      let gets = 0;

      const counted: StoreConnection = {
        ...memory,
        objects: {
          ...memory.objects,
          get(id) {
            gets += 1;

            return memory.objects.get(id);
          },
        },
      };

      const { kernel, host } = await setup({ store: counted, execution: { kind: "admit-only" } });
      const session = await host.sessions.create();
      const old = asId<"run">("old");

      for (let index = 0; index < count; index += 1)
        await livePart(kernel, session.id, old, asId(`old:1:${index}`), "Old.");

      const run = await startRun(
        kernel,
        session.id,
        main,
        { kind: "continuation", from: "wake" },
        configuration,
      );

      await livePart(kernel, session.id, run.id, asId(`${run.id}:1:0`), "Live.");
      gets = 0;
      await stopRun(kernel, session.id, run.id);

      return gets;
    };

    expect(await reads(1000)).toBe(await reads(0));
  });

  it("ends a run another instance fenced stopped, though the turn here ended completed before it saw the fence (A-2 N3, N7b)", async () => {
    const store = await memoryStore().open();
    const a = await setup({ store, execution: { kind: "admit-only" } });
    const b = await setup({ store, execution: { kind: "admit-only" } });
    const session = await b.host.sessions.create();
    const first = await b.host.session(session.id).send("First.");
    const step = b.host.execution.advance({ session: session.id, head: main });
    const turn = await b.script.started(1);
    const run = turn.input.run.id;

    expect(await a.host.session(session.id).run(run).stop()).toEqual({ kind: "requested" });
    turn.finish(completed);
    await step;

    expect(await b.host.session(session.id).receipt(first.id).settled()).toEqual({
      kind: "stopped",
    });
    expect(await a.host.session(session.id).run(run).settled()).toEqual({ kind: "stopped" });
  });

  it("keeps fencing after losing its compare-and-set twice, so the stop never throws stale (A-2 N3, N5)", async () => {
    const memory = await memoryStore().open();
    let bumps = 0;

    const store = hooked(memory, async (updates, inner) => {
      const fence = updates.find((update) => update.events?.some((event) => event.kind === "run"));

      if (fence !== undefined && labels(updates).includes("run:stopping") && bumps < 2) {
        bumps += 1;
        const ref = await inner.get(fence.name);

        if (ref !== null)
          await inner.set([{ name: ref.name, target: ref.target, expect: ref.revision }]);
      }

      return inner.set(updates);
    });

    const { kernel, host, script } = await setup({ store, execution: { kind: "admit-only" } });
    const session = await host.sessions.create();
    await session.send("Go.");
    const step = host.execution.advance({ session: session.id, head: main });
    const run = (await script.started(1)).input.run.id;

    expect(await stopRun(kernel, session.id, run)).toEqual({ kind: "requested" });
    expect(bumps).toBe(2);
    await step;

    const ref = await memory.refs.get(runRef(session.id, run));

    expect(ref).toBeNull();
    expect(await session.run(run).settled()).toEqual({ kind: "stopped" });
  });

  it("does not end the run stopped when the stop throws: the end is the run record's, not this instance's mark (A-2 N3, N5)", async () => {
    const memory = await memoryStore().open();
    let refused = false;

    const store = hooked(memory, async (updates, inner) => {
      if (!refused && labels(updates).includes("run:stopping")) {
        refused = true;

        throw new Error("database is locked");
      }

      return inner.set(updates);
    });

    const { kernel, host, script } = await setup({ store, execution: { kind: "admit-only" } });
    const session = await host.sessions.create();
    await session.send("Go.");
    const step = host.execution.advance({ session: session.id, head: main });
    const turn = await script.started(1);
    const run = turn.input.run.id;

    await expect(stopRun(kernel, session.id, run)).rejects.toThrow("database is locked");

    const record = await memory.refs.get(runRef(session.id, run));

    expect(
      decodeRunRecord(record?.target ? await memory.objects.get(record.target) : null)?.stopping,
    ).toBe(false);
    turn.finish(completed);
    await step;

    expect(await session.run(run).settled()).toEqual(completed);
  });
});

describe("move receipts and summary guards (ADV F-2)", () => {
  it("settles a move whose process died after its set, when the move is replayed (F-2 1, N1)", async () => {
    const memory = await memoryStore().open();
    let crashed = false;

    const store = hooked(memory, async (updates, inner) => {
      if (crashed) throw new Error("The host crashed.");
      const outcome = await inner.set(updates);

      crashed = updates
        .flatMap((update) => update.events ?? [])
        .some((event) => event.kind === "head" && event.reason === "moved");

      return outcome;
    });

    const a = await setup({ store, execution: { kind: "admit-only" } });
    const session = await a.host.sessions.create();
    const base = await session.send("Base.");
    await landing(a.kernel, session.id, main, [base.message], null);
    const id = asId<"receipt">("crash");

    await expect(move(a.kernel, session.id, main, { kind: "start" }, { id })).rejects.toThrow(
      "The host crashed.",
    );

    const b = await setup({ store: memory, execution: { kind: "admit-only" } });
    const replay = await move(b.kernel, session.id, main, { kind: "start" }, { id });
    const moved = {
      kind: "moved",
      revision: "",
      position: { kind: "start" },
      summary: null,
      handback: null,
    };

    expect(await replay.status()).toEqual({ kind: "settled", outcome: moved });
    expect(await replay.settled()).toEqual(moved);
    expect(await memory.refs.get(headRef(session.id, main))).toBeNull();
  });

  it("refuses a summary move whose head got pending input while it summarised (F-2 2, N2)", async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();

    const { kernel, host } = await setup({
      execution: { kind: "admit-only" },
      summarize: async () => {
        entered.resolve();
        await release.promise;

        return { kind: "ok", markdown: "Summary.", usage };
      },
    });

    const session = await host.sessions.create();
    const base = await session.send("Base.");
    await landing(kernel, session.id, main, [base.message], null);
    const tip = await kernel.store.refs.get(headRef(session.id, main));

    const receipt = await move(
      kernel,
      session.id,
      main,
      { kind: "start" },
      { expect: tip?.revision, abandoned: { summarize: {} } },
    );

    await entered.promise;
    const queued = await session.send("Queued.", { delivery: "queue" });
    release.resolve();

    expect(await receipt.settled()).toEqual({ kind: "pending-input", messages: [queued.message] });
    expect((await kernel.store.refs.get(headRef(session.id, main)))?.target).toBe(tip?.target);
    expect(await kernel.store.refs.list(`sessions/${session.id}/parts/`)).toEqual([]);
  });
});

describe("integration of round 2 (§61–§63)", () => {
  it("lands no input into a run another instance fenced: the landing expects the run unfenced (A-2 N4, N7)", async () => {
    const store = await memoryStore().open();
    const a = await setup({ store, execution: { kind: "admit-only" } });
    const b = await setup({ store, execution: { kind: "admit-only" } });
    const session = await b.host.sessions.create();
    await b.host.session(session.id).send("First.");
    const step = b.host.execution.advance({ session: session.id, head: main });
    const turn = await b.script.started(1);
    const steer = await a.host.session(session.id).send("Steer.");

    expect(await a.host.session(session.id).run(turn.input.run.id).stop()).toEqual({
      kind: "requested",
    });
    expect(await turn.input.boundary()).toEqual([]);
    turn.finish(completed);
    await step;

    expect(await a.host.session(session.id).receipt(steer.id).status()).toEqual({
      kind: "pending",
    });
  });

  it("starts no run for an input withdrawn before it lands: the run starts in the set that lands it (A-2 N6, probe N4)", async () => {
    const memory = await memoryStore().open();
    let withdraw: (() => Promise<unknown>) | null = null;

    const store = hooked(memory, async (updates, inner) => {
      const pending = withdraw;

      if (pending !== null && labels(updates).includes("run:started")) {
        withdraw = null;
        await pending();
      }

      return inner.set(updates);
    });

    const { host, script } = await setup({ store, execution: { kind: "admit-only" } });
    const session = await host.sessions.create();
    const sent = await session.send("Go.");
    withdraw = () => sent.stop();

    expect(await host.execution.advance({ session: session.id, head: main })).toEqual({
      kind: "idle",
    });
    expect(script.turns).toHaveLength(0);
    expect(await sent.status()).toEqual({ kind: "settled", outcome: { kind: "withdrawn" } });
    expect(await memory.refs.list(`sessions/${session.id}/runs/`)).toEqual([]);
  });

  it("refuses a summary edit whose head moved after its guard: the summary expects the guarded tip (F-2 2, N4)", async () => {
    const memory = await memoryStore().open();
    const id = asId<"receipt">("n4");
    let inject: (() => Promise<unknown>) | null = null;
    let sessionName = "";

    const store = hooked(memory, async (updates, inner) => {
      const pending = inject;

      if (pending !== null && updates.length === 1 && updates[0].name === sessionName) {
        inject = null;
        await pending();
      }

      return inner.set(updates);
    });

    const a = await setup({ store, execution: { kind: "admit-only" } });
    const b = await setup({ store: memory, execution: { kind: "admit-only" } });
    const session = await a.host.sessions.create();
    sessionName = receiptRef(session.id, id);
    const original = await session.send("Original.");
    await landing(a.kernel, session.id, main, [original.message], null);
    const old = await memory.refs.get(headRef(session.id, main));

    inject = async () => {
      const other = await b.host.session(session.id).send("Other.");
      await landing(b.kernel, session.id, main, [other.message], null);
    };

    const edit = await session.send("Edited.", {
      id,
      replace: original.message,
      expect: old?.revision,
      abandoned: { summarize: {} },
    });

    const now = await memory.refs.get(headRef(session.id, main));

    expect(await edit.settled()).toEqual({ kind: "stale", revision: now?.revision });
    expect(now?.target).not.toBe(old?.target);
  });

  it("charges an overflowed response the stop lands after, before the next request (D-2 N4b)", async () => {
    const fake = fakeModels();
    const observed: string[] = [];

    const observer: Plugin<"core"> = {
      id: "observer",
      hooks: {
        after_request: (event) => {
          observed.push(`${event.step}:${event.usage.total}`);
        },
      },
    };

    fake.reply(
      { content: [{ type: "text", text: "First answer." }] },
      {
        content: [{ type: "text", text: "Streamed" }],
        error: "prompt is too long: 213462 tokens > 200000 maximum",
        usage: { input: 40, output: 4 },
      },
    );

    await using host = await open(fake, { plugins: [observer] });
    const session = await host.sessions.create();
    await (await session.send("First?")).settled();
    observed.length = 0;
    const original = fake.models.streamSimple.bind(fake.models);
    let stop: () => Promise<unknown> = async () => undefined;

    fake.models.streamSimple = (model, context, options) => {
      const stream = original(model, context, options);
      const result = stream.result.bind(stream);

      stream.result = async () => {
        const message = await result();
        await stop();

        return message;
      };

      return stream;
    };

    const requests: string[] = [];

    host.kernel.bus.subscribe(session.id, (event) => {
      if (event.kind === "request") requests.push(`${event.step}:${event.usage.total}`);
    });

    const receipt = await session.send("Second?");
    stop = async () => {
      stop = async () => undefined;
      await session.run(runOf((await session.view()).messages, "Second?")).stop();
    };

    expect(await receipt.settled()).toEqual({ kind: "stopped" });
    expect(requests).toEqual(["assistant:44"]);
    expect(observed).toEqual(["assistant:44"]);
  });

  it("wakes a head once when a dispatch saw the lease busy while the holder released it idle (E-2 N2)", async () => {
    const memory = await memoryStore().open();
    let during: (() => Promise<unknown>) | null = null;
    let lease = "";

    const store = hooked(memory, async (updates, inner) => {
      const pending = during;

      if (pending !== null && updates[0]?.name === lease && updates[0].target === null) {
        during = null;
        await pending();
      }

      return inner.set(updates);
    });

    const a = await setup({ store, execution: { kind: "admit-only" } });
    const b = await setup({ store: memory, execution: { kind: "admit-only" } });
    const session = await a.host.sessions.create();
    const head = { session: session.id, head: main };
    lease = leaseRef(session.id, main);
    const reports: string[] = [];
    const woken: string[] = [];
    a.kernel.wakes.subscribe((_session, name) => woken.push(name));

    during = async () => {
      await b.host.session(session.id).send("Sent meanwhile.");
      reports.push((await b.host.execution.advance(head)).kind);
    };

    expect(await a.host.execution.advance(head)).toEqual({ kind: "idle" });
    expect(reports).toEqual(["busy"]);
    expect(woken).toEqual([main]);
  });
});

function runOf(messages: readonly Message[], content: string): RunId {
  for (const message of messages)
    if (
      message.kind === "user" &&
      message.content === content &&
      message.status.kind === "landed" &&
      message.status.run !== null
    )
      return message.status.run;

  throw new Error(`No run landed ${content}.`);
}
