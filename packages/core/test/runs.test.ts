import { asId, asSeq } from "@nyte-ai/schema";
import type { PatchEvent, WaitTarget } from "@nyte-ai/schema";
import { assert, describe, expect, it } from "vitest";
import {
  LOCAL,
  decodePartRecord,
  decodeRunRecord,
  driveInProcess,
  envelope,
  partRef,
  publishPatch,
  runRef,
  startRun,
} from "../src/index.ts";
import { configuration, label, livePart, main, setup } from "./harness.ts";

describe("runs", () => {
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
    const stopping = fenced.indexOf("run:stopping");

    expect(fenced.slice(stopping, stopping + 3)).toEqual([
      "run:stopping",
      "part:failed",
      "part:failed",
    ]);
    expect(await session.run(run).settled()).toEqual({ kind: "stopped" });
    await step;

    const log = (await kernel.store.refs.log(session.id, asSeq(0), 100)).map(label);

    expect(log.indexOf("run:stopping")).toBe(stopping);
    expect(log.indexOf("run:ended")).toBeGreaterThan(stopping + 2);

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
      content: `Child ${child.id} completed:\n\nFound it.`,
      source: { kind: "child", session: child.id },
      delivery: "attach",
      status: { kind: "pending", schedule: { kind: "attached" } },
    });
  });

  it("wakes the parked wait instead of attaching a report", async () => {
    const woken: WaitTarget[] = [];

    const { host, script: turns } = await setup({
      wake: async (target) => {
        woken.push(target);

        return true;
      },
    });

    const parent = await host.sessions.create();
    const child = await host.sessions.create({ parent: parent.id });
    await child.send("Investigate.");
    const step = host.execution.advance({ session: child.id, head: main });
    const turn = await turns.started(1);
    turn.finish();
    await step;

    expect(woken).toEqual([{ kind: "run", session: child.id, run: turn.input.run.id }]);
    expect((await parent.view()).messages).toEqual([]);
  });
});
