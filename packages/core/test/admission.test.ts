import { asId } from "@nyte-ai/schema";
import type { Authority, CommitId, Message } from "@nyte-ai/schema";
import { assert, describe, expect, it } from "vitest";
import { TOKEN, createConnection, decodeInboxRecord, inboxRef, memoryStore } from "../src/index.ts";
import type { Session } from "../src/index.ts";
import { completed, label, livePart, main, recording, setup, until, usage } from "./harness.ts";

async function message(session: Session, id: string): Promise<Message | undefined> {
  return (await session.view()).messages.find((current) => current.id === id);
}

describe("admission", () => {
  it("starts a run for a steer on an idle head and lands it into that run", async () => {
    const { host, script } = await setup();
    const session = await host.sessions.create({ name: "triage" });
    const receipt = await session.send("Add a test.");

    expect(receipt.message).toBe(receipt.id);
    expect(await receipt.status()).toEqual({ kind: "pending" });
    expect(await message(session, receipt.message)).toMatchObject({
      kind: "user",
      status: { kind: "pending", schedule: { kind: "next-turn", reason: "idle" }, covered: true },
    });

    const step = host.execution.advance({ session: session.id, head: main });
    const turn = await script.started(1);

    expect(turn.input.run.origin).toEqual({ kind: "input", message: receipt.message });
    expect(await receipt.landed()).toMatchObject({
      kind: "landed",
      run: turn.input.run.id,
      replaced: null,
    });
    expect((await session.view()).execution).toMatchObject({
      kind: "live",
      run: { id: turn.input.run.id },
    });

    turn.finish();

    expect(await step).toEqual({ kind: "idle" });
    expect(await receipt.settled()).toEqual(completed);
    expect((await session.view()).execution).toMatchObject({
      kind: "idle",
      lastRun: { id: turn.input.run.id, end: completed },
    });
  });

  it("holds a queued input until the live run ends", async () => {
    const { host, script } = await setup();
    const session = await host.sessions.create();
    const first = await session.send("First.");
    const step = host.execution.advance({ session: session.id, head: main });
    const turn = await script.started(1);
    const queued = await session.send("Second.", { delivery: "queue" });

    expect(await message(session, queued.message)).toMatchObject({
      status: { kind: "pending", schedule: { kind: "next-turn", reason: "run-ended" } },
    });

    turn.finish();

    expect(await step).toEqual({ kind: "continue" });
    expect(await queued.status()).toEqual({ kind: "pending" });

    const next = host.execution.advance({ session: session.id, head: main });
    const second = await script.started(2);

    expect(second.input.run.origin).toEqual({ kind: "input", message: queued.message });
    expect(await queued.landed()).toMatchObject({ kind: "landed", run: second.input.run.id });

    second.finish();

    expect(await next).toEqual({ kind: "idle" });
    expect(await first.settled()).toEqual(completed);
    expect(await queued.settled()).toEqual(completed);
  });

  it("never starts a run for an attached input; it rides the next one", async () => {
    const { host, script } = await setup();
    const session = await host.sessions.create();
    const attached = await session.send("Context.", { delivery: "attach" });

    expect(await host.execution.advance({ session: session.id, head: main })).toEqual({
      kind: "idle",
    });
    expect(script.turns).toHaveLength(0);
    expect(await message(session, attached.message)).toMatchObject({
      status: { kind: "pending", schedule: { kind: "attached" } },
    });

    await session.send("Go.");
    const step = host.execution.advance({ session: session.id, head: main });
    const turn = await script.started(1);

    expect(await attached.landed()).toMatchObject({ kind: "landed", run: turn.input.run.id });

    turn.finish();
    await step;

    expect(await attached.settled()).toEqual(completed);
  });

  it("joins a steer to the live run and lands it at the next boundary", async () => {
    const { host, script } = await setup();
    const session = await host.sessions.create();
    await session.send("First.");
    const step = host.execution.advance({ session: session.id, head: main });
    const turn = await script.started(1);
    const steer = await session.send("Also this.");

    expect(await message(session, steer.message)).toMatchObject({
      status: { kind: "pending", schedule: { kind: "joined", run: turn.input.run.id } },
    });
    expect(await turn.input.boundary()).toEqual([
      { message: steer.message, delivery: "steer", source: { kind: "user" } },
    ]);
    expect(await steer.landed()).toMatchObject({ kind: "landed", run: turn.input.run.id });
    expect(await turn.input.boundary()).toEqual([]);

    turn.finish();

    expect(await step).toEqual({ kind: "idle" });
    expect(script.turns).toHaveLength(1);
    expect(await steer.settled()).toEqual(completed);
  });

  it("replays a send with the same id and content, and refuses the id for other content", async () => {
    const { host } = await setup();
    const session = await host.sessions.create();
    const id = asId<"receipt">("receipt-1");
    const first = await session.send("Once.", { id, delivery: "attach" });
    const again = await session.send("Once.", { id, delivery: "attach" });

    expect(again.id).toBe(first.id);
    expect((await session.view()).messages.map((current) => current.id)).toEqual([id]);
    await expect(session.send("Twice.", { id, delivery: "attach" })).rejects.toMatchObject({
      code: "invalid",
    });
  });

  it("refuses a send `before_send` rejects", async () => {
    const { host } = await setup({ admit: async () => ({ action: "reject", reason: "No." }) });
    const session = await host.sessions.create();

    await expect(session.send("Hello.")).rejects.toMatchObject({ code: "invalid", message: "No." });
    expect((await session.view()).messages).toEqual([]);
  });

  it("withdraws an input stopped before it lands", async () => {
    const { host } = await setup();
    const session = await host.sessions.create();
    const receipt = await session.send("Later.", { delivery: "attach" });
    const landing = receipt.landed();
    const controller = new AbortController();
    const waiting = receipt.settled({ signal: controller.signal });
    controller.abort();

    await expect(waiting).rejects.toMatchObject({ code: "unavailable" });
    expect(await receipt.stop()).toEqual({ kind: "requested" });
    expect(await landing).toEqual({ kind: "withdrawn" });
    expect(await receipt.settled()).toEqual({ kind: "withdrawn" });
    expect((await session.view()).messages).toEqual([]);
    expect(await receipt.stop()).toEqual({ kind: "settled", outcome: { kind: "withdrawn" } });
  });

  it("revises a pending input in place under the same id and reorders it", async () => {
    const { host } = await setup();
    const session = await host.sessions.create();
    const first = await session.send("A.", { delivery: "attach" });
    const second = await session.send("B.", { delivery: "attach" });

    const revised = await session.send("A, revised.", {
      replace: first.message,
      position: { kind: "last" },
    });

    expect(revised.id).toBe(first.id);
    expect(await revised.status()).toEqual({ kind: "pending" });

    const view = await session.view();

    expect(view.messages.map((current) => current.id)).toEqual([second.message, first.message]);
    expect(view.messages[1]).toMatchObject({
      kind: "user",
      content: "A, revised.",
      delivery: "attach",
      status: { kind: "pending" },
    });
  });

  it("edits a landed message: stops its run, moves to its parent and admits a sibling", async () => {
    const { host, script } = await setup();
    const session = await host.sessions.create();
    const original = await session.send("Use v1.");
    const step = host.execution.advance({ session: session.id, head: main });
    const turn = await script.started(1);
    await original.landed();
    const edit = await session.send("Use v2.", { replace: original.message });
    await step;

    expect(await original.settled()).toEqual({ kind: "stopped" });

    const next = host.execution.advance({ session: session.id, head: main });
    const second = await script.started(2);

    expect(await edit.landed()).toMatchObject({
      kind: "landed",
      run: second.input.run.id,
      replaced: { previous: original.message, stopped: turn.input.run.id },
    });

    second.finish();
    await next;
    const view = await session.view();

    expect(view.messages.map((current) => current.id)).toEqual([edit.message]);
    expect(view.messages[0]).toMatchObject({ kind: "user", siblings: { index: 1, count: 2 } });
  });

  it("edits in one set, fence then head move then admission, without waiting for the run", async () => {
    const recorder = recording(await memoryStore().open());
    const { kernel, host, script } = await setup({ store: recorder.store });
    const session = await host.sessions.create();
    const original = await session.send("Use v1.");
    const step = host.execution.advance({ session: session.id, head: main });
    const turn = await script.started(1);
    const run = turn.input.run.id;
    await livePart(kernel, session.id, run, asId(`${run}:1:0`), "Draft");
    await original.landed();
    const before = await kernel.store.refs.tail(session.id);
    const from = recorder.sets.length;
    const edit = await session.send("Use v2.", { replace: original.message });
    const batch = ["run:stopping", "part:failed", "head:moved", "input:admitted"];

    expect(recorder.sets[from]).toEqual(batch);
    expect((await kernel.store.refs.log(session.id, before, 100)).map(label).slice(0, 4)).toEqual(
      batch,
    );
    expect(await step).toEqual({ kind: "continue" });
    expect(await original.settled()).toEqual({ kind: "stopped" });

    const next = host.execution.advance({ session: session.id, head: main });
    (await script.started(2)).finish();
    await next;

    expect(await edit.landed()).toMatchObject({
      kind: "landed",
      replaced: { previous: original.message, stopped: run },
    });
  });

  it("summarizes an edit's abandoned path after the fence, then admits in one set", async () => {
    const recorder = recording(await memoryStore().open());
    const summarized: (readonly CommitId[])[] = [];

    const { host, script } = await setup({
      store: recorder.store,
      summarize: async (input) => {
        summarized.push(input.commits);

        return { kind: "ok", markdown: "Tried v1.", usage };
      },
    });

    const session = await host.sessions.create();
    const original = await session.send("Use v1.");
    const step = host.execution.advance({ session: session.id, head: main });
    const turn = await script.started(1);
    const landed = await original.landed();
    assert(landed.kind === "landed");
    const from = recorder.sets.length;

    const edit = await session.send("Use v2.", {
      replace: original.message,
      abandoned: { summarize: {} },
    });

    await step;
    await until(async () => (await message(session, edit.message)) ?? undefined);

    expect(summarized).toEqual([[landed.commit]]);
    const sets = recorder.sets.slice(from).map((set) => set.join(" "));
    const fence = sets.indexOf("run:stopping");

    expect(fence).toBeGreaterThanOrEqual(0);
    expect(
      sets.indexOf("part:created part:settled commit head:moved input:admitted"),
    ).toBeGreaterThan(fence);
    expect((await session.view()).messages).toMatchObject([
      { kind: "part", partKind: "branchSummary", state: { markdown: "Tried v1." } },
      { id: edit.message, kind: "user", status: { kind: "pending" } },
    ]);

    const next = host.execution.advance({ session: session.id, head: main });
    (await script.started(2)).finish();
    await next;

    expect(await edit.landed()).toMatchObject({
      kind: "landed",
      replaced: { previous: original.message, stopped: turn.input.run.id },
    });
  });

  it("settles an edit `summary-failed` when its summary fails, admitting nothing", async () => {
    const { host, script } = await setup({
      summarize: async () => ({ kind: "failed", reason: "No model." }),
    });

    const session = await host.sessions.create();
    const original = await session.send("Use v1.");
    const step = host.execution.advance({ session: session.id, head: main });
    await script.started(1);
    await original.landed();

    const edit = await session.send("Use v2.", {
      replace: original.message,
      abandoned: { summarize: {} },
    });

    const outcome = { kind: "summary-failed", reason: "No model." };

    expect(await edit.settled()).toEqual(outcome);
    expect(await edit.landed()).toEqual(outcome);
    await step;
    expect(await original.settled()).toEqual({ kind: "stopped" });
    expect((await session.view()).messages.map((current) => current.id)).toEqual([
      original.message,
    ]);
  });

  it("settles an edit `stale` when the head moved past `expect`", async () => {
    const { host, script } = await setup();
    const session = await host.sessions.create();
    const original = await session.send("Hi.");
    const step = host.execution.advance({ session: session.id, head: main });
    (await script.started(1)).finish();
    await step;

    const edit = await session.send("Hello.", {
      replace: original.message,
      expect: asId("an-old-revision"),
    });

    const outcome = await edit.settled();
    assert(outcome.kind === "stale");

    expect(outcome.revision).toBe((await session.view()).revision);
    expect(await edit.landed()).toEqual(outcome);
    expect(await message(session, edit.message)).toBeUndefined();
  });

  it("settles an edit `pending-input` while other inputs wait on the head", async () => {
    const { host, script } = await setup();
    const session = await host.sessions.create();
    const original = await session.send("Hi.");
    const step = host.execution.advance({ session: session.id, head: main });
    (await script.started(1)).finish();
    await step;
    const later = await session.send("Later.", { delivery: "queue" });
    const edit = await session.send("Hello.", { replace: original.message });

    expect(await edit.settled()).toEqual({ kind: "pending-input", messages: [later.message] });
  });

  it("A-2 N2: a child's report waiting on a streaming head neither blocks an edit nor is dropped", async () => {
    const { host, script } = await setup({ execution: { kind: "admit-only" } });
    const session = await host.sessions.create();
    const child = await host.sessions.create({ parent: session.id });
    const first = await session.send("First.");
    const driving = host.execution.advance({ session: session.id, head: main });
    await script.started(1);

    const report = await session.send("Child report.", {
      delivery: "attach",
      source: { kind: "child", session: child.id },
    });

    const edit = await session.send("First v2.", { replace: first.message });
    await driving;

    expect(await edit.status()).toEqual({ kind: "pending" });

    const next = host.execution.advance({ session: session.id, head: main });
    const turn = await script.started(2);
    const landed = await edit.landed();
    assert(landed.kind === "landed");

    expect(landed.run).toBe(turn.input.run.id);
    expect(await report.landed()).toMatchObject({ kind: "landed", run: turn.input.run.id });
    turn.finish();
    await next;
  });

  it("A-2 N2: on a head whose last run stopped, a child's report starts nothing and blocks neither an edit nor a move", async () => {
    const { host, script } = await setup({ execution: { kind: "admit-only" } });
    const session = await host.sessions.create();
    const child = await host.sessions.create({ parent: session.id });
    const first = await session.send("First.");
    const step = host.execution.advance({ session: session.id, head: main });
    (await script.started(1)).finish({ kind: "stopped" });
    await step;

    await session.send("Child report.", {
      delivery: "attach",
      source: { kind: "child", session: child.id },
    });

    expect(await host.execution.advance({ session: session.id, head: main })).toMatchObject({
      kind: "idle",
    });

    const edit = await session.send("First v2.", { replace: first.message });

    expect(await edit.status()).toEqual({ kind: "pending" });

    const next = host.execution.advance({ session: session.id, head: main });
    (await script.started(2)).finish(completed);
    await next;

    await session.send("Job output.", {
      delivery: "attach",
      source: { kind: "job", job: asId("j1") },
    });

    expect(await (await session.move({ kind: "start" })).settled()).toMatchObject({
      kind: "moved",
    });
  });

  it("counts a child's queued wake as no pending input: the inbox records only a user's message as input an edit or a move must not pass", async () => {
    const { kernel, host, script } = await setup({ execution: { kind: "admit-only" } });
    const session = await host.sessions.create();
    const child = await host.sessions.create({ parent: session.id });
    const first = await session.send("First.");
    const step = host.execution.advance({ session: session.id, head: main });
    (await script.started(1)).finish(completed);
    await step;

    const wake = await session.send("Child done; wake up.", {
      delivery: "queue",
      source: { kind: "child", session: child.id },
    });

    const ref = await kernel.store.refs.get(inboxRef(session.id, main));

    const inbox = decodeInboxRecord(
      ref?.target ? await kernel.store.objects.get(ref.target) : null,
    );

    expect(inbox).toEqual({ messages: [wake.message], pendingInput: [] });

    const edit = await session.send("First v2.", { replace: first.message });

    expect(await edit.status()).toEqual({ kind: "pending" });

    const queued = await session.send("Then this.", { delivery: "queue" });

    expect(await (await session.move({ kind: "start" })).settled()).toEqual({
      kind: "pending-input",
      messages: [edit.message, queued.message],
    });
  });

  it("denies an operation the connection's principal lacks authority for", async () => {
    const { kernel } = await setup();
    const authority: ReadonlySet<Authority> = new Set(["participant"]);

    const connection = createConnection(kernel, {
      principal: TOKEN,
      authority,
      credential: { kind: "token", token: "t" },
      origin: null,
    });

    await expect(connection.settings.apply("theme", "dark")).rejects.toMatchObject({
      code: "denied",
    });
    expect((await connection.sessions.create()).id).toBeTypeOf("string");
  });
});
