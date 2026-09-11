import assert from "node:assert/strict";
import type { JobInfo } from "@nyte-ai/protocol";
import { Type } from "typebox";
import { afterEach, expect, test, vi } from "vitest";
import { openEffect, parkEffect, readEffect } from "../src/kernel/effects.ts";
import { toJsonValue } from "../src/kernel/json.ts";
import type { Run } from "../src/kernel/model.ts";
import { runRef } from "../src/kernel/names.ts";
import { pending, submit } from "../src/kernel/queue.ts";
import { createJobs, JOB_PREFIX, parseJobRecord } from "../src/kernel/sdk/jobs.ts";
import { sessionId } from "../src/kernel/sdk/types.ts";
import { ToolWait, type AgentTool, type AgentToolResult } from "../src/types.ts";
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
    phase: { kind: "tools" },
    startedAt: Date.now(),
    attempts: 0,
    config: {},
  };
  const oid = only(await session.objects.put([run]));
  await session.refs.update([{ name: runRef(run.head), from: null, to: oid }], { reason: "test" });
  const notifications: JobInfo[] = [];
  const interruptions: string[] = [];
  const diagnostics: unknown[] = [];
  const managers: ReturnType<typeof createJobs>[] = [];
  const notify = async (job: JobInfo) => {
    const outcome = await submit(session, {
      head: job.head,
      lane: "background",
      key: `background-${job.id}`,
      body: {
        kind: "message",
        message: { role: "user", content: job.output, timestamp: job.updatedAt },
      },
    });
    if (outcome.kind === "queued") notifications.push(job);
  };
  const manager = (
    connection = session,
    overrides: Partial<Parameters<typeof createJobs>[0]> = {},
  ) => {
    const jobs = createJobs({
      session: connection,
      childId: () => sessionId("child"),
      backgroundChild: async () => {},
      interruptChild: async (id) => {
        interruptions.push(id);
      },
      notify,
      diagnostic: async (cause) => {
        diagnostics.push(cause);
      },
      ...overrides,
    });
    managers.push(jobs);
    return jobs;
  };
  const seed = async (state: JobInfo["state"] = "running", kind: JobInfo["kind"] = "command") => {
    const base = {
      id: "orphan",
      runId: run.id,
      callId: "call",
      head: run.head,
      title: kind,
      state,
      mode: "background",
      startedAt: 1,
      updatedAt: 1,
      output: "partial output",
    } satisfies Omit<JobInfo, "kind">;
    const info: JobInfo =
      kind === "command"
        ? { ...base, kind }
        : { ...base, kind, childSessionId: sessionId("child") };
    const oid = only(
      await session.objects.put([{ kind: "blob", value: toJsonValue({ info, delivered: false }) }]),
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
    interruptions,
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
      wrapped.execute("call", {}, undefined, undefined, f.context),
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
    expect(f.notifications).toEqual([cancelled.info]);
    expect(await pending(f.session, "main")).toHaveLength(1);
    await expect(
      remote.wrap(work.tool).execute("call", {}, undefined, undefined, f.context),
    ).rejects.toThrow("Job already exists");
    expect(work.executions()).toBe(1);
  } finally {
    await f.close();
  }
});

test("recovery leaves a leased job alive, then interrupts the orphan and wakes its parked effect", async () => {
  const f = await fixture();
  const jobs = f.manager(f.peer);
  try {
    const info = await f.seed();
    const headLease = await lease(f.session, "main");
    const effect = await openEffect(f.session, {
      lease: headLease,
      runId: info.runId,
      callId: info.callId,
      tool: "bash",
      args: {},
      replay: "never",
    });
    assert.ok(effect.kind === "opened");
    await parkEffect(f.session, { lease: headLease, view: effect.view });
    const held = granted(await f.session.leases.acquire(JOB_PREFIX + info.id, 15_000));
    await jobs.recover();
    expect(only(await jobs.list()).state).toBe("running");
    expect(f.notifications).toEqual([]);
    await f.session.leases.release(held);
    await Promise.all([jobs.recover(), jobs.recover()]);
    expect(only(await jobs.list()).state).toBe("interrupted");
    expect(
      (await readEffect(f.session, { runId: info.runId, callId: info.callId }))?.effect.state,
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
    const info = await f.seed("running", "subagent");
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
    expect(only(await jobs.list()).state).toBe("running");
    expect(f.interruptions).toEqual([]);
    expect(f.notifications).toEqual([]);
    expect(await f.session.leases.read(JOB_PREFIX + info.id)).toEqual(successor);
    expect(f.diagnostics).toHaveLength(1);
  } finally {
    resume.resolve();
    await f.close();
  }
});

for (const name of ["bash", "task"]) {
  test(`${name}: close settles uncooperative work and ignores late rejection and updates`, async () => {
    const f = await fixture();
    const jobs = f.manager();
    const work = controlledTool(name);
    const executing = jobs
      .wrap(work.tool)
      .execute("call", { background: true }, undefined, undefined, f.context)
      .catch((cause: unknown) => cause);
    try {
      const signal = await within(work.started.promise);
      await within(jobs.close());
      expect(signal.aborted).toBe(true);
      expect(await executing).toBeInstanceOf(ToolWait);
      const job = only(await jobs.list());
      expect(job.state).toBe("interrupted");
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
}

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
    .execute("call", {}, undefined, undefined, f.context)
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

test("recovery retries failed delivery idempotently and repairs cancelled children", async () => {
  const f = await fixture();
  const admitted = f.manager();
  let fail = true;
  const jobs = f.manager(f.peer, {
    notify: async (info) => {
      await f.notify(info);
      if (fail) throw new Error("receipt write lost");
    },
    diagnostic: async () => {
      throw new Error("diagnostic store also unavailable");
    },
  });
  try {
    const info = await f.seed("cancelled", "subagent");
    assert.equal(info.kind, "subagent");
    await jobs.recover();
    expect((await f.stored(info.id)).delivered).toBe(false);
    expect(f.interruptions).toContain(info.childSessionId);
    expect(f.notifications).toHaveLength(1);
    fail = false;
    await Promise.all([jobs.recover(), admitted.recover()]);
    expect((await f.stored(info.id)).delivered).toBe(true);
    expect(await pending(f.session, "main")).toHaveLength(1);
    expect(f.notifications).toHaveLength(1);
  } finally {
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
      jobs.wrap(work.tool).execute("call", {}, undefined, undefined, f.context),
    ).rejects.toBeInstanceOf(ToolWait);
    await within(work.started.promise);
    vi.spyOn(f.session.leases, "release").mockRejectedValue(new Error("release failed"));
    work.finished.resolve(result);
    await within(diagnosed.promise);
    await within(jobs.close());
    expect(only(await jobs.list()).state).toBe("completed");
  } finally {
    await f.close();
  }
});

test("cancellation losing to completion does not interrupt a completed child", async () => {
  const f = await fixture();
  const owner = f.manager();
  const remote = f.manager(f.peer);
  const work = controlledTool("task");
  const entered = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  const executing = owner
    .wrap(work.tool)
    .execute("call", { background: true }, undefined, undefined, f.context)
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
    await expect.poll(async () => only(await owner.list()).state).toBe("completed");
    resume.resolve();
    expect(await within(cancelling)).toEqual({ kind: "finished" });
    expect(f.interruptions).toEqual([]);
    expect(only(f.notifications).state).toBe("completed");
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
      owner.wrap(work.tool).execute("call", {}, undefined, undefined, f.context),
    ).rejects.toBeInstanceOf(ToolWait);
    const signal = await within(work.started.promise);
    const job = only(await owner.list());
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 30_000);
    const successor = granted(await f.peer.leases.acquire(JOB_PREFIX + job.id, 15_000));
    await within(diagnosed.promise, 7_000);
    expect(signal.aborted).toBe(true);
    expect(only(await owner.list()).state).toBe("running");
    await within(owner.close());
    expect(only(await owner.list()).state).toBe("running");
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
      owner.wrap(work.tool).execute("call", {}, undefined, undefined, f.context),
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
      { runId: f.run.id, toolCallId: "call", resultEntryId: "result", args: {} },
      { aborted: true, expired: false, signal: new AbortController().signal },
    );
    await within(entered.promise);
    expect(await owner.background(job.id)).toEqual({ kind: "applied" });
    resume.resolve();
    expect(await within(waking)).toMatchObject({
      kind: "settle",
      result: { details: { jobId: job.id } },
    });
    expect(only(await owner.list())).toMatchObject({ state: "cancelled", mode: "background" });
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
      .execute("call", {}, undefined, undefined, f.context)
      .catch((cause: unknown) => cause);
    await within(work.started.promise);
    work.finished.resolve(result);
    await expect.poll(async () => only(await jobs.list()).state).toBe("completed");
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
