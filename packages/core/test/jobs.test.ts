import { asId, standard } from "@nyte-ai/schema";
import type { CallId, Json, OutputFrame, SessionId } from "@nyte-ai/schema";
import { Type } from "typebox";
import { assert, describe, expect, it, vi } from "vitest";
import {
  LOCAL,
  callRef,
  createHost,
  decodeCallRecord,
  definePart,
  jobHandle,
  loadWaits,
  memoryStore,
  runStep,
  viewHead,
} from "../src/index.ts";
import type { ConnectionContext, Durable, Kernel } from "../src/index.ts";
import { addWorkspace, createDisk, fakeProvider, kernelOver, world } from "./fake-env.ts";
import type { Process } from "./fake-env.ts";
import { main, until } from "./harness.ts";

const question = definePart({
  kind: "test/question",
  state: standard(Type.Object({})),
  actions: { answer: { input: standard(Type.Object({ choice: Type.String() })) } },
  fallback: (_state, { id }) => `Ask ${id}`,
});

const caller: ConnectionContext = {
  principal: LOCAL,
  authority: new Set(["participant"]),
  credential: { kind: "token", token: "x" },
  origin: null,
};

/** Returns a call's record as the store holds it. */
async function readCall(kernel: Kernel, session: SessionId, call: CallId) {
  const ref = await kernel.store.refs.get(callRef(session, call));

  return decodeCallRecord(ref?.target ? await kernel.store.objects.get(ref.target) : null);
}

/** Returns the process the provider started `count`-th, once it has. */
function started(processes: readonly Process[], count: number): Promise<Process> {
  return until(() => processes[count - 1]);
}

/** Reads frames until `exit`, decoding bytes. */
async function drain(frames: AsyncIterable<OutputFrame>): Promise<readonly string[]> {
  const seen: string[] = [];

  for await (const frame of frames) {
    seen.push(frame.kind === "bytes" ? new TextDecoder().decode(frame.data) : frame.kind);

    if (frame.kind === "exit") break;
  }

  return seen;
}

/** Parks a durable step of the session on `target`, as a tool waiting on a job does. */
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

  it("yields the job list as it changes", async () => {
    const { host, provider, workspace } = await world();
    const jobs = host.workspace(workspace).jobs;
    const watched = jobs.watch()[Symbol.asyncIterator]();
    const opened = await watched.next();

    assert(!opened.done);
    expect(opened.value).toEqual([]);
    await jobs.start({ command: "echo hi" });
    await started(provider.processes, 1);

    const ended = await until(async () => {
      const next = await watched.next();

      return !next.done && next.value[0]?.state.kind === "exited" ? next.value : undefined;
    });

    expect(ended[0]).toMatchObject({ command: "echo hi", tail: "hi\n" });
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
    expect(jobHandle(second, caller, job.id).key).toBeNull();
  });

  it("retries a job end the store refused, so the parked call takes the exit without a restart (B F4)", async () => {
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
    await until(async () =>
      (await readCall(kernel, session.id, call))?.waiting === null ? true : undefined,
    );
    expect(await readCall(kernel, session.id, call)).toMatchObject({
      waits: [{ kind: "job", job: job.id, end: { kind: "exited", code: 2 } }],
    });
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
});
