import { asId, asSeq } from "@nyte-ai/schema";
import type { SessionId } from "@nyte-ai/schema";
import { describe, expect, it } from "vitest";
import {
  LOCAL,
  emptyFold,
  fold,
  project,
  decodeCommitRecord,
  decodeRunRecord,
  envelope,
  headRef,
  landing,
  memoryStore,
  pollStore,
  tree,
} from "../src/index.ts";
import type { Kernel, StoreConnection } from "../src/index.ts";
import { commit } from "../src/fold/commit.ts";
import { put, readTip } from "../src/store/session.ts";
import { configuration, main, setup, usage } from "./harness.ts";

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
      events: [{ head: main, kind: "commit", id, parent: record.parent, run: null, body }],
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

          if (
            armed &&
            updates
              .flatMap((update) => update.events ?? [])
              .some((event) => event.kind === "commit")
          )
            gate = true;

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
