import assert from "node:assert/strict";
import type { JobInfo, JobReport } from "@nyte-ai/protocol";
import { Type } from "typebox";
import { afterEach, expect, test, vi } from "vitest";
import { openEffect, parkEffect, readEffect } from "../src/kernel/effects.ts";
import { toJsonValue } from "@nyte-ai/client";
import type { Run } from "../src/kernel/model.ts";
import { runRef } from "../src/kernel/names.ts";
import { pending, submit } from "../src/kernel/queue.ts";
import { createJobs, JOB_PREFIX, parseJobRecord } from "../src/kernel/sdk/jobs.ts";
import { ToolWait, type AgentTool, type AgentToolResult } from "../src/kernel/loop/types.ts";
import { granted, lease, only, openStore, storePath, within } from "./kernel/helpers.ts";

afterEach(() => vi.restoreAllMocks());

const result: AgentToolResult<unknown> = {
  content: [{ type: "text", text: "finished output" }],
  details: {},
};

async function fixture() {
  const path = storePath();
  const session = await openStore(path).create();
  const peer = await openStore(path).open(session.id);
  const run: Run = {
    kind: "run",
    id: "run",
    head: "main",
    origin: { kind: "user" },
    root: "run",
    phase: { kind: "tools" },
    startedAt: Date.now(),
    attempts: 0,
    config: {},
  };
  const oid = only(await session.objects.put([run]));
  await session.refs.update([{ name: runRef(run.head), from: null, to: oid }], { reason: "test" });
  const notifications: JobReport[] = [];
  const diagnostics: unknown[] = [];
  const managers: ReturnType<typeof createJobs>[] = [];
  const notify = async (job: JobReport, head: string) => {
    const outcome = await submit(session, {
      preparation: { kind: "none" },
      head,
      delivery: "steer",
      key: `background-${job.kind === "command" ? job.id : job.request.oid}`,
      kind: "report",
      body: { kind: "completion", job },
    });
    if (outcome.kind === "queued") notifications.push(job);
    return outcome.change;
  };
  const manager = (
    connection = session,
    overrides: Partial<Parameters<typeof createJobs>[0]> = {},
  ) => {
    const jobs = createJobs({
      session: connection,
      notify,
      diagnostic: async (cause) => {
        diagnostics.push(cause);
      },
      ...overrides,
    });
    managers.push(jobs);
    return jobs;
  };
  const seed = async (phase: JobInfo["phase"] = { kind: "running", mode: "background" }) => {
    const info: JobInfo = {
      id: "orphan",
      origin: { kind: "run", runId: run.id, callId: "call" },
      head: run.head,
      command: "work",
      phase,
      startedAt: 1,
      updatedAt: 1,
      output: "partial output",
    };
    const oid = only(
      await session.objects.put([
        { kind: "blob", value: toJsonValue({ info, completion: { kind: "owed" } }) },
      ]),
    );
    await session.refs.update([{ name: JOB_PREFIX + info.id, from: null, to: oid }], {
      reason: "test",
    });
    return info;
  };
  const stored = async (id: string) => {
    const oid = await session.refs.read(JOB_PREFIX + id);
    assert.ok(oid);
    const object = await session.objects.get(oid);
    assert.equal(object?.kind, "blob");
    return parseJobRecord(object.value);
  };
  return {
    session,
    peer,
    run,
    context: { runId: run.id, head: run.head },
    manager,
    seed,
    stored,
    notifications,
    notify,
    diagnostics,
    close: async () => {
      await Promise.all(managers.map((jobs) => jobs.close()));
    },
  };
}

function controlledTool(name = "bash") {
  const started = Promise.withResolvers<AbortSignal>();
  const finished = Promise.withResolvers<AgentToolResult<unknown>>();
  let publish: Parameters<AgentTool["execute"]>[3];
  let executions = 0;
  const tool: AgentTool = {
    name,
    description: "Gated work",
    parameters: Type.Object({}),
    execute: (_id, _args, signal, onUpdate) => {
      assert.ok(signal);
      executions++;
      publish = onUpdate;
      started.resolve(signal);
      return finished.promise;
    },
  };
  return {
    tool,
    started,
    finished,
    publish: (value = result) => publish?.(value),
    executions: () => executions,
  };
}

test("remote job refs cancel the owner without replacing the notified terminal output", async () => {
  const f = await fixture();
  const owner = f.manager();
  const remote = f.manager(f.peer);
  const work = controlledTool();
  try {
    const wrapped = owner.wrap(work.tool);
    await expect(
      wrapped.execute("call", { command: "work" }, undefined, undefined, f.context),
    ).rejects.toBeInstanceOf(ToolWait);
    const signal = await within(work.started.promise);
    work.publish({ ...result, content: [{ type: "text", text: "partial output" }] });
    await expect.poll(async () => only(await owner.list()).output).toBe("partial output");
    const job = only(await owner.list());
    expect(await remote.background(job.id)).toEqual({ kind: "applied" });
    expect(await remote.cancel(job.id)).toEqual({ kind: "applied" });
    await expect.poll(() => signal.aborted).toBe(true);
    const cancelled = await f.stored(job.id);
    work.publish();
    work.finished.resolve(result);
    await owner.close();
    await remote.recover();
    expect((await f.stored(job.id)).info).toEqual(cancelled.info);
    expect(f.notifications).toEqual([
      {
        kind: "command",
        id: job.id,
        command: "work",
        end: { kind: "cancelled" },
        output: "partial output",
      },
    ]);
    expect(await pending(f.session, "main")).toHaveLength(1);
    await expect(
      remote.wrap(work.tool).execute("call", { command: "work" }, undefined, undefined, f.context),
    ).rejects.toThrow("Job already exists");
    expect(work.executions()).toBe(1);
  } finally {
    await f.close();
  }
});

test("cancellation drains only the in-flight and latest pending progress", async () => {
  const f = await fixture();
  const owner = f.manager();
  const work = controlledTool();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const append = f.session.events.append.bind(f.session.events);
  let progressWrites = 0;
  vi.spyOn(f.session.events, "append").mockImplementation(async (events, options) => {
    if (events.some((event) => event.kind === "progress")) {
      progressWrites += 1;
      if (progressWrites === 1) {
        entered.resolve();
        await release.promise;
      }
    }
    return append(events, options);
  });
  try {
    await expect(
      owner.wrap(work.tool).execute("call", { command: "work" }, undefined, undefined, f.context),
    ).rejects.toBeInstanceOf(ToolWait);
    await within(work.started.promise);
    work.publish({ ...result, content: [{ type: "text", text: "first" }] });
    await within(entered.promise);
    for (let index = 0; index < 100; index += 1) {
      work.publish({ ...result, content: [{ type: "text", text: `latest-${String(index)}` }] });
    }
    const job = only(await owner.list());
    const cancelling = owner.cancel(job.id);
    release.resolve();
    expect(await cancelling).toEqual({ kind: "applied" });
    expect(progressWrites).toBe(2);
    expect((await f.stored(job.id)).info).toMatchObject({
      output: "latest-99",
      phase: { kind: "cancelled" },
    });
  } finally {
    release.resolve();
    await f.close();
  }
});

test("recovery leaves a leased job alive, then interrupts the orphan and wakes its parked effect", async () => {
  const f = await fixture();
  const jobs = f.manager(f.peer);
  try {
    const info = await f.seed();
    assert.equal(info.origin.kind, "run");
    const headLease = await lease(f.session, "main");
    const effect = await openEffect(f.session, {
      lease: headLease,
      runId: info.origin.runId,
      callId: info.origin.callId,
      tool: "bash",
      args: {},
      replay: "never",
    });
    assert.ok(effect.kind === "opened");
    await parkEffect(f.session, { lease: headLease, view: effect.view });
    const held = granted(await f.session.leases.acquire(JOB_PREFIX + info.id, 15_000));
    await jobs.recover();
    expect(only(await jobs.list()).phase.kind).toBe("running");
    expect(f.notifications).toEqual([]);
    await f.session.leases.release(held);
    await Promise.all([jobs.recover(), jobs.recover()]);
    expect(only(await jobs.list()).phase.kind).toBe("interrupted");
    expect(
      (await readEffect(f.session, { runId: info.origin.runId, callId: info.origin.callId }))
        ?.effect.state,
    ).toBe("signal");
    expect(await f.session.leases.read(JOB_PREFIX + info.id)).toBeUndefined();
    expect(f.notifications).toHaveLength(1);
  } finally {
    await f.close();
  }
});

test("an expired recovery lease cannot cancel a successor's running job", async () => {
  const f = await fixture();
  const jobs = f.manager(f.peer);
  const entered = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  try {
    const info = await f.seed();
    const update = f.peer.refs.update.bind(f.peer.refs);
    vi.spyOn(f.peer.refs, "update").mockImplementation(async (updates, options) => {
      entered.resolve();
      await resume.promise;
      return update(updates, options);
    });
    const recovering = jobs.recover();
    await within(entered.promise);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 30_000);
    const successor = granted(await f.session.leases.acquire(JOB_PREFIX + info.id, 15_000));
    resume.resolve();
    await recovering;
    expect(only(await jobs.list()).phase.kind).toBe("running");
    expect(f.notifications).toEqual([]);
    expect(await f.session.leases.read(JOB_PREFIX + info.id)).toEqual(successor);
    expect(f.diagnostics).toHaveLength(1);
  } finally {
    resume.resolve();
    await f.close();
  }
});

test("close settles uncooperative work and ignores late rejection and updates", async () => {
  const f = await fixture();
  const jobs = f.manager();
  const work = controlledTool();
  const executing = jobs
    .wrap(work.tool)
    .execute("call", { command: "work", background: true }, undefined, undefined, f.context)
    .catch((cause: unknown) => cause);
  try {
    const signal = await within(work.started.promise);
    await within(jobs.close());
    expect(signal.aborted).toBe(true);
    expect(await executing).toBeInstanceOf(ToolWait);
    const job = only(await jobs.list());
    expect(job.phase.kind).toBe("interrupted");
    expect(await f.session.leases.read(JOB_PREFIX + job.id)).toBeUndefined();
    const seq = await f.session.events.last();
    work.publish();
    work.finished.reject(new Error("late tool failure"));
    await Promise.resolve();
    await Promise.resolve();
    expect(await f.session.events.last()).toBe(seq);
    expect(f.notifications).toEqual([]);
  } finally {
    await f.close();
  }
});

test("close waits for admission already in flight and never starts its side effect", async () => {
  const f = await fixture();
  const entered = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  const jobs = f.manager();
  const read = f.session.refs.read.bind(f.session.refs);
  vi.spyOn(f.session.refs, "read").mockImplementationOnce(async (name) => {
    entered.resolve();
    await resume.promise;
    return read(name);
  });
  const work = controlledTool();
  const executing = jobs
    .wrap(work.tool)
    .execute("call", { command: "work" }, undefined, undefined, f.context)
    .catch((cause: unknown) => cause);
  try {
    await within(entered.promise);
    const closing = jobs.close();
    resume.resolve();
    await within(closing);
    expect(await executing).toEqual(new Error("Host is closing"));
    expect(work.executions()).toBe(0);
    expect(await jobs.list()).toEqual([]);
  } finally {
    resume.resolve();
    await f.close();
  }
});

test("recovery retries a claimed completion without publishing it twice", async () => {
  const f = await fixture();
  const admitted = f.manager();
  let attempts = 0;
  let fail = true;
  const jobs = f.manager(f.peer, {
    notify: async (job, head) => {
      attempts += 1;
      const change = await f.notify(job, head);
      if (fail) throw new Error("receipt write lost");
      return change;
    },
    diagnostic: async () => {
      throw new Error("diagnostic store also unavailable");
    },
  });
  try {
    await f.seed({ kind: "cancelled" });
    await jobs.recover();
    expect(await pending(f.session, "main")).toHaveLength(1);
    expect(f.notifications).toHaveLength(1);
    fail = false;
    await Promise.all([jobs.recover(), admitted.recover()]);
    expect(attempts).toBe(2);
    expect(await pending(f.session, "main")).toHaveLength(1);
    expect(f.notifications).toHaveLength(1);
  } finally {
    await f.close();
  }
});

test("quiet interruption suppresses a terminal completion before delivery claims it", async () => {
  const f = await fixture();
  const jobs = f.manager(f.peer);
  try {
    await f.seed({ kind: "completed" });
    await jobs.interruptOwned({ runId: f.run.id, kind: "cancelled" });
    expect(f.notifications).toEqual([]);
    expect(await pending(f.session, "main")).toEqual([]);
  } finally {
    await f.close();
  }
});

test("quiet interruption lets an already claimed completion finish once", async () => {
  const f = await fixture();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const jobs = f.manager(f.peer, {
    notify: async (job, head) => {
      entered.resolve();
      await release.promise;
      return f.notify(job, head);
    },
  });
  try {
    await f.seed({ kind: "completed" });
    const recovering = jobs.recover();
    await within(entered.promise);
    const interrupting = jobs.interruptOwned({ runId: f.run.id, kind: "cancelled" });
    release.resolve();
    await Promise.all([recovering, interrupting]);
    expect(f.notifications).toHaveLength(1);
    expect(await pending(f.session, "main")).toHaveLength(1);
  } finally {
    release.resolve();
    await f.close();
  }
});

test("a failed detached lease release and failed diagnostic do not reject shutdown", async () => {
  const f = await fixture();
  const diagnosed = Promise.withResolvers<void>();
  const jobs = f.manager(f.session, {
    diagnostic: async () => {
      diagnosed.resolve();
      throw new Error("diagnostic failed");
    },
  });
  const work = controlledTool();
  try {
    await expect(
      jobs.wrap(work.tool).execute("call", { command: "work" }, undefined, undefined, f.context),
    ).rejects.toBeInstanceOf(ToolWait);
    await within(work.started.promise);
    vi.spyOn(f.session.leases, "release").mockRejectedValue(new Error("release failed"));
    work.finished.resolve(result);
    await within(diagnosed.promise);
    await within(jobs.close());
    expect(only(await jobs.list()).phase.kind).toBe("completed");
  } finally {
    await f.close();
  }
});

test("cancellation losing to completion reports the completed job", async () => {
  const f = await fixture();
  const owner = f.manager();
  const remote = f.manager(f.peer);
  const work = controlledTool();
  const entered = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  const executing = owner
    .wrap(work.tool)
    .execute("call", { command: "work", background: true }, undefined, undefined, f.context)
    .catch((cause: unknown) => cause);
  try {
    await within(work.started.promise);
    work.publish();
    expect(await within(executing)).toBeInstanceOf(ToolWait);
    const job = only(await owner.list());
    const update = f.peer.refs.update.bind(f.peer.refs);
    vi.spyOn(f.peer.refs, "update").mockImplementationOnce(async (updates, options) => {
      entered.resolve();
      await resume.promise;
      return update(updates, options);
    });
    const cancelling = remote.cancel(job.id);
    await within(entered.promise);
    work.finished.resolve(result);
    await expect.poll(async () => only(await owner.list()).phase.kind).toBe("completed");
    resume.resolve();
    expect(await within(cancelling)).toEqual({ kind: "finished" });
    expect(only(f.notifications).end).toEqual({ kind: "completed" });
  } finally {
    resume.resolve();
    await f.close();
  }
});

test("a lost lease stops the old owner's work and neither renewal nor close can touch the successor's job", async () => {
  const f = await fixture();
  const work = controlledTool();
  const diagnosed = Promise.withResolvers<void>();
  const owner = f.manager(f.session, {
    diagnostic: async () => {
      diagnosed.resolve();
    },
  });
  try {
    await expect(
      owner.wrap(work.tool).execute("call", { command: "work" }, undefined, undefined, f.context),
    ).rejects.toBeInstanceOf(ToolWait);
    const signal = await within(work.started.promise);
    const job = only(await owner.list());
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 30_000);
    const successor = granted(await f.peer.leases.acquire(JOB_PREFIX + job.id, 15_000));
    await within(diagnosed.promise, 7_000);
    expect(signal.aborted).toBe(true);
    expect(only(await owner.list()).phase.kind).toBe("running");
    await within(owner.close());
    expect(only(await owner.list()).phase.kind).toBe("running");
    expect(await f.peer.leases.read(JOB_PREFIX + job.id)).toEqual(successor);
    expect(f.notifications).toEqual([]);
    work.finished.reject(new Error("late failure after takeover"));
    await Promise.resolve();
  } finally {
    await f.close();
  }
}, 10_000);

test("an abort wake racing promotion still cancels the promoted work", async () => {
  const f = await fixture();
  const owner = f.manager();
  const remote = f.manager(f.peer);
  const work = controlledTool();
  const entered = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  try {
    await expect(
      owner.wrap(work.tool).execute("call", { command: "work" }, undefined, undefined, f.context),
    ).rejects.toBeInstanceOf(ToolWait);
    const signal = await within(work.started.promise);
    const job = only(await owner.list());
    const update = f.peer.refs.update.bind(f.peer.refs);
    vi.spyOn(f.peer.refs, "update").mockImplementationOnce(async (updates, options) => {
      entered.resolve();
      await resume.promise;
      return update(updates, options);
    });
    const wake = remote.wrap(work.tool).wake;
    assert.ok(wake);
    const waking = wake(
      {
        runId: f.run.id,
        head: f.run.head,
        toolCallId: "call",
        resultEntryId: "result",
        args: { command: "work" },
      },
      { aborted: true, expired: false, signal: new AbortController().signal },
    );
    await within(entered.promise);
    expect(await owner.background(job.id)).toEqual({ kind: "applied" });
    resume.resolve();
    expect(await within(waking)).toMatchObject({
      kind: "settle",
      result: { details: { jobId: job.id } },
    });
    expect(only(await owner.list())).toMatchObject({ phase: { kind: "cancelled" } });
    expect((await f.stored(job.id)).completion.kind).not.toBe("none");
    expect(signal.aborted).toBe(true);
  } finally {
    resume.resolve();
    await f.close();
  }
});

test("recheck signals a job that finished before its call was parked, and skips non-job calls", async () => {
  const f = await fixture();
  const jobs = f.manager();
  const work = controlledTool();
  try {
    const executing = jobs
      .wrap(work.tool)
      .execute("call", { command: "work" }, undefined, undefined, f.context)
      .catch((cause: unknown) => cause);
    await within(work.started.promise);
    work.finished.resolve(result);
    await expect.poll(async () => only(await jobs.list()).phase.kind).toBe("completed");
    expect(await executing).toBeInstanceOf(ToolWait);
    // The turn parks after the job already finished, so the completion's own
    // signal found no waiting effect. The post-park recheck must wake it.
    const headLease = await lease(f.session, "main");
    for (const callId of ["call", "unmanaged-question"]) {
      const effect = await openEffect(f.session, {
        lease: headLease,
        runId: f.run.id,
        callId,
        tool: callId === "call" ? "bash" : "clarify",
        args: {},
        replay: "never",
      });
      assert.ok(effect.kind === "opened");
      await parkEffect(f.session, { lease: headLease, view: effect.view });
    }
    await jobs.recheck(f.run.id);
    expect((await readEffect(f.session, { runId: f.run.id, callId: "call" }))?.effect.state).toBe(
      "signal",
    );
    expect(
      (await readEffect(f.session, { runId: f.run.id, callId: "unmanaged-question" }))?.effect
        .state,
    ).toBe("waiting");
    expect(f.notifications).toEqual([]);
  } finally {
    await f.close();
  }
});
