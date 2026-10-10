import { asId, asSeq } from "@nyte-ai/schema";
import type { Json } from "@nyte-ai/schema";
import { assert, describe, expect, it } from "vitest";
import {
  decodeCommitRecord,
  driveInProcess,
  envelope,
  headRef,
  inboxRef,
  leaseRef,
  memoryStore,
  receiptRef,
  sessionRef,
} from "../src/index.ts";
import type { StoreConnection } from "../src/index.ts";
import { completed, main, setup } from "./harness.ts";

describe("execution", () => {
  it("answers busy for another host's lease and fenced once this host's lease is taken", async () => {
    const store = await memoryStore().open();
    const first = await setup({ store, hostId: asId("first") });
    const second = await setup({ store, hostId: asId("second") });
    const session = await first.host.sessions.create();
    const head = { session: session.id, head: main };
    const owned = await first.host.execution.cover({ kind: "all" });
    const busy = await second.host.execution.advance(head);

    expect(busy).toMatchObject({ kind: "busy" });
    expect(busy.kind === "busy" && busy.until > Date.now()).toBe(true);
    expect(await first.host.execution.advance(head)).toEqual({ kind: "idle" });

    await store.refs.set([
      {
        name: leaseRef(session.id, main),
        target: await store.objects.put(
          envelope("lease", { holder: "second", expiresAt: Date.now() + 30_000 }, 0),
        ),
      },
    ]);

    expect(await first.host.execution.advance(head)).toEqual({ kind: "fenced" });
    expect(await first.host.execution.advance(head)).toMatchObject({ kind: "busy" });

    await store.refs.set([
      {
        name: leaseRef(session.id, main),
        target: await store.objects.put(
          envelope("lease", { holder: "second", expiresAt: Date.now() - 1 }, 0),
        ),
      },
    ]);

    expect(await first.host.execution.advance(head)).toEqual({ kind: "idle" });
    await owned.close();

    expect(await store.refs.get(leaseRef(session.id, main))).toBeNull();
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
    expect((await host.execution.repair({ limit: 1 })).next).not.toBeNull();

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
        leaseRef(session.id, main),
      ]),
    );

    const objects = await inspect.objects();

    expect(objects.next).toBeNull();
    expect(objects.items.map((object) => object.kind)).toEqual(
      expect.arrayContaining(["session", "commit", "inbox", "receipt", "lease"]),
    );

    const kinds: string[] = [];

    for await (const event of inspect.events({ after: asSeq(0) })) kinds.push(event.kind);

    expect(kinds).toEqual(["session", "input", "run", "input", "commit", "run", "session"]);

    await kernel.store.refs.set([
      { name: headRef(session.id, asId("broken")), target: asId("missing-object") },
    ]);

    expect(await inspect.verify()).toMatchObject({
      ok: false,
      issues: [{ ref: headRef(session.id, asId("broken")), object: null }],
    });
    await owned.close();
  });

  it("releases on close the lease advance took for a session created after cover", async () => {
    const { kernel, host, script } = await setup();
    const driver = driveInProcess(kernel, { kind: "all" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const session = await host.sessions.create();
    const receipt = await session.send("Go.");
    (await script.started(1)).finish();

    expect(await receipt.settled()).toEqual(completed);
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
