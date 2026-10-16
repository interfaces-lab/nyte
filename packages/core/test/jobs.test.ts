import { asId, standard } from "@nyte-ai/schema";
import type { CallId, JobView, Json, OutputFrame, SessionId } from "@nyte-ai/schema";
import { Type } from "typebox";
import { assert, describe, expect, it, vi } from "vitest";
import { createHost } from "../src/api/connection.ts";
import { runStep } from "../src/engine/durable.ts";
import { jobHandle } from "../src/engine/jobs.ts";
import { loadWaits } from "../src/engine/waits.ts";
import { workspaceHandle } from "../src/env/workspaces.ts";
import { viewHead } from "../src/fold/view.ts";
import { LOCAL, definePart } from "../src/index.ts";
import { callRef, decodeCallRecord, memoryStore } from "../src/store.ts";
import type { Kernel } from "../src/contract/kernel.ts";
import type { ConnectionContext, Durable } from "../src/index.ts";
import { addWorkspace, createDisk, fakeProvider, kernelOver, world } from "./fake-env.ts";
import type { Process } from "./fake-env.ts";
import { main, until } from "../src/harness.ts";

const question = definePart({
  kind: "test/question",
  state: standard(Type.Object({})),
  actions: { answer: { input: standard(Type.Object({ choice: Type.String() })) } },
  fallback: (_state, { id }) => `Ask ${id}`,
});

function stepContext(session: SessionId, call: CallId): ConnectionContext {
  let sequence = 0;

  return {
    principal: LOCAL,
    authority: new Set(["participant"]),
    credential: { kind: "token", token: "x" },
    origin: {
      session,
      run: null,
      head: main,
      call,
      sequence: {
        next: () => {
          sequence += 1;

          return sequence - 1;
        },
      },
    },
  };
}

async function readCall(kernel: Kernel, session: SessionId, call: CallId) {
  const ref = await kernel.store.refs.get(callRef(session, call));

  return decodeCallRecord(ref?.target ? await kernel.store.objects.get(ref.target) : null);
}

function started(processes: readonly Process[], count: number): Promise<Process> {
  return until(() => processes[count - 1]);
}

async function drain(frames: AsyncIterable<OutputFrame>): Promise<readonly string[]> {
  const seen: string[] = [];

  for await (const frame of frames) {
    seen.push(frame.kind === "bytes" ? new TextDecoder().decode(frame.data) : frame.kind);

    if (frame.kind === "exit") break;
  }

  return seen;
}

async function parkOn(
  kernel: Kernel,
  session: SessionId,
  call: CallId,
  body: (durable: Durable) => Promise<Json>,
) {
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
    body,
    settle: async (ended) => ({
      result: { ended: ended.kind === "done" ? ended.value : ended.kind },
      updates: [],
    }),
    decode: (result) => result,
  });
}

describe("jobs", () => {
  it("starts a session's job: output, tail, background item, and an exit report attached to main", async () => {
    const { kernel, host, provider, workspace } = await world();
    const session = await host.sessions.create({ workspace });
    const jobs = host.workspace(workspace).jobs;
    const job = await jobs.start({ command: "pnpm dev", session: session.id, title: "Dev server" });
    const process = await started(provider.processes, 1);

    expect(process.command).toBe("pnpm dev");
    expect(job.key).toBeNull();
    expect(await jobs.list()).toMatchObject([
      {
        id: job.id,
        command: "pnpm dev",
        title: "Dev server",
        session: session.id,
        pty: null,
        state: { kind: "running" },
      },
    ]);
    expect((await session.view()).background).toEqual([
      { kind: "job", id: job.id, title: "Dev server", state: "working", startedBy: null },
    ]);

    const other = await viewHead(kernel, {
      session: session.id,
      head: main,
      principal: asId("other"),
    });

    expect(other.background).toEqual([expect.objectContaining({ id: job.id, state: "working" })]);

    const reading = drain(job.output());
    process.emit("ready on :3000\n");
    process.exit(0);

    expect(await reading).toEqual(["ready on :3000\n", "exit"]);
    expect(await job.settled()).toEqual({ kind: "exited", code: 0, reason: "exited" });
    expect((await jobs.list())[0]).toMatchObject({
      state: { kind: "exited", code: 0, reason: "exited" },
      endedAt: expect.any(Number),
      tail: "ready on :3000\n",
    });

    const view = await until(async () => {
      const current = await session.view();

      return current.messages.length > 0 ? current : undefined;
    });

    expect(view.background).toEqual([expect.objectContaining({ id: job.id, state: "done" })]);
    expect(view.messages[0]).toMatchObject({
      kind: "user",
      content: "Job Dev server (pnpm dev) exited with code 0.\n\nready on :3000",
      source: { kind: "job", job: job.id },
      delivery: "attach",
    });
    expect(await drain(job.output())).toEqual(["ready on :3000\n", "exit"]);
  });

  it("sends no report when a parked wait consumed the job's end", async () => {
    const { kernel, host, provider, workspace } = await world();
    const session = await host.sessions.create({ workspace });

    const job = await host
      .workspace(workspace)
      .jobs.start({ command: "make", session: session.id });

    const call: CallId = asId("c1");

    expect(
      await parkOn(
        kernel,
        session.id,
        call,
        async (durable) => (await durable.wait({ kind: "job", job: job.id })).kind,
      ),
    ).toEqual({ kind: "parked" });

    (await started(provider.processes, 1)).exit(2);
    await job.settled();

    const record = await until(async () => {
      const ref = await kernel.store.refs.get(callRef(session.id, call));

      const found = decodeCallRecord(
        ref?.target ? await kernel.store.objects.get(ref.target) : null,
      );

      return found !== null && found.waits.length > 0 ? found : undefined;
    });

    expect(record.waits).toEqual([
      { kind: "job", job: job.id, end: { kind: "exited", code: 2, reason: "exited" } },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect((await session.view()).messages).toEqual([]);
    expect((await session.view()).background).toEqual([
      expect.objectContaining({ id: job.id, state: "failed" }),
    ]);
  });

  it("opens a late reader on the last 256 KiB of output, after a gap for what it dropped, and keeps the view's tail at 4 KiB", async () => {
    const { host, provider, workspace } = await world();
    const jobs = host.workspace(workspace).jobs;
    const job = await jobs.start({ command: "pnpm dev" });
    const process = await started(provider.processes, 1);
    const line = new TextEncoder().encode(`${"x".repeat(1023)}\n`);

    for (let index = 0; index < 300; index += 1) process.emit(line);
    process.emit("ready\n");
    const view = await until(async () => {
      const [current] = await jobs.list();

      return current?.tail.endsWith("ready\n") === true ? current : undefined;
    });
    const reader = job.output()[Symbol.asyncIterator]();
    const gap = await reader.next();
    const replay = await reader.next();

    expect(gap.value).toEqual({ kind: "gap" });
    assert(!replay.done && replay.value.kind === "bytes");
    expect(replay.value.data.byteLength).toBe(256 * 1024);
    expect(new TextDecoder().decode(replay.value.data).endsWith("x\nready\n")).toBe(true);
    expect(view.tail.length).toBeLessThanOrEqual(4096);
    expect(view.tail.startsWith("x")).toBe(true);
    process.emit("live\n");
    const live = await reader.next();
    assert(!live.done && live.value.kind === "bytes");
    expect(new TextDecoder().decode(live.value.data)).toBe("live\n");
    await reader.return?.();
  });

  it("gives a slow reader a gap instead of stalling the process", async () => {
    const { host, provider, workspace } = await world();
    const job = await host.workspace(workspace).jobs.start({ command: "yes" });
    const process = await started(provider.processes, 1);
    const slow = job.output()[Symbol.asyncIterator]();
    const first = slow.next();
    const chunk = new Uint8Array(16 * 1024).fill(121);

    process.emit("start\n");
    const opened = await first;

    assert(!opened.done);

    for (let index = 0; index < 8; index += 1) process.emit(chunk);
    process.emit("end\n");
    process.exit(0);
    await job.settled();

    const kinds: string[] = [
      opened.value.kind === "bytes" ? `bytes:${opened.value.data.byteLength}` : opened.value.kind,
    ];

    for (;;) {
      const next = await slow.next();

      if (next.done) break;
      kinds.push(
        next.value.kind === "bytes" ? `bytes:${next.value.data.byteLength}` : next.value.kind,
      );
    }

    expect(kinds).toEqual([
      "bytes:6",
      "bytes:16384",
      "bytes:16384",
      "bytes:16384",
      "bytes:16384",
      "gap",
      "exit",
    ]);

    const tail = (await host.workspace(workspace).jobs.list())[0]?.tail;

    expect([tail?.length, tail?.endsWith("yend\n")]).toEqual([4096, true]);
  });

  it("holds a user's shell for a slow reader instead of skipping its output", async () => {
    const { host, provider, workspace } = await world();
    const jobs = host.workspace(workspace).jobs;
    const job = await jobs.start({ pty: { columns: 80, rows: 24 } });
    const process = await started(provider.processes, 1);
    const slow = job.output()[Symbol.asyncIterator]();
    const first = slow.next();
    const chunk = new Uint8Array(16 * 1024).fill(121);

    process.emit("start\n");
    assert(!(await first).done);

    for (let index = 0; index < 8; index += 1) process.emit(chunk);
    process.emit("end\n");
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect((await jobs.list())[0]?.tail.endsWith("end\n")).toBe(false);

    const sizes: number[] = [];

    while (sizes.at(-1) !== 4) {
      const next = await slow.next();
      assert(!next.done && next.value.kind === "bytes");
      sizes.push(next.value.data.byteLength);
    }

    expect(sizes).toEqual([...Array.from({ length: 8 }, () => 16 * 1024), 4]);
    process.exit(0);
    expect(await slow.next()).toEqual({ done: false, value: { kind: "exit", code: 0 } });
  });

  it("stops a user's shell a minute after its last reader leaves, never one a reader holds or a session owns", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    try {
      const { host, provider, workspace } = await world();
      const jobs = host.workspace(workspace).jobs;
      const session = await host.sessions.create({ workspace });
      const shell = await jobs.start({ pty: { columns: 80, rows: 24 } });
      const owned = await jobs.start({ pty: { columns: 80, rows: 24 }, session: session.id });
      await started(provider.processes, 2);
      const reader = shell.output()[Symbol.asyncIterator]();
      const opened = reader.next();

      vi.advanceTimersByTime(120_000);
      const state = async () =>
        (await jobs.list()).map(
          (job) => (job.id === shell.id ? "shell" : "owned") + ":" + job.state.kind,
        );

      expect(await state()).toEqual(["shell:running", "owned:running"]);

      await reader.return?.();
      expect(await opened).toEqual({ done: true, value: undefined });
      vi.advanceTimersByTime(60_000);

      expect(await shell.settled()).toEqual({ kind: "exited", code: null, reason: "terminated" });
      expect((await jobs.list()).find((job) => job.id === owned.id)?.state).toEqual({
        kind: "running",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("recovers a pty job by key, writes, resizes and stops it; a pipe job answers not-pty", async () => {
    const { host, provider, workspace } = await world();
    const jobs = host.workspace(workspace).jobs;
    const shell = await jobs.start({ pty: { columns: 80, rows: 24 } });
    const process = await started(provider.processes, 1);

    expect(process.command).toEqual([]);
    assert(shell.key !== null);

    const recovered = await jobs.recover(shell.key);

    assert("id" in recovered);
    expect(recovered.id).toBe(shell.id);
    await recovered.write(new TextEncoder().encode("ls\n"));
    expect(process.stdin).toEqual(["ls\n"]);
    expect(await recovered.resize({ columns: 120, rows: 40 })).toEqual({ kind: "resized" });
    expect((await jobs.list())[0]?.pty).toEqual({ columns: 120, rows: 40, shell: "login" });
    process.idle = true;
    expect(await recovered.idle()).toBe(true);

    expect(await recovered.stop()).toEqual({
      kind: "settled",
      outcome: { kind: "exited", code: null, reason: "terminated" },
    });
    expect(await jobs.recover(shell.key)).toEqual({
      kind: "ended",
      end: { kind: "exited", code: null, reason: "terminated" },
    });
    expect(await jobs.recover(asId("unknown"))).toEqual({ kind: "missing" });
    expect(await shell.stop()).toMatchObject({ kind: "settled" });

    const named = await jobs.start({ command: "zsh -l", pty: { columns: 80, rows: 24 } });

    expect((await jobs.list()).find((view) => view.id === named.id)?.pty).toEqual({
      columns: 80,
      rows: 24,
      shell: "zsh -l",
    });
    expect(provider.processes[1]?.command).toBe("zsh -l");

    const pipe = await jobs.start({ command: "sleep 1" });

    expect(await pipe.resize({ columns: 1, rows: 1 })).toEqual({ kind: "not-pty" });
    expect(await pipe.idle()).toBe(false);
    await expect(jobs.start({})).rejects.toMatchObject({ code: "invalid" });
  });

  it("replays a start by id and refuses the id with another input", async () => {
    const { host, provider, workspace } = await world();
    const jobs = host.workspace(workspace).jobs;
    const id = asId<"job">("dev");
    const first = await jobs.start({ command: "pnpm dev", id });
    const again = await jobs.start({ command: "pnpm dev", id });

    expect(again.id).toBe(first.id);
    expect(provider.processes).toHaveLength(1);
    await expect(jobs.start({ command: "pnpm test", id })).rejects.toMatchObject({
      code: "invalid",
    });
  });

  it("yields the job list, again after each job that moves, keeping every unmoved view, and forgets ended jobs past 32", async () => {
    const { host, provider, workspace } = await world();
    const jobs = host.workspace(workspace).jobs;
    const server = await jobs.start({ command: "pnpm dev" });
    await started(provider.processes, 1);
    const watched = jobs.watch()[Symbol.asyncIterator]();
    const opened = await watched.next();

    assert(!opened.done);
    expect(opened.value.map((job) => job.id)).toEqual([server.id]);
    provider.processes[0]?.emit("listening\n");
    await jobs.start({ command: "echo hi" });

    const ended = await until(async () => {
      const next = await watched.next();
      assert(!next.done);

      return next.value.find((job) => job.command === "echo hi" && job.state.kind === "exited");
    });

    expect(ended).toMatchObject({ command: "echo hi", tail: "hi\n" });

    for (let index = 0; index < 32; index += 1) await jobs.start({ command: `echo ${index}` });
    let before: readonly JobView[] = [];

    const after = await until(async () => {
      const next = await watched.next();
      assert(!next.done);
      const previous = before;
      before = next.value;

      return next.value.some((job) => job.id === ended.id)
        ? undefined
        : { previous, next: next.value };
    });

    expect(after.next.filter((job) => !after.previous.includes(job))).toEqual([]);
    await watched.return?.();
  });

  it("reads a job this process did not start as lost after a new kernel, its output unavailable", async () => {
    const { kernel, host, provider, workspace } = await world();
    const job = await host.workspace(workspace).jobs.start({ command: "pnpm dev" });
    const second = kernelOver(kernel.store, provider);
    const fresh = createHost(second, { credential: { kind: "token", token: "x" } });
    const lost = fresh.workspace(workspace).job(job.id);

    expect(await lost.settled()).toEqual({ kind: "lost" });
    expect(await lost.stop()).toEqual({ kind: "missing" });
    expect(await lost.resize({ columns: 1, rows: 1 })).toEqual({ kind: "missing" });
    expect(() => lost.output()).toThrow(expect.objectContaining({ code: "unavailable" }));
    await expect(lost.write(new Uint8Array(1))).rejects.toMatchObject({ code: "unknown" });
    expect(await fresh.workspace(workspace).jobs.list()).toEqual([]);
    expect(jobHandle(second, job.id).key).toBeNull();
  });

  it("leaves a job end the store refused to the wait holding it: repair settles it with the exit, and no report is sent (B F4, B-2 P5)", async () => {
    const inner = await memoryStore().open();
    let refusing = false;

    const store = {
      ...inner,
      refs: {
        ...inner.refs,
        set: (updates: Parameters<typeof inner.refs.set>[0]) =>
          refusing ? Promise.reject(new Error("The store went away.")) : inner.refs.set(updates),
      },
    };

    const disk = createDisk();
    disk.directories.add("/work/project");
    const provider = fakeProvider(disk);
    const kernel = kernelOver(store, provider);
    const host = createHost(kernel, { credential: { kind: "token", token: "x" } });
    const workspace = await addWorkspace(host);
    const session = await host.sessions.create({ workspace });
    const job = await host
      .workspace(workspace)
      .jobs.start({ command: "make", session: session.id });
    const call: CallId = asId("c1");
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);

    expect(
      await parkOn(
        kernel,
        session.id,
        call,
        async (durable) => (await durable.wait({ kind: "job", job: job.id })).kind,
      ),
    ).toEqual({ kind: "parked" });

    refusing = true;
    (await started(provider.processes, 1)).exit(2);
    await job.settled();
    await new Promise((resolve) => setTimeout(resolve, 20));
    refusing = false;
    process.off("unhandledRejection", unhandled);

    expect(unhandled).not.toHaveBeenCalled();
    expect(await readCall(kernel, session.id, call)).toMatchObject({ waits: [] });
    await host.execution.repair({ limit: 10 });
    expect(await readCall(kernel, session.id, call)).toMatchObject({
      waiting: null,
      waits: [{ kind: "job", job: job.id, end: { kind: "exited", code: 2 } }],
    });
    expect((await session.view()).messages).toEqual([]);
  });

  it("offers a cold host's answer only to its part: a wait on any of a running job and the part takes the answer (B F2)", async () => {
    const { kernel, host, provider, workspace } = await world();
    const session = await host.sessions.create({ workspace });
    const job = await host
      .workspace(workspace)
      .jobs.start({ command: "make", session: session.id });
    const part = await session.parts.create(question, { state: {}, placement: { kind: "modal" } });
    const call: CallId = asId("c1");

    expect(
      await parkOn(
        kernel,
        session.id,
        call,
        async (durable) =>
          (
            await durable.wait({
              kind: "any",
              targets: [
                { kind: "job", job: job.id },
                { kind: "part", part: part.id },
              ],
            })
          ).kind,
      ),
    ).toEqual({ kind: "parked" });

    const cold = createHost(kernelOver(kernel.store, provider), {
      credential: { kind: "token", token: "x" },
    });

    await cold.session(session.id).part(part.id).act("answer", { choice: "yes" });

    expect(await readCall(kernel, session.id, call)).toMatchObject({
      waiting: null,
      waits: [
        { kind: "part", part: part.id, answer: { action: "answer", input: { choice: "yes" } } },
      ],
    });
  });

  it("settles a wait on a job this instance does not hold as lost when another kernel loads it", async () => {
    const { kernel, host, provider, workspace } = await world();
    const session = await host.sessions.create({ workspace });
    const job = await host
      .workspace(workspace)
      .jobs.start({ command: "make", session: session.id });
    const call: CallId = asId("c1");

    await parkOn(
      kernel,
      session.id,
      call,
      async (durable) => (await durable.wait({ kind: "job", job: job.id })).kind,
    );

    const second = kernelOver(kernel.store, provider);
    const woken: string[] = [];
    second.wakes.subscribe((woke, head) => woken.push(`${woke}/${head}`));
    await loadWaits(second);

    expect(await readCall(second, session.id, call)).toMatchObject({
      waiting: null,
      waits: [{ kind: "job", job: job.id, end: { kind: "lost" } }],
    });
    expect(woken).toEqual([`${session.id}/${main}`]);
  });
  it("leaves a wait on a job this instance does not hold parked when another kernel sees a commit", async () => {
    const { kernel, host, provider, workspace } = await world();
    const session = await host.sessions.create({ workspace });
    const job = await host
      .workspace(workspace)
      .jobs.start({ command: "make", session: session.id });
    const call: CallId = asId("c1");

    await parkOn(
      kernel,
      session.id,
      call,
      async (durable) => (await durable.wait({ kind: "job", job: job.id })).kind,
    );

    await kernelOver(kernel.store, provider).waits.refresh();

    expect(await readCall(kernel, session.id, call)).toMatchObject({ waits: [] });
  });

  it("answers a step's recorded job as lost after a restart, spawning nothing again (B F1, P1)", async () => {
    const { kernel, host, provider, workspace } = await world();
    const session = await host.sessions.create({ workspace });
    const call: CallId = asId("c1");
    const handles: string[] = [];

    const body =
      (on: Kernel) =>
      async (durable: Durable): Promise<Json> => {
        const job = await workspaceHandle(on, stepContext(session.id, call), workspace).jobs.start({
          command: "deploy --prod",
          session: session.id,
        });

        handles.push(job.id);

        return (await durable.wait({ kind: "job", job: job.id })).kind;
      };

    expect(await parkOn(kernel, session.id, call, body(kernel))).toEqual({ kind: "parked" });

    const second = kernelOver(kernel.store, provider);
    await parkOn(second, session.id, call, body(second));
    const [first, again] = handles;
    assert(first !== undefined && again !== undefined);

    expect(again).toBe(first);
    expect(provider.processes.map((process) => process.command)).toEqual(["deploy --prod"]);
    expect(await jobHandle(second, asId(again)).settled()).toEqual({ kind: "lost" });
  });
  it("spawns a concurrent start under one id once and answers both with that job (audit D4-D5 #3, concurrent-explicit-job-id)", async () => {
    const { host, provider, workspace } = await world();
    const gate = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    const attach = provider.attach.bind(provider);

    provider.attach = async (target) => {
      const attached = await attach(target);

      return {
        ...attached,
        exec: async (command, options) => {
          entered.resolve();
          await gate.promise;

          return attached.exec(command, options);
        },
      };
    };

    const jobs = host.workspace(workspace).jobs;
    const id = asId<"job">("same");
    const first = jobs.start({ id, command: "deploy --prod" });
    await entered.promise;
    const second = jobs.start({ id, command: "deploy --prod" });

    await expect(jobs.start({ id, command: "deploy --staging" })).rejects.toMatchObject({
      code: "invalid",
    });
    gate.resolve();

    expect((await Promise.all([first, second])).map((job) => job.id)).toEqual([id, id]);
    expect(provider.processes.map((process) => process.command)).toEqual(["deploy --prod"]);
    expect(await jobs.list()).toHaveLength(1);
  });
});
