import { asId, asSeq } from "@nyte-ai/schema";
import type { CallId, Json, PatchEvent, WaitTarget } from "@nyte-ai/schema";
import { assert, describe, expect, it } from "vitest";
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
  memoryStore,
  partRef,
  receiptRef,
  runRef,
} from "../src/store.ts";
import type { Kernel } from "../src/contract/kernel.ts";
import type { StoreConnection } from "../src/index.ts";
import { completed, configuration, label, livePart, main, setup, startRun } from "./harness.ts";

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
    const session = await host.sessions.create();
    const receipt = await session.send("Go.");
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
    const session = await host.sessions.create();
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

  it("shows a live text part emptied before a watch opened, so its next append is not added to stale text (ADV F-2 F4, probe P7)", async () => {
    const { kernel, host, script: turns } = await setup();
    const session = await host.sessions.create();
    await session.send("Write it.");
    const step = host.execution.advance({ session: session.id, head: main });
    const turn = await turns.started(1);
    const run = turn.input.run.id;
    const part = asId<"part">(`${run}:1:0`);
    await livePart(kernel, session.id, run, part, "A");
    publishPatch(kernel, session.id, run, { kind: "patch", part, markdown: "" });
    const views = session.watch()[Symbol.asyncIterator]();

    const shown = async (): Promise<string | null> => {
      const next = await views.next();
      assert(next.done !== true);
      const message = next.value.messages.find(
        (candidate) => isPart(candidate, text) && candidate.part === part,
      );

      return message !== undefined && isPart(message, text) ? message.state.markdown : null;
    };

    expect(await shown()).toBe("");
    publishPatch(kernel, session.id, run, { kind: "patch", part, append: "B" });
    expect(await shown()).toBe("B");
    await views.return?.();
    turn.finish(completed);
    await step;
  });

  it("ends a waiting run stopped once session.stop() fences it and wakes the driver", async () => {
    const { kernel, host } = await setup();
    const session = await host.sessions.create();

    const run = await startRun(
      kernel,
      session.id,
      main,
      { kind: "continuation", from: "wake" },
      configuration,
    );

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
    const { kernel, host } = await setup();
    const session = await host.sessions.create();

    const run = await startRun(
      kernel,
      session.id,
      main,
      { kind: "input", message: asId("m1") },
      configuration,
    );

    kernel.runs.end(run.id);
    const driver = driveInProcess(kernel, { kind: "all" });

    expect(await session.run(run.id).stop()).toEqual({ kind: "requested" });
    expect(await session.run(run.id).settled()).toEqual({ kind: "stopped" });

    await driver.close();
  });

  it("stops every live run of a session and withdraws everything queued", async () => {
    const { host, script: turns } = await setup();
    const session = await host.sessions.create();
    await session.send("Go.");
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

  it("attaches a child's report to the parent head when no wait is parked on the run", async () => {
    const { kernel, host, script: turns } = await setup();
    const parent = await host.sessions.create({ name: "parent" });
    const child = await host.sessions.create({ parent: parent.id });
    await child.send("Investigate.");
    const step = host.execution.advance({ session: child.id, head: main });
    const turn = await turns.started(1);
    const run = turn.input.run.id;
    await livePart(kernel, child.id, run, asId(`${run}:1:0`), "Found it.");
    turn.finish();
    await step;

    const view = await parent.view();

    expect(view.messages).toHaveLength(1);
    expect(view.messages[0]).toMatchObject({
      kind: "user",
      content: "Found it.",
      source: { kind: "child", session: child.id, end: "completed" },
      delivery: "attach",
      status: { kind: "pending", schedule: { kind: "attached" } },
    });
  });

  it("attaches no report when a wait parked here took the child's end", async () => {
    const { kernel, host } = await setup({ execution: { kind: "admit-only" } });
    const parent = await host.sessions.create();
    const child = await host.sessions.create({ parent: parent.id });
    const run = await startRun(
      kernel,
      child.id,
      main,
      { kind: "continuation", from: "wake" },
      configuration,
    );

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

    expect((await parent.view()).messages).toEqual([]);
  });

  it("attaches no report when a durable wait parked on another instance holds the child's run, which a later cover wakes once", async () => {
    const store = await memoryStore().open();
    const x = await setup({ store, execution: { kind: "admit-only" } });
    const parent = await x.host.sessions.create();
    const child = await x.host.sessions.create({ parent: parent.id });

    const run = await startRun(
      x.kernel,
      child.id,
      main,
      { kind: "continuation", from: "wake" },
      configuration,
    );

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

    expect((await y.host.session(parent.id).view()).messages).toEqual([]);

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
    expect((await z.host.session(parent.id).view()).messages).toEqual([]);
    await owned.close();
  });
});
