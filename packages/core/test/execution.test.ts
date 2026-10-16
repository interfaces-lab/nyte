import { asId, asSeq } from "@nyte-ai/schema";
import type { ExecutionCoverage, Json } from "@nyte-ai/schema";
import { assert, describe, expect, it } from "vitest";
import { driveInProcess } from "../src/drive/execution.ts";
import {
  decodeCommitRecord,
  envelope,
  headRef,
  inboxRef,
  leaseRef,
  memoryStore,
  receiptRef,
  sessionRef,
} from "../src/store.ts";
import type { StoreConnection } from "../src/index.ts";
import { completed, expireLease, main, setup, until } from "./harness.ts";

describe("execution", () => {
  it("answers busy for a lease another host holds mid-turn and fenced once this host's lease is taken", async () => {
    const store = await memoryStore().open();
    const first = await setup({ store, hostId: asId("first") });
    const second = await setup({ store, hostId: asId("second") });
    const session = await first.host.sessions.create();
    const head = { session: session.id, head: main };
    const owned = await first.host.execution.cover({ kind: "all" });

    expect(await store.refs.get(leaseRef(session.id, main))).toBeNull();

    await session.send("Go.");
    await session.send("Then this.", { delivery: "queue" });
    const running = first.host.execution.advance(head);
    const turn = await first.script.started(1);
    const busy = await second.host.execution.advance(head);

    expect(busy).toMatchObject({ kind: "busy" });
    expect(busy.kind === "busy" && busy.until > Date.now()).toBe(true);

    turn.finish();

    expect(await running).toEqual({ kind: "continue" });
    expect(await store.refs.get(leaseRef(session.id, main))).not.toBeNull();

    await store.refs.set([
      {
        name: leaseRef(session.id, main),
        target: await store.objects.put(
          envelope(
            "lease",
            { holder: "second", instance: "other", expiresAt: Date.now() + 30_000 },
            0,
          ),
        ),
      },
    ]);

    expect(await first.host.execution.advance(head)).toEqual({ kind: "fenced" });
    expect(await first.host.execution.advance(head)).toMatchObject({ kind: "busy" });

    await expireLease(store, session.id, main);
    const next = first.host.execution.advance(head);
    (await first.script.started(2)).finish();

    expect(await next).toEqual({ kind: "idle" });
    expect(await store.refs.get(leaseRef(session.id, main))).toBeNull();
    await owned.close();
  });

  it("ends a run failed when its step throws, instead of leaving it live with nothing driving it", async () => {
    const store = await memoryStore().open();
    let broken = true;

    const failing: StoreConnection = {
      ...store,
      refs: {
        ...store.refs,
        set(updates) {
          if (
            broken &&
            updates
              .flatMap((update) => update.events ?? [])
              .some((event) => event.kind === "run" && event.change === "ended")
          ) {
            broken = false;

            throw new Error("The disk is full.");
          }

          return store.refs.set(updates);
        },
      },
    };

    const { host, script } = await setup({ store: failing });
    const session = await host.sessions.create();
    const owned = await host.execution.cover({ kind: "all" });
    const receipt = await session.send("Go.");
    const step = host.execution.advance({ session: session.id, head: main });
    (await script.started(1)).finish();

    expect(await step).toEqual({ kind: "idle" });
    expect(await receipt.settled()).toEqual({
      kind: "failed",
      failure: { class: "runner", message: "The disk is full." },
    });
    await owned.close();
  });

  it("answers busy for a lease the same host holds in another instance (§42b)", async () => {
    const store = await memoryStore().open();
    const first = await setup({ store });
    const second = await setup({ store });
    const session = await first.host.sessions.create();
    const head = { session: session.id, head: main };

    expect(first.kernel.hostId).toBe(second.kernel.hostId);
    expect(first.kernel.instance).not.toBe(second.kernel.instance);

    await session.send("Go.");
    const running = first.host.execution.advance(head);
    const turn = await first.script.started(1);
    const lease = await store.refs.get(leaseRef(session.id, main));

    expect(lease?.target ? await store.objects.get(lease.target) : null).toMatchObject({
      kind: "lease",
      body: { holder: first.kernel.hostId, instance: first.kernel.instance },
    });
    expect(await second.host.execution.advance(head)).toMatchObject({ kind: "busy" });

    turn.finish();
    await running;

    expect(await second.host.execution.advance(head)).toEqual({ kind: "idle" });
  });

  it("reports continue while a steer or queue input waits, then idle", async () => {
    const { host, script } = await setup();
    const session = await host.sessions.create();
    const head = { session: session.id, head: main };
    await session.send("One.");
    await session.send("Two.", { delivery: "queue" });
    const step = host.execution.advance(head);
    (await script.started(1)).finish();

    expect(await step).toEqual({ kind: "continue" });

    const next = host.execution.advance(head);
    (await script.started(2)).finish();

    expect(await next).toEqual({ kind: "idle" });
    expect(await host.execution.advance(head)).toEqual({ kind: "idle" });
    expect(script.turns).toHaveLength(2);
  });

  it("pages through heads owed a step that no wake reached", async () => {
    const { host, script } = await setup({ execution: { kind: "admit-only" } });
    const session = await host.sessions.create();
    await host.sessions.create();
    const receipt = await session.send("Go.");

    expect((await session.view()).messages[0]).toMatchObject({
      status: { kind: "pending", covered: false },
    });
    expect(await host.execution.repair({ limit: 10 })).toEqual({
      runnable: [{ session: session.id, head: main }],
      next: null,
    });
    expect(await host.execution.repair({ limit: 1 })).toEqual({
      runnable: [{ session: session.id, head: main }],
      next: null,
    });

    const step = host.execution.advance({ session: session.id, head: main });
    (await script.started(1)).finish();
    await step;

    expect(await receipt.settled()).toEqual(completed);
    expect(await host.execution.repair({ limit: 10 })).toEqual({ runnable: [], next: null });
  });

  it("drives a queued input end to end in process", async () => {
    const { kernel, host, script } = await setup();
    const session = await host.sessions.create();
    const driver = driveInProcess(kernel, { kind: "all" });
    const first = await session.send("Go.");
    const queued = await session.send("Then this.", { delivery: "queue" });
    (await script.started(1)).finish();
    (await script.started(2)).finish();

    expect(await first.settled()).toEqual(completed);
    expect(await queued.settled()).toEqual(completed);
    expect(script.turns.map((turn) => turn.input.run.origin)).toEqual([
      { kind: "input", message: first.message },
      { kind: "input", message: queued.message },
    ]);

    await driver.close();

    expect(await kernel.store.refs.get(leaseRef(session.id, main))).toBeNull();
  });

  it("recovers only the sessions and children a sessions coverage names when its driver starts", async () => {
    const store = await memoryStore().open();
    const admitting = await setup({ store, execution: { kind: "admit-only" } });
    const session = await admitting.host.sessions.create();
    const child = await admitting.host.sessions.create({ parent: session.id });
    const other = await admitting.host.sessions.create();
    const first = await session.send("Go.");
    const report = await child.send("Child.");
    await other.send("Not here.");
    const listed: string[] = [];

    const counted: StoreConnection = {
      ...store,
      refs: {
        ...store.refs,
        list(prefix) {
          listed.push(prefix);

          return store.refs.list(prefix);
        },
      },
    };

    const coverage: ExecutionCoverage = { kind: "sessions", sessions: [session.id] };

    const { kernel, script } = await setup({
      store: counted,
      execution: { kind: "run", coverage },
    });

    const driver = driveInProcess(kernel, coverage);
    (await script.started(1)).finish();
    (await script.started(2)).finish();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(script.turns.map((turn) => turn.input.run.origin)).toEqual(
      expect.arrayContaining([
        { kind: "input", message: first.message },
        { kind: "input", message: report.message },
      ]),
    );
    expect(script.turns.some((turn) => turn.input.session === other.id)).toBe(false);
    expect(listed.filter((prefix) => prefix.startsWith(sessionRef(other.id)))).toEqual([]);

    await driver.close();
  });

  it("drives a session covered after open, its children and a child spawned under it", async () => {
    const store = await memoryStore().open();
    const admitting = await setup({ store, execution: { kind: "admit-only" } });
    const session = await admitting.host.sessions.create();
    const child = await admitting.host.sessions.create({ parent: session.id });
    const first = await session.send("Go.");
    const report = await child.send("Child.");
    const coverage: ExecutionCoverage = { kind: "sessions", sessions: [] };
    const { kernel, host, script } = await setup({ store, execution: { kind: "run", coverage } });
    const driver = driveInProcess(kernel, coverage);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(script.turns).toHaveLength(0);

    const finishing = setInterval(() => {
      for (const turn of script.turns) turn.finish();
    }, 2);

    const owned = await host.execution.cover({ kind: "sessions", sessions: [session.id] });

    const started = (): readonly string[] =>
      script.turns.flatMap((turn) =>
        turn.input.run.origin.kind === "input" ? [turn.input.run.origin.message] : [],
      );

    await until(
      () => [first.message, report.message].every((id) => started().includes(id)) || undefined,
    );

    const spawned = await host.sessions.create({ parent: session.id });

    expect(await (await spawned.send("Spawned.")).settled()).toEqual(completed);
    expect(await (await host.session(session.id).send("Again.")).settled()).toEqual(completed);

    clearInterval(finishing);
    await owned.close();
    await driver.close();
  });

  it("inspects a session's refs, objects and log, and verifies them", async () => {
    const { kernel, host, script } = await setup();
    const session = await host.sessions.create();
    const owned = await host.execution.cover({ kind: "all" });
    const receipt = await session.send("Go.");
    const step = host.execution.advance({ session: session.id, head: main });
    (await script.started(1)).finish();
    await step;
    const inspect = host.inspect(session.id);

    expect(await inspect.verify()).toEqual({ ok: true, issues: [] });
    expect((await inspect.refs()).map((ref) => ref.name)).toEqual(
      expect.arrayContaining([
        sessionRef(session.id),
        headRef(session.id, main),
        inboxRef(session.id, main),
        receiptRef(session.id, receipt.id),
      ]),
    );
    expect(await kernel.store.refs.get(leaseRef(session.id, main))).toBeNull();

    const objects = await inspect.objects();

    expect(objects.next).toBeNull();
    expect(objects.items.map((object) => object.kind)).toEqual(
      expect.arrayContaining(["session", "commit", "inbox", "receipt"]),
    );

    const kinds: string[] = [];

    for await (const event of inspect.events({ after: asSeq(0) })) kinds.push(event.kind);

    expect(kinds).toEqual([
      "session",
      "configured",
      "input",
      "run",
      "input",
      "commit",
      "run",
      "session",
    ]);

    await kernel.store.refs.set([
      { name: headRef(session.id, asId("broken")), target: asId("missing-object") },
    ]);

    expect(await inspect.verify()).toMatchObject({
      ok: false,
      issues: [{ ref: headRef(session.id, asId("broken")), object: null }],
    });
    await owned.close();
  });

  it("holds the lease of a session created after cover while its turn runs, and releases it on close", async () => {
    const { kernel, host, script } = await setup();
    const driver = driveInProcess(kernel, { kind: "all" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const session = await host.sessions.create();
    await session.send("Go.");
    await script.started(1);

    expect(await kernel.store.refs.get(leaseRef(session.id, main))).not.toBeNull();

    await driver.close();

    expect(await kernel.store.refs.get(leaseRef(session.id, main))).toBeNull();
  });

  it("releases the lease of an advance run with no coverage open", async () => {
    const { kernel, host } = await setup();
    const session = await host.sessions.create();

    expect(await host.execution.advance({ session: session.id, head: main })).toEqual({
      kind: "idle",
    });
    expect(await kernel.store.refs.get(leaseRef(session.id, main))).toBeNull();
  });

  it("reads a commit back by its id on a fresh kernel, storing nothing again", async () => {
    const store = await memoryStore().open();
    const first = await setup({ store });
    const session = await first.host.sessions.create();
    const receipt = await session.send("Go.");
    const step = first.host.execution.advance({ session: session.id, head: main });
    (await first.script.started(1)).finish();
    await step;
    const landed = await receipt.landed();
    assert(landed.kind === "landed");
    const puts: Json[] = [];

    const counted: StoreConnection = {
      ...store,
      objects: {
        ...store.objects,
        put(object) {
          puts.push(object);

          return store.objects.put(object);
        },
      },
    };

    const fresh = await setup({ store: counted });
    const side = asId<"head">("side");

    expect(decodeCommitRecord(await store.objects.get(asId(landed.commit)))).toMatchObject({
      parent: null,
      body: { kind: "user", message: receipt.message, content: "Go." },
    });
    expect((await store.refs.get(headRef(session.id, main)))?.target).toBe(landed.commit);
    expect(
      await fresh.host.session(session.id).heads.create(side, {
        from: { kind: "commit", id: landed.commit },
      }),
    ).toEqual({ kind: "created", basedOn: { kind: "commit", id: landed.commit } });
    expect((await store.refs.get(headRef(session.id, side)))?.target).toBe(landed.commit);
    expect(puts.filter((object) => decodeCommitRecord(object) !== null)).toEqual([]);

    const inspect = fresh.host.inspect(session.id);
    const object = asId<"object">(landed.commit);

    expect(await inspect.verify()).toEqual({ ok: true, issues: [] });
    expect((await inspect.objects()).items.find((view) => view.id === object)).toMatchObject({
      kind: "commit",
      parent: null,
    });
  });
});
