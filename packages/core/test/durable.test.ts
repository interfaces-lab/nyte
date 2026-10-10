import { asId, asSeq, standard } from "@nyte-ai/schema";
import type {
  Awaitable,
  CallId,
  Infer,
  Json,
  PartId,
  RunId,
  SessionId,
  WaitOutcome,
  WaitTarget,
} from "@nyte-ai/schema";
import { Type } from "typebox";
import { assert, describe, expect, it } from "vitest";
import {
  callRef,
  createKernel,
  decodeCallRecord,
  decodeRunRecord,
  definePart,
  endRun,
  loadWaits,
  memoryStore,
  runRef,
  runStep,
  startRun,
  text,
} from "../src/index.ts";
import type {
  ActionContext,
  ActionOutput,
  CallRecord,
  Durable,
  Kernel,
  StepOutcome,
} from "../src/index.ts";
import { completed, configuration, label, livePart, main, setup, until } from "./harness.ts";

const timedState = standard(Type.Object({}));

const timedActions = {
  hold: {
    input: standard(Type.Object({ until: Type.Number() })),
    output: standard(Type.Object({ woke: Type.String() })),
  },
};

type TimedActions = typeof timedActions;

const timedHandlers: {
  readonly [A in keyof TimedActions]: (
    input: Infer<TimedActions[A]["input"]>,
    context: ActionContext<Infer<typeof timedState>, TimedActions>,
  ) => Awaitable<ActionOutput<TimedActions[A]>>;
} = {
  hold: async (input, context) => ({
    woke: (await context.wait({ kind: "timer", until: input.until })).kind,
  }),
};

const timed = definePart({
  kind: "test/timed",
  state: timedState,
  actions: timedActions,
  fallback: (_state, { id }) => `Timed ${id}`,
  onAction: (action, input, context) => timedHandlers[action](input, context),
});

/** Runs a test step whose body returns JSON; its result records `{ ended }`. */
function step(
  kernel: Kernel,
  input: {
    readonly session: SessionId;
    readonly call: CallId;
    readonly run?: RunId;
    readonly part?: PartId;
    readonly replay?: "safe" | "never";
    readonly settled?: string[];
    body(durable: Durable): Promise<Json>;
  },
): Promise<StepOutcome<Json>> {
  return runStep<Json>(kernel, {
    session: input.session,
    head: main,
    run: input.run ?? null,
    call: input.call,
    kind: "hook",
    replay: input.replay ?? "safe",
    intent: { test: true },
    part: input.part ?? null,
    signal: new AbortController().signal,
    body: (durable) => input.body(durable),
    async settle(ended) {
      input.settled?.push(ended.kind);

      return { result: { ended: ended.kind === "done" ? ended.value : ended.kind }, updates: [] };
    },
    decode: (result) =>
      typeof result === "object" && result !== null && !Array.isArray(result) && "ended" in result
        ? result.ended
        : null,
  });
}

/** Returns a body that waits once and returns the outcome's kind. */
function waiting(target: Parameters<Durable["wait"]>[0]) {
  return async (durable: Durable): Promise<Json> => (await durable.wait(target)).kind;
}

async function readCall(kernel: Kernel, session: SessionId, call: CallId): Promise<CallRecord> {
  const ref = await kernel.store.refs.get(callRef(session, call));
  const record = decodeCallRecord(ref?.target ? await kernel.store.objects.get(ref.target) : null);
  assert(record !== null);

  return record;
}

async function runRecord(kernel: Kernel, session: SessionId, run: RunId) {
  const ref = await kernel.store.refs.get(runRef(session, run));

  return decodeRunRecord(ref?.target ? await kernel.store.objects.get(ref.target) : null);
}

async function runWaiting(kernel: Kernel, session: SessionId, run: RunId) {
  return (await runRecord(kernel, session, run))?.waiting;
}

/** Starts a run on main that no turn drives here, as a run parked on a wait is. */
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

describe("durable steps", () => {
  it("records a memo and clock readings once and replays them on a re-run", async () => {
    const { kernel, host } = await setup();
    const session = await host.sessions.create();
    const call: CallId = asId("c1");
    const computed: number[] = [];
    const readings: (readonly number[])[] = [];

    const body = async (durable: Durable): Promise<Json> => {
      const issue = await durable.memo("issue", () => {
        computed.push(computed.length);

        return { title: `Issue ${computed.length}` };
      });

      readings.push([durable.now(), durable.now()]);

      if (readings.length === 1) throw new Error("The host died.");

      return issue;
    };

    await expect(step(kernel, { session: session.id, call, body })).rejects.toThrow(
      "The host died.",
    );
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(await step(kernel, { session: session.id, call, body })).toEqual({
      kind: "done",
      value: { title: "Issue 1" },
    });
    expect(computed).toHaveLength(1);
    expect(readings[1]).toEqual(readings[0]);
    expect(await readCall(kernel, session.id, call)).toMatchObject({
      memos: { issue: { title: "Issue 1" } },
      clock: readings[0],
      result: { ended: { title: "Issue 1" } },
    });
    expect(await step(kernel, { session: session.id, call, body })).toEqual({
      kind: "done",
      value: { title: "Issue 1" },
    });
    expect(readings).toHaveLength(2);
  });

  it("parks on a wait, then a wake records the outcome and the re-run reads it", async () => {
    const { kernel, host } = await setup();
    const session = await host.sessions.create();
    const child = await host.sessions.create({ parent: session.id });
    const run = await liveRun(kernel, session.id);
    const call: CallId = asId("c1");
    const target: WaitTarget = { kind: "run", session: child.id, run: asId("r-child") };
    const notified: string[] = [];
    kernel.wakes.subscribe((woken, head) => notified.push(`${woken}/${head}`));
    const seen: WaitOutcome[] = [];

    const body = async (durable: Durable): Promise<Json> => {
      const outcome = await durable.wait(target);
      seen.push(outcome);

      return outcome.kind;
    };

    expect(await step(kernel, { session: session.id, call, run, body })).toEqual({
      kind: "parked",
    });
    expect(await readCall(kernel, session.id, call)).toMatchObject({ waiting: target, waits: [] });
    expect(await runWaiting(kernel, session.id, run)).toEqual(target);
    expect((await session.view()).execution).toMatchObject({ kind: "waiting", on: target });
    expect(await kernel.waits.runEnded(child.id, asId("r-child"), completed)).toBe(true);

    const outcome: WaitOutcome = {
      kind: "run",
      session: child.id,
      run: asId("r-child"),
      end: completed,
    };

    expect(await readCall(kernel, session.id, call)).toMatchObject({
      waiting: null,
      waits: [outcome],
    });
    expect(await runWaiting(kernel, session.id, run)).toBeNull();
    expect(notified).toEqual([`${session.id}/${main}`]);
    expect(await step(kernel, { session: session.id, call, run, body })).toEqual({
      kind: "done",
      value: "run",
    });
    expect(seen).toEqual([outcome]);
  });

  it("completes `all` once every target settles and `any` on the first", async () => {
    const { kernel, host } = await setup();
    const session = await host.sessions.create();
    const at = Date.now() + 60_000;
    const done: WaitTarget = { kind: "run", session: session.id, run: asId("r1") };
    const both: CallId = asId("both");
    const either: CallId = asId("either");

    await step(kernel, {
      session: session.id,
      call: both,
      body: waiting({ kind: "all", targets: [{ kind: "timer", until: at }, done] }),
    });
    await step(kernel, {
      session: session.id,
      call: either,
      body: waiting({ kind: "any", targets: [done, { kind: "timer", until: at + 1 }] }),
    });

    expect(await kernel.waits.tick(at)).toBe(false);
    expect(await readCall(kernel, session.id, both)).toMatchObject({
      waits: [],
      partial: [{ kind: "timer" }, null],
    });
    expect(await kernel.waits.runEnded(session.id, asId("r1"), completed)).toBe(true);

    const ended: WaitOutcome = {
      kind: "run",
      session: session.id,
      run: asId("r1"),
      end: completed,
    };

    expect((await readCall(kernel, session.id, both)).waits).toEqual([
      { kind: "all", outcomes: [{ kind: "timer" }, ended] },
    ]);
    expect((await readCall(kernel, session.id, either)).waits).toEqual([ended]);
    expect(await kernel.waits.tick(at + 1)).toBe(false);
  });

  it("fires a deadline through tick and reports it as the head's next deadline", async () => {
    const { kernel, host } = await setup();
    const session = await host.sessions.create();
    const deadline = Date.now() + 60_000;
    const call: CallId = asId("c1");

    await step(kernel, {
      session: session.id,
      call,
      body: waiting({ kind: "run", session: session.id, run: asId("r1"), deadline }),
    });

    expect(kernel.waits.nextDeadline(session.id, main)).toBe(deadline);
    expect(await kernel.waits.tick(deadline - 1)).toBe(false);
    expect(await kernel.waits.tick(deadline)).toBe(true);
    expect((await readCall(kernel, session.id, call)).waits).toEqual([{ kind: "deadline" }]);
    expect(kernel.waits.nextDeadline(session.id, main)).toBeNull();
  });

  it("wakes an untilInput wait when the user sends to its head, and for no other input", async () => {
    const { kernel, host } = await setup();
    const session = await host.sessions.create();
    const call: CallId = asId("c1");

    await step(kernel, {
      session: session.id,
      call,
      body: waiting({
        kind: "any",
        targets: [{ kind: "run", session: session.id, run: asId("r1") }],
        untilInput: true,
      }),
    });

    await session.send("A child reported.", {
      source: { kind: "child", session: session.id },
      delivery: "attach",
    });

    expect((await readCall(kernel, session.id, call)).waits).toEqual([]);

    const receipt = await session.send("Change of plan.");

    expect((await readCall(kernel, session.id, call)).waits).toEqual([
      { kind: "input", message: receipt.message },
    ]);
  });

  it("wakes the waits of a stopped run with stopped, after its fence", async () => {
    const { kernel, host } = await setup();
    const session = await host.sessions.create();
    const run = await liveRun(kernel, session.id);
    const call: CallId = asId("c1");

    await step(kernel, {
      session: session.id,
      call,
      run,
      body: waiting({ kind: "timer", until: Date.now() + 60_000 }),
    });

    expect(await session.run(run).stop()).toEqual({ kind: "requested" });
    expect((await readCall(kernel, session.id, call)).waits).toEqual([{ kind: "stopped" }]);

    const log = (await kernel.store.refs.log(session.id, asSeq(0), 100)).map(label);

    expect(log.indexOf("run:stopping")).toBeGreaterThan(log.indexOf("run:waiting"));
  });

  it("settles a never step with a pending wait as interrupted on its re-run", async () => {
    const { kernel, host } = await setup();
    const session = await host.sessions.create();
    const call: CallId = asId("c1");
    const settled: string[] = [];
    let runs = 0;

    const body = async (durable: Durable): Promise<Json> => {
      runs += 1;

      return waiting({ kind: "timer", until: Date.now() + 60_000 })(durable);
    };

    expect(
      await step(kernel, { session: session.id, call, replay: "never", settled, body }),
    ).toEqual({ kind: "parked" });
    expect(
      await step(kernel, { session: session.id, call, replay: "never", settled, body }),
    ).toEqual({ kind: "interrupted" });
    expect(runs).toBe(1);
    expect(settled).toEqual(["interrupted"]);
    expect(await readCall(kernel, session.id, call)).toMatchObject({
      waiting: null,
      result: { ended: "interrupted" },
    });
  });

  it("rebuilds parked waits from the store on a new kernel", async () => {
    const store = await memoryStore().open();
    const first = await setup({ store });
    const session = await first.host.sessions.create();
    const at = Date.now() + 60_000;
    const call: CallId = asId("c1");

    await step(first.kernel, {
      session: session.id,
      call,
      body: waiting({ kind: "timer", until: at }),
    });

    const second = createKernel({
      hostId: first.kernel.hostId,
      store,
      description: first.kernel.description,
      host: first.kernel.host,
    });

    expect(await second.waits.tick(at)).toBe(false);
    await loadWaits(second);

    expect(second.waits.nextDeadline(session.id, main)).toBe(at);
    expect(await second.waits.tick(at)).toBe(true);
    expect((await readCall(second, session.id, call)).waits).toEqual([{ kind: "timer" }]);
  });

  it("resolves a parked action's act once a wake completes its step", async () => {
    const { kernel, host } = await setup();
    const at = Date.now() + 60_000;
    kernel.partDefinitions.register(timed, "plugin");
    const session = await host.sessions.create();
    const part = await session.parts.create(timed, { state: {}, placement: { kind: "panel" } });
    const acting = part.act("hold", { until: at });

    await until(async () => {
      for (const ref of await kernel.store.refs.list(`sessions/${session.id}/calls/`)) {
        const record = decodeCallRecord(
          ref.target ? await kernel.store.objects.get(ref.target) : null,
        );

        if (record !== null && record.waiting !== null) return record;
      }

      return undefined;
    });

    expect(await kernel.waits.tick(at)).toBe(true);
    expect(await acting).toEqual({ kind: "ok", output: { woke: "timer" } });
  });

  it("parks an execution that parked even when a wake already cleared its wait (§33g)", async () => {
    const { kernel, host } = await setup();
    const session = await host.sessions.create();
    const call: CallId = asId("c1");
    const due = Date.now() - 1;

    const body = async (durable: Durable): Promise<Json> => {
      try {
        await durable.wait({ kind: "timer", until: due });
      } catch {
        return "swallowed";
      }

      return "woke";
    };

    expect(await step(kernel, { session: session.id, call, body })).toEqual({ kind: "parked" });
    expect(await readCall(kernel, session.id, call)).toMatchObject({
      waiting: null,
      waits: [{ kind: "timer" }],
      result: null,
    });
    expect(await step(kernel, { session: session.id, call, body })).toEqual({
      kind: "done",
      value: "woke",
    });
  });

  it("records each partial `all` outcome and shows the next unsettled target (§33d)", async () => {
    const { kernel, host } = await setup();
    const session = await host.sessions.create();
    const run = await liveRun(kernel, session.id);
    const part: PartId = asId("p1");
    await livePart(kernel, session.id, run, part, "Waiting.");
    const call: CallId = asId("c1");
    const first: WaitTarget = { kind: "timer", until: Date.now() + 60_000 };
    const second: WaitTarget = { kind: "timer", until: Date.now() + 120_000 };

    await step(kernel, {
      session: session.id,
      call,
      run,
      part,
      body: waiting({ kind: "all", targets: [first, second] }),
    });

    expect(await runWaiting(kernel, session.id, run)).toEqual(first);
    expect(kernel.waits.nextDeadline(session.id, main)).toBe(first.until);
    expect(await kernel.waits.tick(first.until)).toBe(false);
    expect(await readCall(kernel, session.id, call)).toMatchObject({
      waiting: { kind: "all" },
      partial: [{ kind: "timer" }, null],
      waits: [],
    });
    expect(await runWaiting(kernel, session.id, run)).toEqual(second);
    expect(kernel.waits.nextDeadline(session.id, main)).toBe(second.until);

    const view = await session.view();

    expect(view.execution).toMatchObject({ kind: "waiting", on: second });
    expect(view.messages.find((message) => message.id === asId(part))).toMatchObject({
      status: { kind: "waiting", run, on: second },
    });

    const log = (await kernel.store.refs.log(session.id, asSeq(0), 100)).map(label);

    expect(log.filter((entry) => entry === "call:waiting")).toHaveLength(2);
    expect(log.filter((entry) => entry === "run:waiting")).toHaveLength(2);
    expect(await kernel.waits.tick(second.until)).toBe(true);
    expect((await readCall(kernel, session.id, call)).waits).toEqual([
      { kind: "all", outcomes: [{ kind: "timer" }, { kind: "timer" }] },
    ]);
  });

  it("attaches no child report when a partial `all` consumed the child's end", async () => {
    const { kernel, host } = await setup();
    const parent = await host.sessions.create();
    const child = await host.sessions.create({ parent: parent.id });
    const run = await liveRun(kernel, parent.id);
    const ended = await liveRun(kernel, child.id);
    const later: WaitTarget = { kind: "timer", until: Date.now() + 60_000 };
    const call: CallId = asId("c1");

    await step(kernel, {
      session: parent.id,
      call,
      run,
      body: waiting({
        kind: "all",
        targets: [{ kind: "run", session: child.id, run: ended }, later],
      }),
    });
    await endRun(kernel, child.id, ended, completed);

    expect(await readCall(kernel, parent.id, call)).toMatchObject({
      waiting: { kind: "all" },
      partial: [{ kind: "run", session: child.id, run: ended, end: completed }, null],
      waits: [],
    });
    expect((await parent.view()).messages).toEqual([]);

    const other: CallId = asId("c2");

    await step(kernel, {
      session: parent.id,
      call: other,
      body: waiting({
        kind: "all",
        targets: [{ kind: "run", session: child.id, run: asId("r2") }, later],
      }),
    });

    expect(await kernel.waits.runEnded(child.id, asId("r2"), completed)).toBe(true);
    expect(await readCall(kernel, parent.id, other)).toMatchObject({
      waiting: { kind: "all" },
      waits: [],
    });
  });

  it("moves the run from waiting to live executing once a wake completes its step", async () => {
    const { kernel, host } = await setup();
    const session = await host.sessions.create();
    const run = await liveRun(kernel, session.id);
    const at = Date.now() + 60_000;

    await step(kernel, {
      session: session.id,
      call: asId("c1"),
      run,
      body: waiting({ kind: "timer", until: at }),
    });

    expect((await session.view()).execution).toMatchObject({ kind: "waiting" });
    expect(await kernel.waits.tick(at)).toBe(true);
    expect(await runRecord(kernel, session.id, run)).toMatchObject({
      waiting: null,
      phase: "executing",
    });
    expect((await session.view()).execution).toMatchObject({
      kind: "live",
      phase: "executing",
      stopping: false,
    });
  });

  it("wakes at once a wait whose target already settled, whatever its kind", async () => {
    const { kernel, host } = await setup();
    const session = await host.sessions.create();

    const question = definePart({
      kind: "test/ask",
      state: standard(Type.Object({})),
      actions: { answer: { input: standard(Type.Object({ choice: Type.String() })) } },
      fallback: (_state, { id }) => `Ask ${id}`,
    });

    const closed = await session.parts.create(text, {
      state: { markdown: "Gone." },
      placement: { kind: "panel" },
    });

    await closed.close();

    const answered = await session.parts.create(question, {
      state: {},
      placement: { kind: "modal" },
    });

    await answered.act("answer", { choice: "yes" });
    const child = await host.sessions.create({ parent: session.id });
    const ended = await liveRun(kernel, child.id);
    await endRun(kernel, child.id, ended, completed);
    const end = { kind: "exited", code: 0, reason: "exited" } as const;
    await kernel.waits.jobEnded(asId("j1"), end);

    const targets: readonly [string, WaitTarget, WaitOutcome][] = [
      [
        "closed",
        { kind: "part", part: closed.id },
        { kind: "part", part: closed.id, answer: null },
      ],
      [
        "answered",
        { kind: "part", part: answered.id },
        { kind: "part", part: answered.id, answer: { action: "answer", input: { choice: "yes" } } },
      ],
      ["job", { kind: "job", job: asId("j1") }, { kind: "job", job: asId("j1"), end }],
      [
        "run",
        { kind: "run", session: child.id, run: ended },
        { kind: "run", session: child.id, run: ended, end: completed },
      ],
    ];

    for (const [name, target, outcome] of targets) {
      const call: CallId = asId(name);

      expect(await step(kernel, { session: session.id, call, body: waiting(target) })).toEqual({
        kind: "parked",
      });
      expect(await readCall(kernel, session.id, call)).toMatchObject({
        waiting: null,
        waits: [outcome],
      });
    }
  });

  it("keeps partial `all` outcomes across a restart", async () => {
    const store = await memoryStore().open();
    const first = await setup({ store });
    const session = await first.host.sessions.create();
    const at = Date.now() + 60_000;
    const call: CallId = asId("c1");

    await step(first.kernel, {
      session: session.id,
      call,
      body: waiting({
        kind: "all",
        targets: [
          { kind: "timer", until: at },
          { kind: "part", part: asId("p1") },
        ],
      }),
    });

    expect(await first.kernel.waits.partClosed(asId("p1"))).toBe(false);

    const second = createKernel({
      hostId: first.kernel.hostId,
      store,
      description: first.kernel.description,
      host: first.kernel.host,
    });

    await loadWaits(second);

    expect(await second.waits.tick(at)).toBe(true);
    expect((await readCall(second, session.id, call)).waits).toEqual([
      {
        kind: "all",
        outcomes: [{ kind: "timer" }, { kind: "part", part: asId("p1"), answer: null }],
      },
    ]);
  });
});
