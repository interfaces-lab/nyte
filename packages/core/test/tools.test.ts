import { asId, asSeq, standard } from "@nyte-ai/schema";
import type { CallId, Json, RunId, SessionId, ToolOutcome } from "@nyte-ai/schema";
import { Type } from "typebox";
import { assert, describe, expect, it } from "vitest";
import {
  ALL_AUTHORITY,
  LOCAL,
  callRef,
  decodeCallRecord,
  decodeRunRecord,
  definePart,
  envelope,
  executeCall,
  isPart,
  memoryStore,
  runRef,
  startRun,
  text,
  tool,
} from "../src/index.ts";
import type {
  CallRecord,
  ConnectionContext,
  Kernel,
  Session,
  ToolDefinition,
  ToolSource,
} from "../src/index.ts";
import { configuration, main, recording, setup, until } from "./harness.ts";

const caller: ConnectionContext = {
  principal: LOCAL,
  authority: ALL_AUTHORITY,
  credential: { kind: "token", token: "x" },
  origin: null,
};

const echoes: string[] = [];

const echo = {
  name: "echo",
  description: "Echo the text.",
  parameters: standard(Type.Object({ text: Type.String() })),
  class: () => ({ kind: "custom", label: "Echoing" }),
  replay: "safe",
  execute: async (args) => {
    echoes.push(args.text);

    return { content: [{ kind: "text", text: args.text }] };
  },
} satisfies ToolDefinition<{ text: string }>;

/** Returns a tool source over the given definitions, each owned by "test". */
function source(definitions: readonly ToolDefinition[]): () => ToolSource {
  return () => ({
    get(name) {
      const definition = definitions.find((candidate) => candidate.name === name);

      return definition === undefined ? undefined : { definition, owner: "test" };
    },
    list: () => [],
    activate: async () => undefined,
  });
}

/** Returns a tool that runs until its call is stopped, recording each call once it is listening. */
function slowTool(started: string[]) {
  return {
    ...echo,
    name: "slow",
    execute: (_args, invocation) =>
      new Promise((resolve) => {
        invocation.signal.addEventListener(
          "abort",
          () => resolve({ content: [{ kind: "text", text: "late" }] }),
          { once: true },
        );
        started.push(invocation.call);
      }),
  } satisfies ToolDefinition<{ text: string }>;
}

/** Starts a run on main that no turn drives here, for calls the test runs itself. */
async function liveRun(kernel: Kernel, session: SessionId): Promise<RunId> {
  const run = await startRun(
    kernel,
    session,
    main,
    { kind: "continuation", from: "wake" },
    configuration,
  );

  return run.id;
}

function call(
  kernel: Kernel,
  input: {
    readonly session: SessionId;
    readonly run: RunId;
    readonly call: string;
    readonly name: string;
    readonly args: Json;
    readonly signal?: AbortSignal;
  },
) {
  return executeCall(kernel, {
    session: input.session,
    head: main,
    run: input.run,
    call: asId(input.call),
    name: input.name,
    args: input.args,
    context: caller,
    signal: input.signal ?? new AbortController().signal,
  });
}

async function readCall(kernel: Kernel, session: SessionId, id: string): Promise<CallRecord> {
  const ref = await kernel.store.refs.get(callRef(session, asId<"call">(id)));
  const record = decodeCallRecord(ref?.target ? await kernel.store.objects.get(ref.target) : null);
  assert(record !== null);

  return record;
}

async function readRun(kernel: Kernel, session: SessionId, run: RunId) {
  const ref = await kernel.store.refs.get(runRef(session, run));
  const record = decodeRunRecord(ref?.target ? await kernel.store.objects.get(ref.target) : null);
  assert(ref !== null && record !== null);

  return { ref, record };
}

/** Returns a scripted snapshots slot: `before` is s0, `after` s1, and only a diff from s0 changes `a.ts`; `taken` records each snapshot taken. */
function scripted(taken: string[]): NonNullable<Parameters<typeof setup>[0]>["snapshots"] {
  return async () => ({
    before: async () => {
      taken.push("before");

      return asId("s0");
    },
    after: async () => {
      taken.push("after");

      return asId("s1");
    },
    diff: async (from, to) => ({
      revision: to,
      files:
        from === asId("s0")
          ? [{ path: "a.ts", status: "modified", stat: { kind: "text", added: 3, removed: 1 } }]
          : [],
    }),
    patches: async () => [],
  });
}

/** Returns the tool part a call wrote, as the session's view shows it. */
async function toolPart(session: Session, id: string) {
  const message = (await session.view()).messages.find(
    (candidate) => candidate.kind === "part" && candidate.part === asId(id),
  );

  assert(message !== undefined && isPart(message, tool));

  return message;
}

describe("tool calls", () => {
  it("records the intent before execute and the result after, through calling, running and settled", async () => {
    const recorded = recording(await memoryStore().open());
    const seen: { readonly phase: string; readonly result: Json }[] = [];
    let kernel: Kernel | undefined;
    let session: Session | undefined;

    const watched = {
      ...echo,
      name: "watched",
      execute: async (args: { readonly text: string }) => {
        assert(kernel !== undefined && session !== undefined);
        const part = await toolPart(session, "c1");
        seen.push({
          phase: part.state.phase,
          result: (await readCall(kernel, session.id, "c1")).result,
        });

        return { content: [{ kind: "text", text: args.text }] };
      },
    } satisfies ToolDefinition<{ text: string }>;

    const built = await setup({ store: recorded.store, tools: source([watched]) });
    kernel = built.kernel;
    session = await built.host.sessions.create();
    const run = await liveRun(kernel, session.id);
    const hold = kernel.folds.acquire(session.id, LOCAL);
    await hold.ready();

    const outcome = await call(kernel, {
      session: session.id,
      run,
      call: "c1",
      name: "watched",
      args: { text: "hi" },
    });

    const ok: ToolOutcome = {
      kind: "ok",
      content: [{ kind: "text", text: "hi" }],
      output: null,
      parts: [],
    };

    expect(outcome).toEqual(ok);
    expect(seen).toEqual([{ phase: "running", result: null }]);
    expect(await readCall(kernel, session.id, "c1")).toMatchObject({
      kind: "tool",
      run,
      head: main,
      intent: { name: "watched", args: { text: "hi" }, principal: LOCAL },
      result: ok,
      replay: "safe",
    });
    expect(recorded.sets.filter((set) => set.length > 0).slice(-2)).toEqual([
      ["part:created", "call:intent"],
      ["call:settled", "part:settled", "commit"],
    ]);

    const created = (await kernel.store.refs.log(session.id, asSeq(0), 100)).find(
      (event) => event.kind === "part" && event.change === "created",
    );

    expect(created).toMatchObject({ state: { phase: "calling", name: "watched" }, run });

    const part = await toolPart(session, "c1");
    const tip = (await session.info()).heads[0]?.tip;

    expect(part.state).toMatchObject({ phase: "settled", outcome: ok, changes: null });
    expect(part.status).toEqual({
      kind: "settled",
      commit: tip?.kind === "commit" ? tip.id : null,
      endedAt: expect.any(Number),
    });
    expect(
      await call(kernel, { session: session.id, run, call: "c1", name: "watched", args: {} }),
    ).toEqual(ok);
    expect(seen).toHaveLength(1);
    hold.release();
  });

  it("fails an unknown tool and invalid arguments, and rejects at before_tool without running", async () => {
    const { kernel, host } = await setup({
      tools: source([echo]),
      beforeTool: async (proposed) => ({
        kind: "done",
        value:
          JSON.stringify(proposed.args) === JSON.stringify({ text: "forbidden" })
            ? { action: "reject", reason: "Not that." }
            : { action: "continue" },
      }),
    });

    const session = await host.sessions.create();
    const run = await liveRun(kernel, session.id);
    const ran = echoes.length;

    expect(
      await call(kernel, { session: session.id, run, call: "u1", name: "nope", args: {} }),
    ).toEqual({ kind: "failed", message: "No tool is named nope." });
    expect(
      await call(kernel, { session: session.id, run, call: "i1", name: "echo", args: { text: 1 } }),
    ).toMatchObject({ kind: "failed", message: expect.stringContaining("Invalid arguments") });
    expect(
      await call(kernel, {
        session: session.id,
        run,
        call: "r1",
        name: "echo",
        args: { text: "forbidden" },
      }),
    ).toEqual({ kind: "rejected", reason: "Not that." });
    expect(echoes.length).toBe(ran);
    expect((await toolPart(session, "r1")).state).toMatchObject({
      phase: "settled",
      outcome: { kind: "rejected", reason: "Not that." },
    });
  });

  it("rewrites the outcome through after_tool before it is recorded", async () => {
    const { kernel, host } = await setup({
      tools: source([echo]),
      afterTool: async (outcome) =>
        outcome.kind === "ok"
          ? { ...outcome, content: [{ kind: "text", text: "[redacted]" }] }
          : outcome,
    });

    const session = await host.sessions.create();
    const run = await liveRun(kernel, session.id);

    const rewritten = {
      kind: "ok",
      content: [{ kind: "text", text: "[redacted]" }],
      output: null,
      parts: [],
    };

    expect(
      await call(kernel, {
        session: session.id,
        run,
        call: "a1",
        name: "echo",
        args: { text: "secret" },
      }),
    ).toEqual(rewritten);
    expect((await readCall(kernel, session.id, "a1")).result).toEqual(rewritten);
    expect((await toolPart(session, "a1")).state).toMatchObject({ outcome: rewritten });
  });

  it("keys nested tools.execute calls and replays them when the step re-runs", async () => {
    let runs = 0;

    const parent = {
      name: "parent",
      description: "Call echo twice, then wait.",
      parameters: standard(Type.Object({ until: Type.Number() })),
      class: () => ({ kind: "custom", label: "Delegating" }),
      replay: "safe",
      execute: async (args, invocation) => {
        runs += 1;
        const first = await invocation.tools.execute("echo", { text: "a" });
        const second = await invocation.tools.execute("echo", { text: "b" }, { key: "second" });
        const woke = await invocation.wait({ kind: "timer", until: args.until });

        return {
          content: [{ kind: "text", text: `${first.kind} ${second.kind} ${woke.kind}` }],
        };
      },
    } satisfies ToolDefinition<{ until: number }>;

    const { kernel, host } = await setup({ tools: source([echo, parent]) });
    const session = await host.sessions.create();
    const run = await liveRun(kernel, session.id);
    const at = Date.now() + 60_000;
    const ran = echoes.length;
    const input = { session: session.id, run, call: "p1", name: "parent", args: { until: at } };

    expect(await call(kernel, input)).toEqual({ kind: "parked" });
    expect(echoes.slice(ran)).toEqual(["a", "b"]);
    expect((await session.view()).execution).toMatchObject({ kind: "waiting" });
    expect(await kernel.waits.tick(at)).toBe(true);
    expect(await call(kernel, input)).toMatchObject({
      kind: "ok",
      content: [{ kind: "text", text: "ok ok timer" }],
    });
    expect(runs).toBe(2);
    expect(echoes.slice(ran)).toEqual(["a", "b"]);
    expect((await readCall(kernel, session.id, "p1")).nested).toEqual({
      0: { kind: "ok", content: [{ kind: "text", text: "a" }], output: null, parts: [] },
      second: { kind: "ok", content: [{ kind: "text", text: "b" }], output: null, parts: [] },
    });
    expect((await readCall(kernel, session.id, "p1:second")).intent).toMatchObject({
      name: "echo",
      args: { text: "b" },
    });
    expect((await toolPart(session, "p1:0")).status.kind).toBe("settled");
  });

  it("returns the sessions and parts a step acquired when it re-runs", async () => {
    const acquired: string[] = [];

    const spawn = {
      name: "spawn",
      description: "Create a child and a panel, then wait.",
      parameters: standard(Type.Object({ until: Type.Number() })),
      class: () => ({ kind: "delegate", child: null, role: "create", title: null }),
      replay: "safe",
      execute: async (args, invocation) => {
        const child = await invocation.sdk.sessions.create({ parent: invocation.session.id });

        const panel = await invocation.session.parts.create(text, {
          state: { markdown: "Working." },
          placement: { kind: "panel" },
        });

        acquired.push(`${child.id} ${panel.id}`);
        await invocation.wait({ kind: "timer", until: args.until });

        return { content: [{ kind: "text", text: child.id }] };
      },
    } satisfies ToolDefinition<{ until: number }>;

    const { kernel, host } = await setup({ tools: source([spawn]) });
    const session = await host.sessions.create();
    const run = await liveRun(kernel, session.id);
    const at = Date.now() + 60_000;
    const input = { session: session.id, run, call: "k1", name: "spawn", args: { until: at } };

    expect(await call(kernel, input)).toEqual({ kind: "parked" });
    await kernel.waits.tick(at);
    expect(await call(kernel, input)).toMatchObject({ kind: "ok" });

    const [first, second] = acquired;
    const [child, panel] = (first ?? "").split(" ");

    expect(second).toBe(first);
    expect((await readCall(kernel, session.id, "k1")).acquisitions).toEqual({
      "acq:0": child,
      "acq:1": panel,
    });

    const children = await host.sessions.list({
      parents: { kind: "children", session: session.id },
    });

    expect(children.items.map((info) => info.id)).toEqual([child]);
    expect((await session.view()).parts.map((view) => view.id)).toEqual([panel]);
  });

  it("parks a call through advance, reports its deadline, and resumes the run once it wakes", async () => {
    const parker = {
      name: "parker",
      description: "Wait for a timer.",
      parameters: standard(Type.Object({ until: Type.Number() })),
      class: () => ({ kind: "custom", label: "Waiting" }),
      replay: "safe",
      execute: async (args, invocation) => ({
        content: [
          {
            kind: "text",
            text: (await invocation.wait({ kind: "timer", until: args.until })).kind,
          },
        ],
      }),
    } satisfies ToolDefinition<{ until: number }>;

    const { kernel, host, script } = await setup({ tools: source([parker]) });
    const session = await host.sessions.create();
    const head = { session: session.id, head: main };
    const at = Date.now() + 60_000;
    const receipt = await session.send("Wait for it.");
    const step = host.execution.advance(head);
    const turn = await script.started(1);
    const run = turn.input.run.id;

    expect(
      await call(kernel, {
        session: session.id,
        run,
        call: "w1",
        name: "parker",
        args: { until: at },
      }),
    ).toEqual({ kind: "parked" });
    turn.finish();
    await step;

    expect((await session.view()).execution).toMatchObject({ kind: "waiting", run: { id: run } });
    expect(await host.execution.advance(head)).toEqual({ kind: "waiting", until: at });
    expect(await host.execution.repair({ limit: 10 })).toEqual({ runnable: [], next: null });
    expect(await kernel.waits.tick(at)).toBe(true);
    expect(await host.execution.repair({ limit: 10 })).toEqual({ runnable: [head], next: null });

    const resumed = host.execution.advance(head);
    const next = await script.started(2);

    expect(next.input.run.id).toBe(run);
    expect((await toolPart(session, "w1")).state).toMatchObject({
      phase: "settled",
      outcome: { kind: "ok", content: [{ kind: "text", text: "timer" }] },
    });
    next.finish();

    expect(await resumed).toEqual({ kind: "idle" });
    expect(await receipt.settled()).toMatchObject({ kind: "completed" });
  });

  it("wakes a parked call with stopped when its run stops, and ends the run stopped", async () => {
    const seen: string[] = [];

    const parker = {
      name: "parker",
      description: "Wait for a timer.",
      parameters: standard(Type.Object({})),
      class: () => ({ kind: "custom", label: "Waiting" }),
      replay: "safe",
      execute: async (_args, invocation) => {
        const woke = await invocation.wait({ kind: "timer", until: Date.now() + 60_000 });
        seen.push(woke.kind);

        return { content: [{ kind: "text", text: woke.kind }] };
      },
    } satisfies ToolDefinition<object>;

    const { kernel, host, script } = await setup({ tools: source([parker]) });
    const session = await host.sessions.create();
    const head = { session: session.id, head: main };
    await session.send("Wait.");
    const step = host.execution.advance(head);
    const turn = await script.started(1);
    const run = turn.input.run.id;

    expect(
      await call(kernel, { session: session.id, run, call: "w1", name: "parker", args: {} }),
    ).toEqual({ kind: "parked" });
    turn.finish();
    await step;

    expect(await session.run(run).stop()).toEqual({ kind: "requested" });
    expect(await host.execution.advance(head)).toEqual({ kind: "idle" });
    expect(seen).toEqual(["stopped"]);
    expect(await session.run(run).settled()).toEqual({ kind: "stopped" });
    expect((await readCall(kernel, session.id, "w1")).result).toEqual({ kind: "stopped" });

    const part = await toolPart(session, "w1");

    expect(part.status).toMatchObject({ kind: "failed", run });
    expect(part.state).toMatchObject({ phase: "settled", outcome: { kind: "stopped" } });
    expect(
      (await kernel.store.refs.log(session.id, asSeq(0), 100)).filter(
        (event) => event.kind === "commit" && event.body.kind === "part",
      ),
    ).toEqual([]);
  });

  it("re-runs a safe call once and settles a never call interrupted after a crash", async () => {
    const store = await memoryStore().open();
    const executions = { safe: 0, never: 0 };
    const hang = new Promise<never>(() => undefined);

    const safe = {
      ...echo,
      name: "safe",
      execute: async () => {
        executions.safe += 1;

        return executions.safe === 1 ? hang : { content: [{ kind: "text", text: "again" }] };
      },
    } satisfies ToolDefinition<{ text: string }>;

    const never = {
      ...echo,
      name: "never",
      replay: "never",
      execute: async () => {
        executions.never += 1;

        return hang;
      },
    } satisfies ToolDefinition<{ text: string }>;

    const tools = source([safe, never]);
    const first = await setup({ store, tools });
    const session = await first.host.sessions.create();
    await session.send("Go.");
    void first.host.execution.advance({ session: session.id, head: main });
    const run = (await first.script.started(1)).input.run.id;

    for (const name of ["safe", "never"])
      void call(first.kernel, { session: session.id, run, call: name, name, args: { text: "x" } });

    await until(() => (executions.safe === 1 && executions.never === 1 ? true : undefined));

    const second = await setup({ store, tools });
    const step = second.host.execution.advance({ session: session.id, head: main });
    const resumed = await second.script.started(1);

    expect(resumed.input.run.id).toBe(run);
    expect(executions).toEqual({ safe: 2, never: 1 });
    expect((await readCall(second.kernel, session.id, "safe")).result).toMatchObject({
      kind: "ok",
      content: [{ kind: "text", text: "again" }],
    });
    expect((await readCall(second.kernel, session.id, "never")).result).toEqual({
      kind: "interrupted",
    });

    const resumedSession = second.host.session(session.id);

    expect((await toolPart(resumedSession, "never")).state).toMatchObject({
      phase: "settled",
      outcome: { kind: "interrupted" },
    });

    resumed.finish();
    await step;
  });

  it("settles stopped when the run's signal aborts or the part's stop action runs", async () => {
    const started: string[] = [];
    const slow = slowTool(started);
    const { kernel, host } = await setup({ tools: source([slow]) });
    const session = await host.sessions.create();
    const run = await liveRun(kernel, session.id);
    const controller = new AbortController();

    const aborted = call(kernel, {
      session: session.id,
      run,
      call: "s1",
      name: "slow",
      args: { text: "x" },
      signal: controller.signal,
    });

    await until(() => (started.includes("s1") ? true : undefined));
    controller.abort();

    expect(await aborted).toEqual({ kind: "stopped" });

    const stopped = call(kernel, {
      session: session.id,
      run,
      call: "s2",
      name: "slow",
      args: { text: "x" },
    });

    await until(() => (started.includes("s2") ? true : undefined));

    expect(await session.part(asId("s2")).act("stop", {})).toEqual({
      kind: "ok",
      output: undefined,
    });
    expect(await stopped).toEqual({ kind: "stopped" });
    expect((await toolPart(session, "s2")).state).toMatchObject({ outcome: { kind: "stopped" } });
  });

  it("keeps the stop-wired tool built-in whatever else registers its kind", async () => {
    const started: string[] = [];
    const { kernel, host } = await setup({ tools: source([slowTool(started)]) });
    const wired = kernel.partDefinitions.get(tool.kind);

    expect(wired?.owner).toBeNull();
    expect(wired?.definition).not.toBe(tool);
    expect(wired?.definition).toHaveProperty("onAction");

    for (const definition of [definePart({ ...tool }), tool])
      kernel.partDefinitions.register(definition, "parts")();

    expect(kernel.partDefinitions.get(tool.kind)).toBe(wired);

    const session = await host.sessions.create();
    const run = await liveRun(kernel, session.id);
    const running = call(kernel, {
      session: session.id,
      run,
      call: "t1",
      name: "slow",
      args: { text: "x" },
    });

    await until(() => (started.includes("t1") ? true : undefined));

    expect(await session.part(asId("t1")).act("stop", {})).toEqual({
      kind: "ok",
      output: undefined,
    });
    expect(await running).toEqual({ kind: "stopped" });
    expect((await readCall(kernel, session.id, "t1")).result).toEqual({ kind: "stopped" });
  });

  it("lands a write's snapshot changes on its part and the session's changes", async () => {
    const recorded = recording(await memoryStore().open());

    const edit = {
      ...echo,
      name: "edit",
      class: () => ({ kind: "edit", path: "a.ts" }),
    } satisfies ToolDefinition<{ text: string }>;

    const taken: string[] = [];

    const { kernel, host } = await setup({
      store: recorded.store,
      tools: source([edit]),
      snapshots: scripted(taken),
    });

    const session = await host.sessions.create();
    const run = await liveRun(kernel, session.id);

    await call(kernel, { session: session.id, run, call: "e1", name: "edit", args: { text: "x" } });

    expect(taken).toEqual(["before", "after"]);
    expect((await toolPart(session, "e1")).state).toMatchObject({
      changes: { added: 3, removed: 1, paths: ["a.ts"] },
    });
    expect((await session.view()).changes).toEqual([
      { path: "a.ts", status: "modified", added: 3, removed: 1 },
    ]);
    expect(recorded.sets.at(-1)).toEqual(["call:settled", "part:settled", "commit", "changes"]);

    const call2: CallId = asId("e2");

    await call(kernel, {
      session: session.id,
      run,
      call: call2,
      name: "edit",
      args: { text: "y" },
    });

    expect(taken).toEqual(["before", "after", "after"]);
    expect((await toolPart(session, "e2")).state).toMatchObject({
      changes: { added: 0, removed: 0, paths: [] },
    });
    expect((await session.view()).changes).toHaveLength(1);
    expect((await readRun(kernel, session.id, run)).record.snapshot).toBe(asId("s0"));

    const retaken: string[] = [];

    const restarted = await setup({
      store: recorded.store,
      tools: source([edit]),
      snapshots: scripted(retaken),
    });

    await call(restarted.kernel, {
      session: session.id,
      run,
      call: "e3",
      name: "edit",
      args: { text: "z" },
    });

    expect(retaken).toEqual(["after"]);
    expect((await toolPart(restarted.host.session(session.id), "e3")).state).toMatchObject({
      changes: { added: 3, removed: 1, paths: ["a.ts"] },
    });
  });

  it("stops a parked call through its part, and its re-run settles stopped", async () => {
    const seen: string[] = [];

    const parker = {
      name: "parker",
      description: "Wait for a timer.",
      parameters: standard(Type.Object({})),
      class: () => ({ kind: "custom", label: "Waiting" }),
      replay: "safe",
      execute: async (_args, invocation) => {
        const woke = await invocation.wait({ kind: "timer", until: Date.now() + 60_000 });
        seen.push(`${woke.kind} ${invocation.signal.aborted ? "aborted" : "live"}`);

        return { content: [{ kind: "text", text: woke.kind }] };
      },
    } satisfies ToolDefinition<object>;

    const { kernel, host } = await setup({ tools: source([parker]) });
    const session = await host.sessions.create();
    const run = await liveRun(kernel, session.id);
    const notified: string[] = [];
    kernel.wakes.subscribe((woken, head) => notified.push(`${woken}/${head}`));
    const input = { session: session.id, run, call: "w1", name: "parker", args: {} };

    expect(await call(kernel, input)).toEqual({ kind: "parked" });
    expect(await session.part(asId("w1")).act("stop", {})).toEqual({
      kind: "ok",
      output: undefined,
    });
    expect(await readCall(kernel, session.id, "w1")).toMatchObject({
      waiting: null,
      waits: [{ kind: "stopped" }],
      result: null,
    });
    expect(notified).toEqual([`${session.id}/${main}`]);
    expect(await call(kernel, input)).toEqual({ kind: "stopped" });
    expect(seen).toEqual(["stopped aborted"]);
    expect((await toolPart(session, "w1")).state).toMatchObject({
      phase: "settled",
      outcome: { kind: "stopped" },
    });
  });

  it("re-runs a stopping run's owed calls with its signal aborted after a restart", async () => {
    const store = await memoryStore().open();
    const signals: string[] = [];
    const hang = new Promise<never>(() => undefined);

    const flaky = {
      ...echo,
      name: "flaky",
      execute: async (_args, invocation) => {
        signals.push(invocation.signal.aborted ? "aborted" : "live");

        return signals.length === 1 ? hang : { content: [{ kind: "text", text: "done" }] };
      },
    } satisfies ToolDefinition<{ text: string }>;

    const tools = source([flaky]);
    const first = await setup({ store, tools });
    const session = await first.host.sessions.create();
    await session.send("Go.");
    void first.host.execution.advance({ session: session.id, head: main });
    const run = (await first.script.started(1)).input.run.id;
    void call(first.kernel, {
      session: session.id,
      run,
      call: "f1",
      name: "flaky",
      args: { text: "x" },
    });
    await until(() => (signals.length === 1 ? true : undefined));
    const fenced = await readRun(first.kernel, session.id, run);

    await store.refs.set([
      {
        name: fenced.ref.name,
        target: await store.objects.put(envelope("run", { ...fenced.record, stopping: true }, 0)),
        expect: fenced.ref.revision,
      },
    ]);

    const second = await setup({ store, tools });

    expect(await second.host.execution.advance({ session: session.id, head: main })).toEqual({
      kind: "idle",
    });
    expect(signals).toEqual(["live", "aborted"]);
    expect((await readCall(second.kernel, session.id, "f1")).result).toEqual({ kind: "stopped" });
    expect(await second.host.session(session.id).run(run).settled()).toEqual({ kind: "stopped" });
  });
});
