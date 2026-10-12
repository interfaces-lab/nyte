import { asId, standard } from "@nyte-ai/schema";
import type { Awaitable, Infer, Json, PartId, RunId, SessionId } from "@nyte-ai/schema";
import { Type } from "typebox";
import { assert, describe, expect, it } from "vitest";
import {
  LOCAL,
  ALL_AUTHORITY,
  callRef,
  createKernel,
  decodeCallRecord,
  decodePartRecord,
  decodeRunRecord,
  definePart,
  executeCall,
  failedParts,
  loadWaits,
  partRef,
  runRef,
  runStep,
  startRun,
} from "../src/index.ts";
import type {
  ActionContext,
  ActionOutput,
  CallRecord,
  Durable,
  Kernel,
  ToolDefinition,
  ToolSource,
} from "../src/index.ts";
import { commit } from "../src/session-state.ts";
import { configuration, main, setup, until } from "./harness.ts";

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

/** Runs a test step that waits once and returns the outcome; its result records it. */
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

/** Returns a body that waits on a target and returns the whole outcome. */
function waiting(target: Parameters<Durable["wait"]>[0]) {
  return async (durable: Durable): Promise<Json> => durable.wait(target);
}

async function readCall(kernel: Kernel, session: SessionId, id: string): Promise<CallRecord> {
  const ref = await kernel.store.refs.get(callRef(session, asId<"call">(id)));
  const record = decodeCallRecord(ref?.target ? await kernel.store.objects.get(ref.target) : null);
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

/** Returns a new kernel over a host's store, holding nothing in memory: a restart. */
function restart(kernel: Kernel): Kernel {
  return createKernel({
    hostId: kernel.hostId,
    store: kernel.store,
    description: kernel.description,
    host: kernel.host,
  });
}

function tools(definition: ToolDefinition): () => ToolSource {
  return () => ({
    get: (name) => (name === definition.name ? { definition, owner: "test" } : undefined),
    list: () => [],
    activate: async () => undefined,
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
    const holder = await setup({ tools: tools(parker) });
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
        runtime: holder.kernel.pluginsFor(session.id),
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

    await holder.kernel.waits.settleFromStore();

    expect(notified).toEqual([`${session.id}/${main}`]);
    expect(holder.kernel.waits.nextDeadline(session.id, main)).toBeNull();
  });

  it("answers a modal whose step stopped waiting on it: the answer stays on the part, answer() resolves and a later step takes it; a modal no longer live refuses the act (ADV B N1)", async () => {
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

    const updates = await failedParts(kernel, session.id, main, [failed.id], {
      class: "aborted",
      message: "Stopped.",
    });

    await commit(kernel, updates);

    expect(await failed.act("answer", { choice: "late" })).toEqual({ kind: "closed" });
    expect(await cold.host.session(session.id).part(failed.id).answer()).toBeNull();
    expect(
      await Promise.race([pending, new Promise((resolve) => setTimeout(resolve, 10, "pending"))]),
    ).toBe("pending");
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
    expect((await readCall(kernel, session.id, "s2")).waits).toEqual([
      { kind: "part", part: part.id, answer: yes },
    ]);
    expect((await readCall(kernel, session.id, "s1")).waits).toEqual([]);

    await loadWaits(restart(kernel));

    expect(await readCall(kernel, session.id, "s1")).toMatchObject({
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

    await holder.kernel.waits.settleFromStore();

    expect(notified).toEqual([`${session.id}/${main}`, `${session.id}/${main}`]);
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
    await kernel.waits.settleFromStore();

    expect(kernel.waits.nextDeadline(session.id, main)).toBe(second);
    await kernel.waits.tick(second);
    expect((await readCall(kernel, session.id, "c2")).waits).toEqual([
      { kind: "timer" },
      { kind: "timer" },
    ]);
  });
});
