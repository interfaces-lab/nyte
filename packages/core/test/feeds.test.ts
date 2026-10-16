import { asId, asSeq } from "@nyte-ai/schema";
import type { SessionId } from "@nyte-ai/schema";
import { describe, expect, it } from "vitest";
import {
  LOCAL,
  emptyFold,
  fold,
  project,
  decodeCommitRecord,
  decodePartRecord,
  decodeRunRecord,
  envelope,
  headRef,
  landing,
  memoryStore,
  partRef,
  pollStore,
  publishPatch,
  sessionEvents,
  sessionRef,
  tree,
} from "../src/index.ts";
import type { Kernel, StoreConnection } from "../src/index.ts";
import { commit, put, readTip } from "../src/session-state.ts";
import { configuration, livePart, main, setup, usage } from "./harness.ts";

async function history(store: StoreConnection) {
  const { kernel, host } = await setup({ store });
  const session = await host.sessions.create();
  const after = await store.refs.tail(session.id);
  const ref = await store.refs.get(sessionRef(session.id));

  if (ref?.target === null || ref === null) throw new Error("The session was not created.");

  await store.refs.set(
    Array.from({ length: 600 }, (_, index) => ({
      name: ref.name,
      target: ref.target,
      event: {
        head: main,
        kind: "request" as const,
        step: "assistant" as const,
        usage,
        context: { tokens: index + 1, window: 1000, lastRequest: null },
      },
    })),
  );

  return { kernel, host, session, after };
}

describe("session event demand", () => {
  it("coalesces queued deltas, resumes large text from current state, and discards replaced text", async () => {
    const { kernel, host } = await setup();
    const session = await host.sessions.create();
    const run = asId<"run">("live-run");
    const part = asId<"part">("live-part");
    await livePart(kernel, session.id, run, part, "A");
    const events = sessionEvents(kernel, session.id, asSeq(0))[Symbol.asyncIterator]();

    for (;;) {
      const next = await events.next();

      if (next.done) throw new Error("The stream ended before its live text.");

      if (next.value.event.kind !== "patch") continue;
      expect(next.value.event).toEqual({ kind: "patch", part, markdown: "A" });
      break;
    }

    publishPatch(kernel, session.id, run, { kind: "patch", part, append: "B" });
    publishPatch(kernel, session.id, run, { kind: "patch", part, append: "C" });
    expect((await events.next()).value?.event).toEqual({ kind: "patch", part, append: "BC" });

    for (let index = 0; index < 100; index += 1)
      publishPatch(kernel, session.id, run, { kind: "patch", part, append: "x".repeat(200) });

    expect((await events.next()).value?.event).toEqual({
      kind: "patch",
      part,
      markdown: `ABC${"x".repeat(20_000)}`,
    });
    publishPatch(kernel, session.id, run, { kind: "patch", part, append: "D" });
    expect((await events.next()).value?.event).toEqual({ kind: "patch", part, append: "D" });
    publishPatch(kernel, session.id, run, { kind: "patch", part, append: "Discard this." });
    const ref = await kernel.store.refs.get(partRef(session.id, part));

    const record =
      ref?.target === null || ref === null
        ? null
        : decodePartRecord(await kernel.store.objects.get(ref.target));

    if (record === null || ref === null) throw new Error("The live part was not stored.");
    const state = { markdown: "Replaced", signature: null };

    await commit(kernel, [
      {
        name: ref.name,
        target: await put(kernel, "part", { ...record, state, version: 2 }),
        event: { head: main, kind: "part", part, change: "updated", state, version: 2 },
      },
    ]);

    publishPatch(kernel, session.id, run, { kind: "patch", part, append: "." });
    expect((await events.next()).value?.event).toMatchObject({ kind: "part", change: "updated" });
    expect((await events.next()).value?.event).toEqual({ kind: "patch", part, append: "." });
    expect((await session.view()).messages.at(-1)).toMatchObject({
      kind: "part",
      state: { markdown: "Replaced." },
    });
    await events.return?.();
    await host.close();
  });

  it("reads bounded history on demand and delivers a concurrent commit once in order", async () => {
    const base = await memoryStore().open();
    let read = 0;

    const store: StoreConnection = {
      ...base,
      refs: {
        ...base.refs,
        async log(session, after, limit) {
          const events = await base.refs.log(session, after, limit);
          read += events.length;

          return events;
        },
      },
    };

    const { kernel, host, session, after } = await history(store);
    const events = sessionEvents(kernel, session.id, after)[Symbol.asyncIterator]();
    read = 0;
    const first = await events.next();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(first.value?.event).toMatchObject({ kind: "request", context: { tokens: 1 } });
    expect(read).toBeLessThan(600);

    await session.update({ name: "During replay" });
    const tokens: number[] = [1];
    const names: (string | null)[] = [];

    for (;;) {
      const next = await events.next();

      if (next.done) throw new Error("The stream ended during replay.");
      const event = next.value.event;

      if (event.kind === "request") tokens.push(event.context.tokens);

      if (event.kind === "session") names.push(event.info.name);

      if (event.kind === "catalog") break;
    }

    expect(tokens).toEqual(Array.from({ length: 600 }, (_, index) => index + 1));
    expect(names).toEqual(["During replay"]);
    await events.return?.();
    await host.close();
  });

  it("cancels an in-flight history read without reading or delivering the remaining pages", async () => {
    const base = await memoryStore().open();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let blocking = false;
    let reads = 0;

    const store: StoreConnection = {
      ...base,
      refs: {
        ...base.refs,
        async log(session, after, limit) {
          if (blocking) {
            reads += 1;
            entered.resolve();
            await release.promise;
          }

          return base.refs.log(session, after, limit);
        },
      },
    };

    const { kernel, host, session, after } = await history(store);
    const events = sessionEvents(kernel, session.id, after)[Symbol.asyncIterator]();
    blocking = true;
    const pending = events.next();
    await entered.promise;
    expect(await events.return?.()).toEqual({ done: true, value: undefined });
    release.resolve();
    expect(await pending).toEqual({ done: true, value: undefined });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reads).toBe(1);
    expect(await events.next()).toEqual({ done: true, value: undefined });
    await host.close();
  });
});

async function land(kernel: Kernel, session: SessionId, text: string): Promise<void> {
  const tip = await readTip(kernel, session, main);
  const body = {
    kind: "user",
    message: asId<"message">(crypto.randomUUID()),
    content: text,
    source: { kind: "user" },
    delivery: "steer",
    siblings: [],
  } as const;

  const record = { parent: tip.id, at: Date.now(), run: null, body };
  const id = asId<"commit">(await put(kernel, "commit", record, record.at));

  await commit(kernel, [
    {
      name: headRef(session, main),
      target: asId<"object">(id),
      expect: tip.ref?.revision ?? "absent",
      event: { head: main, kind: "commit", id, parent: record.parent, run: null, body },
    },
  ]);
}

describe("the store is the truth", () => {
  it("shows a polling kernel the head revision the store holds after another instance's commits reach it through its own write, and lands both inputs (ADV A F2)", async () => {
    const store = await memoryStore().open();
    const a = await setup({ store, poll: 10, execution: { kind: "admit-only" } });
    const b = await setup({ store, execution: { kind: "admit-only" } });
    const session = await a.host.sessions.create();
    const watched = a.host.session(session.id).head(main).watch()[Symbol.asyncIterator]();
    await watched.next();

    await a.host.session(session.id).send("From A.");
    const first = a.host.execution.advance({ session: session.id, head: main });
    (await a.script.started(1)).finish();
    await first;

    await b.host.session(session.id).send("From B.");
    const second = b.host.execution.advance({ session: session.id, head: main });
    (await b.script.started(1)).finish();
    await second;

    await a.host.session(session.id).heads.create(asId("side"));
    const unpoll = pollStore(a.kernel);
    await new Promise((resolve) => setTimeout(resolve, 40));
    const view = await a.host.session(session.id).head(main).view();
    const stored = await store.refs.get(headRef(session.id, main));

    expect(
      view.messages.flatMap((message) => (message.kind === "user" ? [message.content] : [])),
    ).toEqual(["From A.", "From B."]);
    expect(view.revision).toBe(stored?.revision);
    unpoll();
    await watched.return?.();
  });

  it("lands the content another instance revised while this kernel held its fold (ADV A F4)", async () => {
    const store = await memoryStore().open();
    const a = await setup({ store, execution: { kind: "admit-only" } });
    const b = await setup({ store, execution: { kind: "admit-only" } });
    const session = await b.host.sessions.create();
    const hold = b.kernel.folds.acquire(session.id, LOCAL);
    await hold.ready();

    const original = await b.host.session(session.id).send("Steer.");
    await a.host.session(session.id).send("Steer v2.", { replace: original.message });
    await landing(b.kernel, session.id, main, [original.message], null);
    hold.release();

    const tip = await readTip(b.kernel, session.id, main);

    expect(tip.commit?.body).toMatchObject({ kind: "user", content: "Steer v2." });
  });

  it("shows the empty revision once a move to the start deletes the head ref (ADV F F3)", async () => {
    const { kernel, host, script } = await setup();
    const session = await host.sessions.create();
    await session.send("Base.");
    const step = host.execution.advance({ session: session.id, head: main });
    (await script.started(1)).finish();
    await step;
    const hold = kernel.folds.acquire(session.id, LOCAL);
    await hold.ready();

    expect((await session.view()).revision).not.toBe("");
    expect((await (await session.move({ kind: "start" })).settled()).kind).toBe("moved");
    expect(await kernel.store.refs.get(headRef(session.id, main))).toBeNull();
    expect((await session.view()).revision).toBe("");
    hold.release();
  });

  it("derives a tree's tip and revision from one state of the head (ADV F F5)", async () => {
    const shared = await memoryStore().open();
    let armed = false;
    let between = async (): Promise<void> => undefined;

    const store: StoreConnection = {
      ...shared,
      refs: {
        ...shared.refs,
        async get(name) {
          const before = await shared.refs.get(name);

          if (armed && name.endsWith("/heads/main")) {
            armed = false;
            await between();
          }

          return before;
        },
      },
    };

    const a = await setup({ store, execution: { kind: "admit-only" } });
    const b = await setup({ store: shared, execution: { kind: "admit-only" } });
    const session = await a.host.sessions.create();
    await land(a.kernel, session.id, "Old tip.");
    const old = await shared.refs.get(headRef(session.id, main));
    between = () => land(b.kernel, session.id, "New tip.");
    armed = true;

    const view = await tree(a.kernel, session.id, main);
    const stored = await shared.refs.get(headRef(session.id, main));
    const tip = view.tip.kind === "commit" ? asId<"object">(view.tip.id) : null;

    expect(stored?.target).not.toBe(old?.target);
    expect(tip === stored?.target ? stored?.revision : old?.revision).toBe(view.revision);
    expect([old?.target, stored?.target]).toContain(tip);
  });

  it("folds a commit with the revision its own write was given, with no later ref read (AUDIT-D1 delayed read)", async () => {
    const shared = await memoryStore().open();
    const release = Promise.withResolvers<void>();
    let armed = false;
    let gate = false;

    const store: StoreConnection = {
      ...shared,
      refs: {
        ...shared.refs,
        async set(updates) {
          const outcome = await shared.refs.set(updates);

          if (armed && updates.some((update) => update.event?.kind === "commit")) gate = true;

          return outcome;
        },
        async get(name) {
          if (gate && name.endsWith("/heads/main")) await release.promise;

          return shared.refs.get(name);
        },
      },
    };

    const { kernel, host } = await setup({ store, execution: { kind: "admit-only" } });
    const session = await host.sessions.create();
    await land(kernel, session.id, "Old.");
    const watched = session.watch()[Symbol.asyncIterator]();
    await watched.next();
    armed = true;
    await land(kernel, session.id, "New.");
    const stored = await shared.refs.get(headRef(session.id, main));
    let shown = await watched.next();

    while (
      shown.done !== true &&
      (shown.value.heads[0]?.tip.kind !== "commit" ||
        asId<"object">(shown.value.heads[0].tip.id) !== stored?.target)
    )
      shown = await watched.next();

    expect(shown.done !== true && shown.value.revision).toBe(stored?.revision);
    release.resolve();
    expect(
      shown.done !== true &&
        (
          await (
            await session.move({ kind: "start" }, { expect: shown.value.revision ?? undefined })
          ).settled()
        ).kind,
    ).toBe("moved");
    await watched.return?.();
  });

  it("rejects a stored record whose shape its type forbids (§54d)", () => {
    const run = {
      view: {
        id: "r1",
        head: "main",
        startedAt: 0,
        attempt: 1,
        configuration,
        origin: { kind: "continuation", from: "wake" },
      },
      phase: "responding",
      stopping: false,
      waiting: null,
      retrying: null,
      snapshot: null,
      lastSnapshot: null,
      usage: null,
      requests: 0,
      waitedBy: [],
      parked: [],
    };

    expect(decodeRunRecord(envelope("run", run, 0))).toEqual(run);
    expect(decodeRunRecord(envelope("run", { ...run, phase: "bogus" }, 0))).toBeNull();
    expect(
      decodeCommitRecord(
        envelope("commit", { parent: null, at: 0, run: null, body: { kind: "bogus" } }, 0),
      ),
    ).toBeNull();
  });

  it("shows a repeated durable event as a falling view seq, what the bench's reconnect check catches (§54e, §54g)", () => {
    const request = (seq: number, tokens: number) =>
      ({
        seq: asSeq(seq),
        at: 0,
        head: main,
        kind: "request",
        usage,
        context: { tokens, window: 1000, lastRequest: null },
        step: "assistant",
      }) as const;

    let state = emptyFold({ session: asId("s1"), principal: LOCAL });
    const seqs: number[] = [];

    for (const event of [request(4, 100), request(5, 200), request(4, 100)]) {
      state = fold(state, event);
      seqs.push(project(state, main).seq);
    }

    expect(seqs).toEqual([4, 5, 4]);
    expect(seqs.every((seq, index) => index === 0 || seq >= seqs[index - 1])).toBe(false);
  });
});
