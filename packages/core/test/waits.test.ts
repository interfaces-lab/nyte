import { asId, standard } from "@nyte-ai/schema";
import type { Awaitable, Infer, Json, PartId, RunId, SessionId } from "@nyte-ai/schema";
import { Type } from "typebox";
import { assert, describe, expect, it, vi } from "vitest";
import { executeCall } from "../src/agent/tool-runner.ts";
import { createKernel } from "../src/compose.ts";
import { repair } from "../src/drive/execution.ts";
import { LEASE_MS, runStep } from "../src/engine/durable.ts";
import { earliestWake, loadWaits } from "../src/engine/waits.ts";
import { readCalls } from "../src/store/session.ts";
import { LOCAL, ALL_AUTHORITY, definePart } from "../src/index.ts";
import {
  callRef,
  decodeCallRecord,
  decodePartRecord,
  decodeRunRecord,
  partRef,
  runRef,
} from "../src/store.ts";
import { failedParts } from "../src/store/parts.ts";
import type { Kernel } from "../src/contract/kernel.ts";
import type { ActionContext, ActionOutput, Durable, ToolDefinition } from "../src/index.ts";
import type { CallRecord } from "../src/store.ts";
import { commit } from "../src/fold/commit.ts";
import { put } from "../src/store/session.ts";
import { configuration, main, setup, startRun, until } from "../src/harness.ts";
import { toolPlugin } from "./tool-support.ts";

/** The earliest time a wait on the main head is due, read from its parked calls. */
async function nextWake(kernel: Kernel, session: SessionId): Promise<number | null> {
  const calls = await readCalls(kernel.store, session);

  return earliestWake(
    kernel.store,
    session,
    calls.flatMap((record) => (record.head === main ? [record.id] : [])),
  );
}

const question = definePart({
  kind: "test/question",
  state: standard(Type.Object({})),
  actions: { answer: { input: standard(Type.Object({ choice: Type.String() })) } },
  fallback: (_state, { id }) => `Ask ${id}`,
});

const parker = {
  name: "parker",
  description: "Wait for a timer.",
  parameters: standard(Type.Object({})),
  class: () => ({ kind: "custom", label: "Waiting" }),
  replay: "safe",
  execute: async (_args, invocation) => ({
    content: [
      {
        kind: "text",
        text: (await invocation.wait({ kind: "timer", until: Date.now() + 60_000 })).kind,
      },
    ],
  }),
} satisfies ToolDefinition<object>;

const ran: string[] = [];

const holdState = standard(Type.Object({ done: Type.Boolean() }));

const holdActions = {
  hold: {
    input: standard(Type.Object({ until: Type.Number() })),
    output: standard(Type.Object({ woke: Type.String() })),
  },
};

const holdHandlers: {
  readonly [A in keyof typeof holdActions]: (
    input: Infer<(typeof holdActions)[A]["input"]>,
    context: ActionContext<Infer<typeof holdState>, typeof holdActions>,
  ) => Awaitable<ActionOutput<(typeof holdActions)[A]>>;
} = {
  hold: async (input, context) => {
    ran.push(context.principal);
    const woke = await context.wait({ kind: "timer", until: input.until });
    await context.part.update({ done: true });

    return { woke: woke.kind };
  },
};

const holding = definePart({
  kind: "test/holding",
  state: holdState,
  actions: holdActions,
  fallback: (_state, { id }) => `Holding ${id}`,
  onAction: (action, input, context) => holdHandlers[action](input, context),
});

const resumed: string[] = [];

let released = Promise.withResolvers<void>();

const gatedHandlers: {
  readonly [A in keyof typeof holdActions]: (
    input: Infer<(typeof holdActions)[A]["input"]>,
    context: ActionContext<Infer<typeof holdState>, typeof holdActions>,
  ) => Awaitable<ActionOutput<(typeof holdActions)[A]>>;
} = {
  hold: async (input, context) => {
    const woke = await context.wait({ kind: "timer", until: input.until });
    resumed.push(context.principal);
    await released.promise;

    return { woke: woke.kind };
  },
};

const gated = definePart({
  kind: "test/gated",
  state: holdState,
  actions: holdActions,
  fallback: (_state, { id }) => `Gated ${id}`,
  onAction: (action, input, context) => gatedHandlers[action](input, context),
});

const dyingHandlers: typeof gatedHandlers = {
  hold: async (input, context) => {
    const woke = await context.wait({ kind: "timer", until: input.until });
    resumed.push(context.principal);

    if (resumed.length === 1) await new Promise<never>(() => undefined);

    return { woke: woke.kind };
  },
};

const dying = definePart({
  kind: "test/dying",
  state: holdState,
  actions: holdActions,
  fallback: (_state, { id }) => `Dying ${id}`,
  onAction: (action, input, context) => dyingHandlers[action](input, context),
});

async function leaseLater<T>(body: () => Promise<T>): Promise<T> {
  const real = Date.now.bind(Date);
  const clock = vi.spyOn(Date, "now").mockImplementation(() => real() + LEASE_MS + 1);

  try {
    return await body();
  } finally {
    clock.mockRestore();
  }
}

function waitStep(
  kernel: Kernel,
  input: {
    readonly session: SessionId;
    readonly call: string;
    readonly run?: RunId;
    readonly body: (durable: Durable) => Promise<Json>;
  },
) {
  return runStep<Json>(kernel, {
    session: input.session,
    head: main,
    run: input.run ?? null,
    call: asId(input.call),
    kind: "hook",
    replay: "safe",
    intent: { test: true },
    part: null,
    signal: new AbortController().signal,
    body: input.body,
    settle: async (ended) => ({
      result: ended.kind === "done" ? ended.value : ended.kind,
      updates: [],
    }),
    decode: (result) => result,
  });
}

function waiting(target: Parameters<Durable["wait"]>[0]) {
  return async (durable: Durable): Promise<Json> => durable.wait(target);
}

async function readCall(kernel: Kernel, session: SessionId, id: string): Promise<CallRecord> {
  const ref = await kernel.store.refs.get(callRef(session, asId<"call">(id)));
  const record = decodeCallRecord(ref?.target ? await kernel.store.objects.get(ref.target) : null);
  assert(record !== null);

  return record;
}

function parkedCall(kernel: Kernel, session: SessionId): Promise<string> {
  return until(async () => {
    for (const ref of await kernel.store.refs.list(`sessions/${session}/calls/`)) {
      const record = decodeCallRecord(
        ref.target ? await kernel.store.objects.get(ref.target) : null,
      );

      if (record !== null && record.waiting !== null) return record.id;
    }

    return undefined;
  });
}

async function partRecord(kernel: Kernel, session: SessionId, part: PartId) {
  const ref = await kernel.store.refs.get(partRef(session, part));
  const record = decodePartRecord(ref?.target ? await kernel.store.objects.get(ref.target) : null);
  assert(record !== null);

  return record;
}

async function partStatus(kernel: Kernel, session: SessionId, part: PartId) {
  const ref = await kernel.store.refs.get(partRef(session, part));

  return decodePartRecord(ref?.target ? await kernel.store.objects.get(ref.target) : null)?.status;
}

async function runOf(kernel: Kernel, session: SessionId, run: RunId) {
  const ref = await kernel.store.refs.get(runRef(session, run));

  return decodeRunRecord(ref?.target ? await kernel.store.objects.get(ref.target) : null);
}

function restart(kernel: Kernel): Kernel {
  return createKernel({
    hostId: kernel.hostId,
    store: kernel.store,
    description: kernel.description,
    host: kernel.host,
  });
}

async function liveRun(kernel: Kernel, session: SessionId): Promise<RunId> {
  const run = await startRun(
    kernel,
    session,
    main,
    { kind: "continuation", from: "wake" },
    configuration,
  );

  kernel.runs.end(run.id);

  return run.id;
}

const yes = { action: "answer", input: { choice: "yes" } };

describe("waits as store facts", () => {
  it("stops a call parked on another instance through the store: its holder's poll wakes it and repair finds the run (ADV E N4)", async () => {
    const holder = await setup({ plugins: [toolPlugin([parker])] });
    const other = await setup({ store: holder.kernel.store });
    const session = await holder.host.sessions.create();
    const head = { session: session.id, head: main };
    await session.send("Wait.");
    const step = holder.host.execution.advance(head);
    const turn = await holder.script.started(1);
    const run = turn.input.run.id;

    expect(
      await executeCall(holder.kernel, {
        session: session.id,
        runtime: holder.kernel.plugins.runtime(session.id),
        head: main,
        run,
        call: asId("w1"),
        name: "parker",
        args: {},
        context: {
          principal: LOCAL,
          authority: ALL_AUTHORITY,
          credential: { kind: "token", token: "" },
          origin: null,
        },
        signal: new AbortController().signal,
      }),
    ).toEqual({ kind: "parked" });
    turn.finish({ kind: "parked" });
    await step;

    const notified: string[] = [];
    holder.kernel.wakes.subscribe((woken, at) => notified.push(`${woken}/${at}`));

    expect(await other.host.session(session.id).part(asId("w1")).act("stop", {})).toEqual({
      kind: "ok",
      output: undefined,
    });
    expect(await readCall(other.kernel, session.id, "w1")).toMatchObject({
      waiting: null,
      waits: [{ kind: "stopped" }],
    });
    expect(await runOf(other.kernel, session.id, run)).toMatchObject({ parked: [], waiting: null });
    expect(await other.host.execution.repair({ limit: 10 })).toMatchObject({ runnable: [head] });

    await holder.kernel.waits.refresh();

    expect(notified).toEqual([`${session.id}/${main}`]);
    expect(await nextWake(holder.kernel, session.id)).toBeNull();
  });

  it("ends a stopped run's parked waits from any instance, and repair re-dispatches a stop whose dispatch was lost (ADV E-3 X1)", async () => {
    const holder = await setup({ plugins: [toolPlugin([parker])] });
    const other = await setup({ store: holder.kernel.store });
    const session = await holder.host.sessions.create();
    const head = { session: session.id, head: main };
    await session.send("Wait.");
    const step = holder.host.execution.advance(head);
    const turn = await holder.script.started(1);
    const run = turn.input.run.id;

    await executeCall(holder.kernel, {
      session: session.id,
      runtime: holder.kernel.plugins.runtime(session.id),
      head: main,
      run,
      call: asId("w1"),
      name: "parker",
      args: {},
      context: {
        principal: LOCAL,
        authority: ALL_AUTHORITY,
        credential: { kind: "token", token: "" },
        origin: null,
      },
      signal: new AbortController().signal,
    });
    turn.finish({ kind: "parked" });
    await step;

    expect(await other.host.session(session.id).run(run).stop()).toEqual({ kind: "requested" });
    expect(await runOf(other.kernel, session.id, run)).toMatchObject({
      stopping: true,
      parked: [],
    });
    expect((await readCall(other.kernel, session.id, "w1")).waits).toEqual([{ kind: "stopped" }]);

    const fresh = restart(holder.kernel);

    expect(await repair(fresh, { limit: 10 })).toMatchObject({ runnable: [head] });
  });

  it("wakes no head when its turn parks: the advance reports waiting itself (ADV E-2 N7)", async () => {
    const { kernel, host, script } = await setup({ plugins: [toolPlugin([parker])] });
    const session = await host.sessions.create();
    await session.send("Wait.");
    const notified: string[] = [];
    kernel.wakes.subscribe((woken, at) => notified.push(`${woken}/${at}`));
    const step = host.execution.advance({ session: session.id, head: main });
    const turn = await script.started(1);

    await executeCall(kernel, {
      session: session.id,
      runtime: kernel.plugins.runtime(session.id),
      head: main,
      run: turn.input.run.id,
      call: asId("w1"),
      name: "parker",
      args: {},
      context: {
        principal: LOCAL,
        authority: ALL_AUTHORITY,
        credential: { kind: "token", token: "" },
        origin: null,
      },
      signal: new AbortController().signal,
    });
    turn.finish({ kind: "parked" });

    expect(await step).toMatchObject({ kind: "waiting" });
    expect(notified).toEqual([]);
  });

  it("answers a modal whose step stopped waiting on it: the answer stays on the part, answer() resolves and a later step takes it; a modal no longer live refuses the act and its pending answer() resolves null (ADV B N1, B-3 N1)", async () => {
    const { kernel, host } = await setup();
    const cold = await setup({ store: kernel.store });
    const session = await host.sessions.create();
    const part = await session.parts.create(question, { state: {}, placement: { kind: "modal" } });
    const at = Date.now() + 60_000;

    await waitStep(kernel, {
      session: session.id,
      call: "s1",
      body: waiting({
        kind: "any",
        targets: [
          { kind: "part", part: part.id },
          { kind: "timer", until: at },
        ],
      }),
    });
    await kernel.waits.tick(at);

    expect((await readCall(kernel, session.id, "s1")).waits).toEqual([{ kind: "timer" }]);
    expect(await part.act("answer", { choice: "yes" })).toEqual({ kind: "ok", output: undefined });
    expect(await part.answer()).toEqual(yes);
    expect(await cold.host.session(session.id).part(part.id).answer()).toEqual(yes);
    expect(await partStatus(kernel, session.id, part.id)).toMatchObject({
      kind: "live",
      answer: yes,
    });
    expect(
      await waitStep(kernel, {
        session: session.id,
        call: "s2",
        body: waiting({ kind: "part", part: part.id }),
      }),
    ).toEqual({ kind: "done", value: { kind: "part", part: part.id, answer: yes } });

    const failed = await session.parts.create(question, {
      state: {},
      placement: { kind: "modal" },
    });

    const pending = failed.answer();

    const updates = await failedParts(kernel.store, session.id, main, [failed.id], {
      class: "aborted",
      message: "Stopped.",
    });

    await commit(kernel, updates);

    expect(await failed.act("answer", { choice: "late" })).toEqual({ kind: "closed" });
    expect(await cold.host.session(session.id).part(failed.id).answer()).toBeNull();
    expect(
      await Promise.race([pending, new Promise((resolve) => setTimeout(resolve, 10, "pending"))]),
    ).toBeNull();
  });

  it("resolves a pending answer() null when the stop fence fails its modal, on a host with no poll (ADV B-3 N1)", async () => {
    const { kernel, host } = await setup();
    const session = await host.sessions.create();

    const { id: run } = await startRun(
      kernel,
      session.id,
      main,
      { kind: "continuation", from: "wake" },
      configuration,
    );

    const part = await session.parts.create(question, { state: {}, placement: { kind: "modal" } });
    const record = await partRecord(kernel, session.id, part.id);

    await commit(kernel, [
      {
        name: partRef(session.id, part.id),
        target: await put(kernel.store, "part", { ...record, run, status: { kind: "live", run } }),
        events: [
          {
            head: main,
            kind: "part",
            part: part.id,
            change: "created",
            partKind: record.partKind,
            placement: record.placement,
            state: record.state,
            version: record.version,
            run,
            owner: record.owner,
          },
        ],
      },
    ]);
    const pending = part.answer();

    expect(kernel.poll).toBeNull();
    expect((await session.run(run).stop()).kind).toBe("requested");
    expect(await partStatus(kernel, session.id, part.id)).toMatchObject({ kind: "failed" });
    expect(
      await Promise.race([pending, new Promise((resolve) => setTimeout(resolve, 10, "pending"))]),
    ).toBeNull();
  });

  it("keeps an early answer on the part when a step takes it: a cold answer() returns it and a later act does not replace it (ADV B N2)", async () => {
    const { kernel, host } = await setup();
    const cold = await setup({ store: kernel.store });
    const session = await host.sessions.create();
    const part = await session.parts.create(question, { state: {}, placement: { kind: "modal" } });
    const early = { action: "answer", input: { choice: "early" } };

    expect(await part.act("answer", { choice: "early" })).toEqual({
      kind: "ok",
      output: undefined,
    });
    expect(
      await waitStep(kernel, {
        session: session.id,
        call: "s1",
        body: waiting({ kind: "part", part: part.id }),
      }),
    ).toEqual({ kind: "done", value: { kind: "part", part: part.id, answer: early } });
    expect(await partStatus(kernel, session.id, part.id)).toMatchObject({
      kind: "live",
      answer: early,
    });
    expect(await cold.host.session(session.id).part(part.id).answer()).toEqual(early);
    expect(
      await cold.host.session(session.id).part(part.id).act("answer", { choice: "late" }),
    ).toEqual({
      kind: "ok",
      output: undefined,
    });
    expect(
      await waitStep(kernel, {
        session: session.id,
        call: "s2",
        body: waiting({ kind: "part", part: part.id }),
      }),
    ).toEqual({ kind: "done", value: { kind: "part", part: part.id, answer: early } });
  });

  it("settles every step parked on a part from the answer the store holds, on a cold host (ADV B N3)", async () => {
    const { kernel, host } = await setup();
    const session = await host.sessions.create();
    const part = await session.parts.create(question, { state: {}, placement: { kind: "modal" } });

    for (const call of ["s1", "s2"])
      expect(
        await waitStep(kernel, {
          session: session.id,
          call,
          body: waiting({ kind: "part", part: part.id }),
        }),
      ).toEqual({ kind: "parked" });

    const answering = await setup({ store: kernel.store });

    expect(
      await answering.host.session(session.id).part(part.id).act("answer", { choice: "yes" }),
    ).toEqual({
      kind: "ok",
      output: undefined,
    });
    for (const call of ["s1", "s2"])
      expect(await readCall(kernel, session.id, call)).toMatchObject({
        waiting: null,
        waits: [{ kind: "part", part: part.id, answer: yes }],
      });
  });

  it("re-runs a part action parked across a restart once a wake written there completes its wait (ADV B N5, §33j)", async () => {
    const { kernel, host } = await setup();
    kernel.partDefinitions.register(holding, "plugin");
    const session = await host.sessions.create();

    const part = await session.parts.create(holding, {
      state: { done: false },
      placement: { kind: "panel" },
    });

    const at = Date.now() + 60_000;
    ran.length = 0;
    void part.act("hold", { until: at });

    const call = await until(async () => {
      for (const ref of await kernel.store.refs.list(`sessions/${session.id}/calls/`)) {
        const record = decodeCallRecord(
          ref.target ? await kernel.store.objects.get(ref.target) : null,
        );

        if (record?.waiting !== null && record !== null) return record.id;
      }

      return undefined;
    });

    const second = restart(kernel);
    second.partDefinitions.register(holding, "plugin");
    await loadWaits(second);
    await second.waits.tick(at);

    const settled = await until(async () => {
      const record = await readCall(second, session.id, call);

      return record.result === null ? undefined : record;
    });

    expect(settled).toMatchObject({
      waits: [{ kind: "timer" }],
      result: { kind: "done", output: { woke: "timer" } },
    });
    expect(ran).toEqual([LOCAL, LOCAL]);
    expect(
      (await host.session(session.id).view()).parts.find((view) => view.id === part.id)?.state,
    ).toEqual({
      done: true,
    });
  });

  it("re-runs a woken action step once while its act is live on another instance: the re-run reserves the step in the store before it executes", async () => {
    const holder = await setup();
    const other = await setup({ store: holder.kernel.store });

    for (const kernel of [holder.kernel, other.kernel])
      kernel.partDefinitions.register(gated, "plugin");
    const session = await holder.host.sessions.create();

    const part = await session.parts.create(gated, {
      state: { done: false },
      placement: { kind: "panel" },
    });

    const at = Date.now() + 60_000;
    resumed.length = 0;
    released = Promise.withResolvers();
    const acting = part.act("hold", { until: at });

    const call = await until(async () => {
      for (const ref of await holder.kernel.store.refs.list(`sessions/${session.id}/calls/`)) {
        const record = decodeCallRecord(
          ref.target ? await holder.kernel.store.objects.get(ref.target) : null,
        );

        if (record !== null && record.waiting !== null) return record.id;
      }

      return undefined;
    });

    await loadWaits(other.kernel, [session.id]);
    await other.kernel.waits.tick(at);
    await until(async () => (resumed.length === 1 ? true : undefined));
    await holder.kernel.waits.refresh();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(resumed).toHaveLength(1);
    released.resolve();
    await until(async () =>
      (await readCall(holder.kernel, session.id, call)).result === null ? undefined : true,
    );
    await holder.kernel.waits.refresh();

    expect(await acting).toEqual({ kind: "ok", output: { woke: "timer" } });
    expect(resumed).toHaveLength(1);
  });

  it("hands a woken action over once its re-run's holder dies mid-handler: the act's holder takes it when the claim lapses (ADV B-3 R1)", async () => {
    const holder = await setup();
    const other = await setup({ store: holder.kernel.store });

    for (const kernel of [holder.kernel, other.kernel])
      kernel.partDefinitions.register(dying, "plugin");
    const session = await holder.host.sessions.create();

    const part = await session.parts.create(dying, {
      state: { done: false },
      placement: { kind: "panel" },
    });

    const at = Date.now() + 60_000;
    resumed.length = 0;
    const acting = part.act("hold", { until: at });
    const call = await parkedCall(holder.kernel, session.id);

    await loadWaits(other.kernel, [session.id]);
    await other.kernel.waits.tick(at);
    await until(async () => (resumed.length === 1 ? true : undefined));
    await holder.kernel.waits.refresh();

    expect((await readCall(holder.kernel, session.id, call)).reran).toMatchObject({
      waits: 1,
      holder: other.kernel.instance,
    });

    await leaseLater(async () => {
      await holder.kernel.waits.refresh();

      expect(await acting).toEqual({ kind: "ok", output: { woke: "timer" } });
    });

    expect(resumed).toHaveLength(2);
  });

  it("re-runs a woken action once after a restart and repair when its re-run's holder died mid-handler (ADV B-3 R1)", async () => {
    const holder = await setup();
    const other = await setup({ store: holder.kernel.store });

    for (const kernel of [holder.kernel, other.kernel])
      kernel.partDefinitions.register(dying, "plugin");
    const session = await holder.host.sessions.create();

    const part = await session.parts.create(dying, {
      state: { done: false },
      placement: { kind: "panel" },
    });

    const at = Date.now() + 60_000;
    resumed.length = 0;
    void part.act("hold", { until: at });
    const call = await parkedCall(holder.kernel, session.id);

    await loadWaits(other.kernel, [session.id]);
    await other.kernel.waits.tick(at);
    await until(async () => (resumed.length === 1 ? true : undefined));

    const second = restart(holder.kernel);
    second.partDefinitions.register(dying, "plugin");

    await leaseLater(async () => {
      await repair(second, { limit: 10 });
      await repair(second, { limit: 10 });

      expect(
        await until(async () => {
          const record = await readCall(second, session.id, call);

          return record.result === null ? undefined : record.result;
        }),
      ).toEqual({ kind: "done", output: { woke: "timer" } });
    });

    expect(resumed).toHaveLength(2);
  });

  it("wakes an untilInput wait parked on another instance when the user sends here, and a wait on a modal another instance closes (ADV B N6, E N5)", async () => {
    const holder = await setup();
    const other = await setup({ store: holder.kernel.store });
    const session = await holder.host.sessions.create();
    const run = await liveRun(holder.kernel, session.id);
    const part = await session.parts.create(question, { state: {}, placement: { kind: "modal" } });
    const notified: string[] = [];
    holder.kernel.wakes.subscribe((woken, at) => notified.push(`${woken}/${at}`));

    await waitStep(holder.kernel, {
      session: session.id,
      call: "c1",
      run,
      body: waiting({
        kind: "any",
        targets: [{ kind: "timer", until: Date.now() + 60_000 }],
        untilInput: true,
      }),
    });
    await waitStep(holder.kernel, {
      session: session.id,
      call: "c2",
      run,
      body: waiting({ kind: "part", part: part.id }),
    });

    const receipt = await other.host.session(session.id).send("Change of plan.");

    expect((await readCall(other.kernel, session.id, "c1")).waits).toEqual([
      { kind: "input", message: receipt.message },
    ]);

    await other.host.session(session.id).part(part.id).close();

    expect((await readCall(other.kernel, session.id, "c2")).waits).toEqual([
      { kind: "part", part: part.id, answer: null },
    ]);
    expect(await runOf(other.kernel, session.id, run)).toMatchObject({ parked: [], waiting: null });

    await holder.kernel.waits.refresh();

    expect(notified).toEqual([`${session.id}/${main}`, `${session.id}/${main}`]);
  });

  it("settles a timer once across instances: a wait another instance settled is no head's next deadline, and a tick here leaves it", async () => {
    const { kernel, host } = await setup();
    const session = await host.sessions.create();
    const at = Date.now() + 60_000;

    await waitStep(kernel, {
      session: session.id,
      call: "c1",
      body: waiting({ kind: "timer", until: at }),
    });

    const elsewhere = restart(kernel);
    await loadWaits(elsewhere);
    await elsewhere.waits.tick(at);

    expect(await nextWake(kernel, session.id)).toBeNull();
    await kernel.waits.tick(at);
    expect((await readCall(kernel, session.id, "c1")).waits).toEqual([{ kind: "timer" }]);
  });

  it("judges a wait held here again from the store: repair settles one whose part went away, and a slot at an older wait gives way to the stored one (ADV E N1)", async () => {
    const { kernel, host } = await setup();
    const session = await host.sessions.create();
    const part = await session.parts.create(question, { state: {}, placement: { kind: "modal" } });

    await waitStep(kernel, {
      session: session.id,
      call: "c1",
      body: waiting({ kind: "part", part: part.id }),
    });

    const ref = await kernel.store.refs.get(partRef(session.id, part.id));
    assert(ref !== null);
    await kernel.store.refs.set([{ name: ref.name, target: null, expect: ref.revision }]);
    await loadWaits(kernel, [session.id]);

    expect((await readCall(kernel, session.id, "c1")).waits).toEqual([
      { kind: "part", part: part.id, answer: null },
    ]);

    const first = Date.now() + 60_000;
    const second = first + 1_000;

    const twice = async (durable: Durable): Promise<Json> => {
      await durable.wait({ kind: "timer", until: first });

      return durable.wait({ kind: "timer", until: second });
    };

    await waitStep(kernel, { session: session.id, call: "c2", body: twice });

    const elsewhere = restart(kernel);
    await loadWaits(elsewhere);
    await elsewhere.waits.tick(first);
    await waitStep(elsewhere, { session: session.id, call: "c2", body: twice });
    await kernel.waits.refresh();

    expect(await nextWake(kernel, session.id)).toBe(second);
    await kernel.waits.tick(second);
    expect((await readCall(kernel, session.id, "c2")).waits).toEqual([
      { kind: "timer" },
      { kind: "timer" },
    ]);
  });
});
