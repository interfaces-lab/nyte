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
import { assert, describe, expect, it, vi } from "vitest";
import { holdLease } from "../src/engine/lease.ts";
import { createKernel } from "../src/compose.ts";
import { runStep } from "../src/engine/durable.ts";
import { endRun } from "../src/engine/runs.ts";
import { loadWaits } from "../src/engine/waits.ts";
import { definePart } from "../src/index.ts";
import { callRef, decodeCallRecord, decodeRunRecord, memoryStore, runRef } from "../src/store.ts";
import type { Kernel, StepOutcome } from "../src/contract/kernel.ts";
import type { ActionContext, ActionOutput, Durable } from "../src/index.ts";
import type { CallRecord } from "../src/store.ts";
import { kernelOver, world } from "./fake-env.ts";
import {
  completed,
  configuration,
  label,
  livePart,
  main,
  setup,
  startRun,
  until,
} from "./harness.ts";

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

const question = definePart({
  kind: "test/question",
  state: standard(Type.Object({})),
  actions: { answer: { input: standard(Type.Object({ choice: Type.String() })) } },
  fallback: (_state, { id }) => `Ask ${id}`,
});

const timed = definePart({
  kind: "test/timed",
  state: timedState,
  actions: timedActions,
  fallback: (_state, { id }) => `Timed ${id}`,
  onAction: (action, input, context) => timedHandlers[action](input, context),
});

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
    expect(await kernel.waits.runEnded(child.id, asId("r-child"), completed, [])).toBe(true);

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

    await kernel.waits.tick(at);
    expect(await readCall(kernel, session.id, both)).toMatchObject({
      waits: [],
      partial: [{ kind: "timer" }, null],
    });
    expect(await kernel.waits.runEnded(session.id, asId("r1"), completed, [])).toBe(true);

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
    await kernel.waits.tick(at + 1);
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
    await kernel.waits.tick(deadline - 1);
    expect((await readCall(kernel, session.id, call)).waits).toEqual([]);
    await kernel.waits.tick(deadline);
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
      source: { kind: "child", session: session.id, end: "completed" },
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
    ).toEqual({ kind: "interrupted", value: "interrupted" });
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

    await second.waits.tick(at);
    expect((await readCall(second, session.id, call)).waits).toEqual([]);
    await loadWaits(second);

    expect(second.waits.nextDeadline(session.id, main)).toBe(at);
    await second.waits.tick(at);
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

    await kernel.waits.tick(at);
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
    await kernel.waits.tick(first.until);
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
    await kernel.waits.tick(second.until);
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

    expect(await kernel.waits.runEnded(child.id, asId("r2"), completed, [])).toBe(true);
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
    await kernel.waits.tick(at);
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

  it("wakes at once a wait whose target already settled, whatever its kind; a modal answered before the park settles the step without parking (§48i)", async () => {
    const { kernel, host } = await setup();
    const session = await host.sessions.create();

    const question = definePart({
      kind: "test/ask",
      state: standard(Type.Object({})),
      actions: { answer: { input: standard(Type.Object({ choice: Type.String() })) } },
      fallback: (_state, { id }) => `Ask ${id}`,
    });

    const closed = await session.parts.create(question, {
      state: {},
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
      [
        "job",
        { kind: "job", job: asId("j1") },
        { kind: "job", job: asId("j1"), end: { kind: "lost" } },
      ],
      [
        "run",
        { kind: "run", session: child.id, run: ended },
        { kind: "run", session: child.id, run: ended, end: completed },
      ],
    ];

    for (const [name, target, outcome] of targets) {
      const call: CallId = asId(name);

      expect(await step(kernel, { session: session.id, call, body: waiting(target) })).toEqual(
        name === "answered" ? { kind: "done", value: "part" } : { kind: "parked" },
      );
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

    await first.kernel.waits.partClosed(session.id, asId("p1"), null);

    const second = createKernel({
      hostId: first.kernel.hostId,
      store,
      description: first.kernel.description,
      host: first.kernel.host,
    });

    await loadWaits(second);

    await second.waits.tick(at);
    expect((await readCall(second, session.id, call)).waits).toEqual([
      {
        kind: "all",
        outcomes: [{ kind: "timer" }, { kind: "part", part: asId("p1"), answer: null }],
      },
    ]);
  });

  it("returns the result its record holds from the settle that wrote it, on the first run as on a replay (B F7)", async () => {
    const { kernel, host } = await setup();
    const session = await host.sessions.create();

    const run = () =>
      runStep<string>(kernel, {
        session: session.id,
        head: main,
        run: null,
        call: asId("c1"),
        kind: "hook",
        replay: "safe",
        intent: { test: true },
        part: null,
        signal: new AbortController().signal,
        body: async () => "BODY",
        settle: async () => ({ result: "RECORDED", updates: [] }),
        decode: (result) => (typeof result === "string" ? result : null),
      });

    expect(await run()).toEqual({ kind: "done", value: "RECORDED" });
    expect(await run()).toEqual({ kind: "done", value: "RECORDED" });
  });

  it("settles an action whose handler throws as failed, rejecting with the error and replaying it without running again", async () => {
    const { kernel, host } = await setup();
    const session = await host.sessions.create();
    let ran = 0;

    const act = () =>
      kernel.durable.run({
        session: session.id,
        part: asId("p1"),
        action: "boom",
        call: asId("boom"),
        signal: new AbortController().signal,
        body: async () => {
          ran += 1;

          throw new Error("Boom.");
        },
      });

    await expect(act()).rejects.toThrow("Boom.");
    expect((await readCall(kernel, session.id, asId("boom"))).result).toEqual({
      kind: "failed",
      failed: "Boom.",
    });
    await expect(act()).rejects.toMatchObject({ code: "internal", message: "Boom." });
    expect(ran).toBe(1);
  });

  it("rejects an action's output that is not JSON at settlement and on replay, recording nothing; undefined replays as undefined (D3b, audit 2 item 2)", async () => {
    const { kernel, host } = await setup();
    const session = await host.sessions.create();
    let ran = 0;

    const act = (call: string, big: boolean) =>
      kernel.durable.run({
        session: session.id,
        part: asId("p1"),
        action: "count",
        call: asId(call),
        signal: new AbortController().signal,
        body: async () => {
          ran += 1;

          return big ? 12n : undefined;
        },
      });

    for (let replay = 0; replay < 2; replay += 1)
      await expect(act("big", true)).rejects.toMatchObject({
        code: "invalid",
        message: expect.stringMatching(/count action on part p1/),
      });

    expect(ran).toBe(2);
    expect((await readCall(kernel, session.id, asId("big"))).result).toBeNull();

    ran = 0;
    expect(await act("void", false)).toEqual({ kind: "done", value: undefined });
    expect(await act("void", false)).toEqual({ kind: "done", value: undefined });
    expect(ran).toBe(1);
    expect((await readCall(kernel, session.id, asId("void"))).result).toEqual({ kind: "done" });

    const counterActions = {
      count: { input: standard(Type.Object({})), output: standard(Type.Unknown()) },
    };

    const counting: {
      readonly [A in keyof typeof counterActions]: () => Promise<
        ActionOutput<(typeof counterActions)[A]>
      >;
    } = { count: async () => 12n };

    const counter = definePart({
      kind: "test/counter",
      state: standard(Type.Object({})),
      actions: counterActions,
      fallback: (_state, { id }) => `Counter ${id}`,
      onAction: (action) => counting[action](),
    });

    kernel.partDefinitions.register(counter, "plugin");
    const part = await session.parts.create(counter, { state: {}, placement: { kind: "panel" } });

    expect(await part.act("count", {})).toEqual({
      kind: "rejected",
      reason: `The count action on part ${part.id} returned output that is not JSON.`,
    });
  });

  it("records a cold child end on an all() whose job another instance holds, which completes once the job ends there (audit D2 item 1, mixed wait)", async () => {
    const { kernel, host, provider, workspace } = await world();
    const parent = await host.sessions.create({ workspace });
    const child = await host.sessions.create({ parent: parent.id });

    const job = await host
      .workspace((await parent.info()).workspace)
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
    const targets: readonly WaitTarget[] = [
      { kind: "job", job: job.id },
      { kind: "run", session: child.id, run: run.id },
    ];

    expect(
      await step(kernel, {
        session: parent.id,
        call,
        run: own.id,
        body: waiting({ kind: "all", targets }),
      }),
    ).toEqual({ kind: "parked" });

    const cold = kernelOver(kernel.store, provider);
    await endRun(cold, child.id, run.id, completed);
    const ran: WaitOutcome = { kind: "run", session: child.id, run: run.id, end: completed };

    expect(await readCall(cold, parent.id, call)).toMatchObject({
      waiting: { kind: "all", targets },
      partial: [null, ran],
      waits: [],
    });

    const exited = { kind: "exited", code: 0, reason: "exited" } as const;
    expect(await kernel.waits.jobEnded(job.id, exited)).toBe(true);
    expect(await readCall(kernel, parent.id, call)).toMatchObject({
      waiting: null,
      waits: [{ kind: "all", outcomes: [{ kind: "job", job: job.id, end: exited }, ran] }],
    });
  });

  it("keeps the run waiting while another of its calls is parked, when a host that parked neither settles one (B F3)", async () => {
    const store = await memoryStore().open();
    const first = await setup({ store });
    const second = await setup({ store });
    const session = await first.host.sessions.create();
    const run = await liveRun(first.kernel, session.id);
    const part = await session.parts.create(question, { state: {}, placement: { kind: "modal" } });
    const far: WaitTarget = { kind: "timer", until: Date.now() + 60_000 };

    await step(first.kernel, { session: session.id, call: asId("a"), run, body: waiting(far) });
    await step(first.kernel, {
      session: session.id,
      call: asId("b"),
      run,
      body: waiting({ kind: "part", part: part.id }),
    });

    expect((await runRecord(first.kernel, session.id, run))?.parked).toEqual(["a", "b"]);
    await second.host.session(session.id).part(part.id).act("answer", { choice: "yes" });

    expect((await readCall(second.kernel, session.id, asId("b"))).waits).toMatchObject([
      { kind: "part", part: part.id },
    ]);
    expect((await readCall(second.kernel, session.id, asId("a"))).waiting).toEqual(far);
    expect(await runRecord(second.kernel, session.id, run)).toMatchObject({
      waiting: far,
      parked: ["a"],
    });
  });
});

describe("holdLease", () => {
  it("aborts its work once a renewal is refused, or none lands before the claim lapses, even while one hangs", async () => {
    vi.useFakeTimers();

    try {
      const answers = [true, false];
      const refused = holdLease("refused", async () => answers.shift() ?? false, {
        every: 10,
        lapse: 100,
      });

      await vi.advanceTimersByTimeAsync(10);
      expect(refused.signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(10);
      expect(refused.signal.aborted).toBe(true);

      const failing = holdLease(
        "failing",
        async () => {
          throw new Error("The store is down.");
        },
        { every: 10, lapse: 35 },
      );

      await vi.advanceTimersByTimeAsync(30);
      expect(failing.signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(10);
      expect(failing.signal.aborted).toBe(true);

      const hanging = holdLease("hanging", () => new Promise<boolean>(() => {}), {
        every: 10,
        lapse: 35,
      });

      await vi.advanceTimersByTimeAsync(30);
      expect(hanging.signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(10);
      expect(hanging.signal.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
