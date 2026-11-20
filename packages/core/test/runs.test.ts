import { asId, asSeq, standard } from "@nyte-ai/schema";
import type {
  CallId,
  Json,
  PatchEvent,
  RefUpdate,
  RunId,
  SessionId,
  WaitTarget,
} from "@nyte-ai/schema";
import { Type } from "typebox";
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import { driveInProcess } from "../src/drive/execution.ts";
import { runStep } from "../src/engine/durable.ts";
import { endRun, publishPatch } from "../src/engine/runs.ts";
import { LOCAL, isPart, text } from "../src/index.ts";
import {
  callRef,
  decodeCallRecord,
  decodePartRecord,
  decodeReceiptRecord,
  decodeRunRecord,
  envelope,
  inboxRef,
  memoryStore,
  partRef,
  receiptRef,
  runRef,
} from "../src/store.ts";
import type { Kernel } from "../src/contract/kernel.ts";
import type { Plugin, StoreConnection, ToolDefinition } from "../src/index.ts";
import {
  completed,
  killable,
  label,
  livePart,
  main,
  settledChat,
  setup,
  startRun,
  until,
} from "../src/harness.ts";
import { fakeModels, open } from "./fake-models.ts";
import type { Reply } from "./fake-models.ts";
import { toolPlugin } from "./tool-support.ts";

function awaitRun(kernel: Kernel, session: SessionId, call: CallId, target: WaitTarget) {
  return runStep<Json>(kernel, {
    session,
    head: main,
    run: null,
    call,
    kind: "hook",
    replay: "safe",
    intent: { test: true },
    part: null,
    signal: new AbortController().signal,
    body: async (durable) => (await durable.wait(target)).kind,
    settle: async (ended) => ({
      result: ended.kind === "done" ? ended.value : null,
      updates: [],
    }),
    decode: (result) => result,
  });
}

async function runCall(kernel: Kernel, session: SessionId, call: CallId) {
  const ref = await kernel.store.refs.get(callRef(session, call));

  return decodeCallRecord(ref?.target ? await kernel.store.objects.get(ref.target) : null);
}

afterEach(() => {
  vi.useRealTimers();
});

const refuseReports: Plugin<"core"> = {
  id: "refuse-reports",
  hooks: {
    before_send: (submission) =>
      submission.source.kind === "child"
        ? { action: "reject", reason: "No reports." }
        : { action: "continue" },
  },
};

const ended = (updates: readonly RefUpdate[]): boolean =>
  updates.some((update) =>
    (update.events ?? []).some((event) => event.kind === "run" && event.change === "ended"),
  );

describe("runs", () => {
  it("settles the receipts of a run's landed inputs in its end set, so a crash right after it leaves none pending", async () => {
    const store = await memoryStore().open();
    let crashed = false;

    const crashing: StoreConnection = {
      ...store,
      refs: {
        ...store.refs,
        async set(updates) {
          if (crashed) throw new Error("Crashed.");
          const outcome = await store.refs.set(updates);

          crashed = updates
            .flatMap((update) => update.events ?? [])
            .some((event) => event.kind === "run" && event.change === "ended");

          return outcome;
        },
      },
    };

    const { host, script: turns } = await setup({ store: crashing });
    const { session, receipt } = await host.sessions.start({ content: "Go." });
    const step = host.execution.advance({ session: session.id, head: main });
    (await turns.started(1)).finish();
    await step.catch(() => undefined);

    expect(crashed).toBe(true);
    const ref = await store.refs.get(receiptRef(session.id, receipt.id));
    const record = decodeReceiptRecord(await store.objects.get(ref?.target ?? asId("none")));

    expect(record?.outcome).toEqual(completed);
  });

  it("logs the stop fence before the run ends, then aborts: parts fail and patches drop", async () => {
    const { kernel, host, script: turns } = await setup();
    const { session } = await host.sessions.start({ content: "Hi." });
    const hold = kernel.folds.acquire(session.id, LOCAL);
    await hold.ready();
    const receipt = await session.send("Write it.");
    const step = host.execution.advance({ session: session.id, head: main });
    const turn = await turns.started(1);
    const run = turn.input.run.id;
    const parts = [asId<"part">(`${run}:1:0`), asId<"part">(`${run}:1:1`)];

    for (const part of parts) await livePart(kernel, session.id, run, part, "Draft");

    const patches: PatchEvent[] = [];
    const abortedAtFence: boolean[] = [];

    kernel.bus.subscribe(session.id, (event) => {
      if (event.kind === "patch") patches.push(event);

      if (event.kind === "run" && event.change === "stopping") {
        abortedAtFence.push(turn.input.signal.aborted);
        publishPatch(kernel, session.id, run, {
          kind: "patch",
          part: parts[0],
          append: " dropped",
        });
      }
    });

    publishPatch(kernel, session.id, run, { kind: "patch", part: parts[0], append: " more" });

    expect(await session.run(run).stop()).toEqual({ kind: "requested" });
    expect(abortedAtFence).toEqual([false]);
    expect(turn.input.signal.aborted).toBe(true);
    expect(patches).toHaveLength(1);

    const fenced = (await kernel.store.refs.log(session.id, asSeq(0), 100)).map(label);
    const stopping = fenced.findIndex((entry) => entry === "run:stopping");

    expect(fenced.slice(stopping, stopping + 3)).toEqual([
      "run:stopping",
      "part:failed",
      "part:failed",
    ]);
    expect(await session.run(run).settled()).toEqual({ kind: "stopped" });
    await step;

    const log = (await kernel.store.refs.log(session.id, asSeq(0), 100)).map(label);

    expect(log.findIndex((entry) => entry === "run:stopping")).toBe(stopping);
    expect(log.findIndex((entry) => entry === "run:ended")).toBeGreaterThan(stopping + 2);

    for (const part of parts) {
      const ref = await kernel.store.refs.get(partRef(session.id, part));

      expect(
        decodePartRecord(ref?.target ? await kernel.store.objects.get(ref.target) : null)?.status,
      ).toMatchObject({ kind: "failed", run, failure: { class: "aborted" } });
    }

    expect(
      (await session.view()).messages.find(
        (message) => message.kind === "part" && message.part === parts[0],
      ),
    ).toMatchObject({ state: { markdown: "Draft more" }, status: { kind: "failed", run } });
    expect(await receipt.settled()).toEqual({ kind: "stopped" });
    expect(await session.run(run).stop()).toEqual({
      kind: "settled",
      outcome: { kind: "stopped" },
    });
    expect(await session.run(asId("unknown")).stop()).toEqual({ kind: "missing" });
    hold.release();
  });

  it("shows a live text part emptied before a view was read, so its next append is not added to stale text (ADV F-2 F4, probe P7)", async () => {
    const { kernel, host, script: turns } = await setup();
    const { session } = await host.sessions.start({ content: "Write it." });
    const step = host.execution.advance({ session: session.id, head: main });
    const turn = await turns.started(1);
    const run = turn.input.run.id;
    const part = asId<"part">(`${run}:1:0`);
    await livePart(kernel, session.id, run, part, "A");
    publishPatch(kernel, session.id, run, { kind: "patch", part, markdown: "" });

    const shown = async (): Promise<string | null> => {
      const message = (await session.view()).messages.find(
        (candidate) => isPart(candidate, text) && candidate.part === part,
      );

      return message !== undefined && isPart(message, text) ? message.state.markdown : null;
    };

    expect(await shown()).toBe("");
    publishPatch(kernel, session.id, run, { kind: "patch", part, append: "B" });
    expect(await shown()).toBe("B");
    turn.finish(completed);
    await step;
  });

  it("ends a waiting run stopped once session.stop() fences it and wakes the driver", async () => {
    const { kernel, host, script: turns } = await setup();
    const session = await settledChat(host, turns);

    const run = await startRun(kernel, session.id, main, { kind: "continuation", from: "wake" });

    kernel.runs.end(run.id);
    const ref = await kernel.store.refs.get(runRef(session.id, run.id));
    const record = decodeRunRecord(ref?.target ? await kernel.store.objects.get(ref.target) : null);
    assert(ref !== null && record !== null);

    await kernel.store.refs.set([
      {
        name: ref.name,
        target: await kernel.store.objects.put(
          envelope("run", { ...record, waiting: { kind: "timer", until: Date.now() + 60_000 } }, 0),
        ),
        expect: ref.revision,
      },
    ]);

    expect(await host.execution.advance({ session: session.id, head: main })).toMatchObject({
      kind: "waiting",
    });

    const driver = driveInProcess(kernel, { kind: "all" });

    expect(await session.stop()).toEqual({ stopped: [run.id], withdrawn: [] });
    expect(await session.run(run.id).settled()).toEqual({ kind: "stopped" });
    expect((await session.view()).execution).toMatchObject({
      kind: "idle",
      lastRun: { id: run.id, end: { kind: "stopped" } },
    });

    await driver.close();
  });

  it("ends a stopped run no turn drives here once the driver takes the head", async () => {
    const { kernel, host, script: turns } = await setup();
    const session = await settledChat(host, turns);

    const run = await startRun(kernel, session.id, main, { kind: "input", message: asId("m1") });

    kernel.runs.end(run.id);
    const driver = driveInProcess(kernel, { kind: "all" });

    expect(await session.run(run.id).stop()).toEqual({ kind: "requested" });
    expect(await session.run(run.id).settled()).toEqual({ kind: "stopped" });

    await driver.close();
  });

  it("stops every live run of a session and withdraws everything queued", async () => {
    const { host, script: turns } = await setup();
    const { session } = await host.sessions.start({ content: "Go." });
    const step = host.execution.advance({ session: session.id, head: main });
    const turn = await turns.started(1);
    const later = await session.send("Later.", { delivery: "queue" });

    expect(await session.stop()).toEqual({
      stopped: [turn.input.run.id],
      withdrawn: [later.message],
    });

    await step;

    expect(await later.settled()).toEqual({ kind: "withdrawn" });
    expect((await session.view()).execution).toMatchObject({
      kind: "idle",
      lastRun: { id: turn.input.run.id, end: { kind: "stopped" } },
    });
  });

  it.each([
    {
      name: "a tool that ignores its abort signal",
      reply: { content: [{ type: "toolCall", id: "t1", name: "stubborn", arguments: {} }] },
      call: "stubborn",
      id: "t1",
    },
    {
      name: "a model stream whose provider does not cancel",
      reply: { content: [{ type: "text", text: "Halfway there" }], stall: true },
      call: null,
      id: null,
    },
    {
      name: "a parked tool that ignores its abort once the stop wakes it",
      reply: { content: [{ type: "toolCall", id: "p1", name: "parker", arguments: {} }] },
      call: "parker",
      id: "p1",
    },
  ] satisfies readonly {
    name: string;
    reply: Reply;
    call: string | null;
    id: string | null;
  }[])(
    "ends a stopped run 3 s after the stop and starts the queued message, though $name still runs",
    async (row) => {
      const release = Promise.withResolvers<void>();
      let ran = false;

      const stuck = (name: string, park: boolean): ToolDefinition<object> => ({
        name,
        description: "Ignores its abort signal.",
        parameters: standard(Type.Object({})),
        class: () => ({ kind: "custom", label: name }),
        rerun: "safe",
        async execute(_args, invocation) {
          if (park) await invocation.wait({ kind: "timer", until: Date.now() + 3_600_000 });
          ran = true;
          await release.promise;

          return { content: [{ kind: "text", text: "Late." }] };
        },
      });

      const fake = fakeModels();
      fake.reply(row.reply, { content: [{ type: "text", text: "Next." }] });

      await using host = await open(fake, {
        plugins: [toolPlugin([stuck("stubborn", false), stuck("parker", true)])],
      });

      const { session } = await host.sessions.start({ content: "Go." });

      const run = await until(async () => {
        const execution = (await session.view()).execution;

        return execution.kind === "idle" ||
          (execution.kind === "live" && row.call === "parker") ||
          (row.call === "stubborn" && !ran) ||
          (row.call === null && fake.requests.length === 0)
          ? undefined
          : execution.run.id;
      });

      const queued = await session.send("Queued.", { delivery: "queue" });

      const landed = async (): Promise<boolean> =>
        (await session.view()).messages.some(
          (message) =>
            message.id === queued.message &&
            message.kind === "user" &&
            message.status.kind === "landed",
        );

      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      expect(await session.run(run).stop()).toEqual({ kind: "requested" });
      let waited = 0;
      let stopping = (await session.view()).execution;

      while (waited < 4_000 && !(await landed())) {
        await vi.advanceTimersByTimeAsync(10);

        for (let turn = 0; turn < 5; turn += 1) await new Promise((done) => setImmediate(done));
        waited += 10;

        if (waited === 2_900) stopping = (await session.view()).execution;
      }

      expect(stopping).toMatchObject({ run: { id: run }, stopping: true });
      expect({ ran: ran === (row.call !== null), waited: waited <= 3_200 }).toEqual({
        ran: true,
        waited: true,
      });
      vi.useRealTimers();
      expect(await session.run(run).settled()).toEqual({ kind: "stopped" });
      expect(await queued.settled()).toMatchObject({ kind: "completed" });

      const calls = (await host.kernel.store.refs.list(`sessions/${session.id}/calls/`)).length;

      if (row.id !== null)
        expect(
          (await runCall(host.kernel, session.id, asId(`${run}:1:${row.id}`)))?.result,
        ).toEqual({ kind: "stopped" });

      const tail = await host.kernel.store.refs.tail(session.id);
      const requests = fake.requests.length;
      release.resolve();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect({
        tail: await host.kernel.store.refs.tail(session.id),
        requests: fake.requests.length,
        calls: (await host.kernel.store.refs.list(`sessions/${session.id}/calls/`)).length,
      }).toEqual({ tail, requests, calls });
    },
  );

  it("attaches a child's report to the parent head when no wait is parked on the run", async () => {
    const { kernel, host, script: turns } = await setup();
    const { session: parent } = await host.sessions.start({ name: "parent", content: "Hi." });
    const { session: child } = await host.sessions.start({
      parent: parent.id,
      content: "Investigate.",
    });
    const step = host.execution.advance({ session: child.id, head: main });
    const turn = await turns.started(1);
    const run = turn.input.run.id;
    await livePart(kernel, child.id, run, asId(`${run}:1:0`), "Found it.");
    turn.finish();
    await step;

    const view = await parent.view();

    expect(view.messages).toHaveLength(2);
    expect(view.messages[1]).toMatchObject({
      kind: "user",
      content: "Found it.",
      source: { kind: "child", session: child.id, end: "completed" },
      delivery: "attach",
      status: { kind: "pending", schedule: { kind: "attached" } },
    });
  });

  it.each([
    {
      name: "a create child's host killed between its run's end and the report",
      awaited: false,
      kill: () => ended,
      expected: { reports: 1, receipt: "send" },
    },
    {
      name: "a create child's host killed after the report was admitted, before its receipt settled",
      awaited: false,
      kill: (parent: SessionId) => (updates: readonly RefUpdate[]) =>
        updates.some((update) => update.name === inboxRef(parent, main)),
      expected: { reports: 1, receipt: "send" },
    },
    {
      name: "a task child's host killed between its run's end and the wait taking it",
      awaited: true,
      kill: () => ended,
      expected: { reports: 0, receipt: null },
    },
    {
      name: "a task child's host killed after the wait took its end",
      awaited: true,
      kill: (parent: SessionId) => (updates: readonly RefUpdate[]) =>
        updates.some((update) => update.name === callRef(parent, asId("task-call"))),
      expected: { reports: 0, receipt: null },
    },
    {
      name: "a task child's host that lives",
      awaited: true,
      kill: () => () => false,
      expected: { reports: 0, receipt: null },
    },
    {
      name: "a create child whose report before_send refuses",
      awaited: false,
      kill: () => () => false,
      refused: true,
      expected: { reports: 0, receipt: "undelivered" },
    },
  ])(
    "reports a child's end to its parent once, unless a wait took it, after $name",
    async (row) => {
      const store = await memoryStore().open();
      const killed = killable(store);

      const plugins = row.refused ? [refuseReports] : [];

      const a = await setup({ store: killed.store, execution: { kind: "admit-only" }, plugins });
      const parent = await settledChat(a.host, a.script);
      const { session: child } = await a.host.sessions.start({ parent: parent.id, content: "Go." });
      const step = a.host.execution.advance({ session: child.id, head: main });
      const turn = await a.script.started(2);
      const run: RunId = turn.input.run.id;
      await livePart(a.kernel, child.id, run, asId(`${run}:1:0`), "Found it.");

      if (row.awaited)
        expect(
          await awaitRun(a.kernel, parent.id, asId("task-call"), {
            kind: "run",
            session: child.id,
            run,
          }),
        ).toEqual({ kind: "parked" });

      killed.kill(row.kill(parent.id));
      turn.finish();
      await step.catch(() => undefined);

      const b = await setup({ store, execution: { kind: "admit-only" }, plugins });
      await b.host.execution.repair({ limit: 100 });
      await b.host.execution.repair({ limit: 100 });
      const ref = await store.refs.get(receiptRef(parent.id, asId(`${run}:report`)));
      const receipt = decodeReceiptRecord(ref?.target ? await store.objects.get(ref.target) : null);

      const reports = (await b.host.session(parent.id).view()).messages.filter(
        (message) => message.kind === "user" && message.source.kind === "child",
      );

      expect({
        reports: reports.length,
        receipt:
          receipt === null
            ? null
            : receipt.kind === "report"
              ? (receipt.outcome?.kind ?? "reserved")
              : receipt.kind,
      }).toEqual(row.expected);

      for (const report of reports)
        expect(report).toMatchObject({ content: "Found it.", delivery: "attach" });
    },
  );

  it("attaches no report when a wait parked here took the child's end", async () => {
    const { kernel, host } = await setup({ execution: { kind: "admit-only" } });
    const { session: parent } = await host.sessions.start({ content: "Hi." });
    const { session: child } = await host.sessions.start({ parent: parent.id, content: "Hi." });
    const run = await startRun(kernel, child.id, main, { kind: "continuation", from: "wake" });

    const waited = runStep<Json>(kernel, {
      session: parent.id,
      head: main,
      run: null,
      call: asId("wait-here"),
      kind: "hook",
      replay: "safe",
      intent: { test: true },
      part: null,
      signal: new AbortController().signal,
      body: async (durable) =>
        (await durable.wait({ kind: "run", session: child.id, run: run.id })).kind,
      settle: async (ended) => ({
        result: ended.kind === "done" ? ended.value : null,
        updates: [],
      }),
      decode: (result) => result,
    });

    expect(await waited).toEqual({ kind: "parked" });
    await endRun(kernel, child.id, run.id, completed);

    expect((await parent.view()).messages.map((message) => message.id)).toEqual([parent.id]);
  });

  it("attaches no report when a durable wait parked on another instance holds the child's run, which a later cover wakes once", async () => {
    const store = await memoryStore().open();
    const x = await setup({ store, execution: { kind: "admit-only" } });
    const { session: parent } = await x.host.sessions.start({ content: "Hi." });
    const { session: child } = await x.host.sessions.start({ parent: parent.id, content: "Hi." });

    const run = await startRun(x.kernel, child.id, main, { kind: "continuation", from: "wake" });

    const call: CallId = asId("wait-child");
    const target: WaitTarget = { kind: "run", session: child.id, run: run.id };

    const waited = (kernel: Kernel) =>
      runStep<Json>(kernel, {
        session: parent.id,
        head: main,
        run: null,
        call,
        kind: "hook",
        replay: "safe",
        intent: { test: true },
        part: null,
        signal: new AbortController().signal,
        body: async (durable) => (await durable.wait(target)).kind,
        settle: async (ended) => ({
          result: ended.kind === "done" ? ended.value : null,
          updates: [],
        }),
        decode: (result) => result,
      });

    expect(await waited(x.kernel)).toEqual({ kind: "parked" });

    expect(
      (await store.refs.list(`waits/run/${child.id}/${run.id}/`)).map((ref) => ref.name),
    ).toEqual([`waits/run/${child.id}/${run.id}/${parent.id}/${call}/0/0`]);

    const y = await setup({ store, execution: { kind: "admit-only" } });
    await endRun(y.kernel, child.id, run.id, completed);

    expect((await y.host.session(parent.id).view()).messages.map((message) => message.id)).toEqual([
      parent.id,
    ]);

    const z = await setup({ store, execution: { kind: "admit-only" } });
    const owned = await z.host.execution.cover({ kind: "sessions", sessions: [parent.id] });
    const recorded = await store.refs.get(callRef(parent.id, call));

    expect(
      decodeCallRecord(recorded?.target ? await store.objects.get(recorded.target) : null),
    ).toMatchObject({
      waiting: null,
      waits: [{ kind: "run", session: child.id, run: run.id, end: completed }],
    });
    expect(await waited(z.kernel)).toEqual({ kind: "done", value: "run" });
    expect((await z.host.session(parent.id).view()).messages.map((message) => message.id)).toEqual([
      parent.id,
    ]);
    await owned.close();
  });
});
