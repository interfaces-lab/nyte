import { asId } from "@nyte-ai/schema";
import type { CommitId, HeadName, SessionId } from "@nyte-ai/schema";
import { assert, describe, expect, it } from "vitest";
import { LOCAL, headRef, memoryStore, tree } from "../src/index.ts";
import type { Head, Host, Kernel, StoreConnection } from "../src/index.ts";
import { commit } from "../src/fold/commit.ts";
import { readRefExpectation, toCommitObjectId, put, readTip } from "../src/store/session.ts";
import { label, main, recording, setup, usage } from "./harness.ts";
import type { Script } from "./harness.ts";

const side: HeadName = asId("side");

async function exchange(
  host: Omit<Host, "listen">,
  turns: Script,
  head: Head,
  content: string,
): Promise<void> {
  await head.send(content);
  const count = turns.turns.length + 1;
  const step = host.execution.advance({ session: head.sessionId, head: head.name });
  (await turns.started(count)).finish();
  await step;
}

async function land(kernel: Kernel, session: SessionId, content: string): Promise<CommitId> {
  const tip = await readTip(kernel.store, session, main);
  const body = {
    kind: "user",
    message: asId<"message">(crypto.randomUUID()),
    content,
    source: { kind: "user" },
    delivery: "steer",
    siblings: [],
  } as const;
  const record = { parent: tip.id, at: Date.now(), run: null, body };
  const id = asId<"commit">(await put(kernel.store, "commit", record, record.at));

  const outcome = await commit(kernel, [
    {
      name: headRef(session, main),
      target: toCommitObjectId(id),
      expect: readRefExpectation(tip.ref),
      events: [{ head: main, kind: "commit", id, parent: record.parent, run: null, body }],
    },
  ]);

  assert(outcome.kind === "set");

  return id;
}

describe("heads", () => {
  it("answers a null tree revision when no pair names the folded tip, never the empty revision (ADV F 3, probe N3)", async () => {
    const raw = await memoryStore().open();
    let between: (() => Promise<unknown>) | null = null;

    const store: StoreConnection = {
      ...raw,
      refs: {
        ...raw.refs,
        async log(session, after, limit) {
          const events = await raw.refs.log(session, after, limit);
          const run = between;

          if (run !== null && events.some((event) => event.kind === "commit")) {
            between = null;
            await run();
          }

          return events;
        },
      },
    };

    const a = await setup({ store, execution: { kind: "admit-only" } });
    const b = await setup({ store: raw, execution: { kind: "admit-only" } });
    const session = await a.host.sessions.create();
    await land(a.kernel, session.id, "A");
    const hold = a.kernel.folds.acquire(session.id, LOCAL);

    try {
      await hold.ready();
      const second = await land(b.kernel, session.id, "B");
      between = () => land(b.kernel, session.id, "C");
      const view = await tree(a.kernel, session.id, main);

      expect(view.tip).toEqual({ kind: "commit", id: second });
      expect(view.revision).toBeNull();
      expect((await tree(a.kernel, session.id, asId("nowhere"))).revision).toBeNull();
    } finally {
      hold.release();
    }
  });

  it("creates, merges and removes heads with each outcome", async () => {
    const { host, script } = await setup();
    const session = await host.sessions.create();
    await exchange(host, script, session, "One.");
    const tip = (await session.info()).heads[0]?.tip;
    assert(tip !== undefined);

    expect(await session.heads.create(side)).toEqual({ kind: "created", basedOn: tip });
    expect(await session.heads.create(side)).toEqual({ kind: "exists" });
    expect(
      await session.heads.create(asId("other"), { from: { kind: "commit", id: asId("nowhere") } }),
    ).toEqual({ kind: "missing-source" });
    expect((await session.info()).heads).toMatchObject([
      { name: main, tip },
      { name: side, tip, stack: { parent: main, base: tip, stale: false } },
    ]);
    expect(await session.heads.merge(main)).toEqual({ kind: "is-main" });

    await exchange(host, script, session.head(side), "Two.");

    expect(await session.heads.merge(side, { expect: asId("an-old-revision") })).toMatchObject({
      kind: "stale",
    });
    expect(await session.heads.merge(side)).toMatchObject({ kind: "merged" });

    const merged = await session.info();

    expect(merged.heads[0]?.tip).toEqual(merged.heads[1]?.tip);
    expect((await session.view()).messages.map((message) => message.id)).toHaveLength(2);

    await exchange(host, script, session, "Three.");

    expect(await session.heads.merge(side)).toEqual({
      kind: "diverged",
      base: merged.heads[1]?.tip,
    });
    expect(await session.heads.remove(main)).toEqual({ kind: "is-main" });
    expect(await session.heads.remove(asId("nowhere"))).toEqual({ kind: "missing" });

    await session.head(side).send("Four.");
    const step = host.execution.advance({ session: session.id, head: side });
    const turn = await script.started(script.turns.length + 1);

    expect(await session.heads.remove(side)).toEqual({ kind: "busy", run: turn.input.run.id });

    turn.finish();
    await step;

    expect(await session.heads.remove(side)).toEqual({ kind: "removed" });
    expect((await session.info()).heads.map((head) => head.name)).toEqual([main]);
  });

  it("projects every branch as rows, parents first, with the head's path active", async () => {
    const { host, script } = await setup();
    const session = await host.sessions.create();
    await exchange(host, script, session, "One.");
    await exchange(host, script, session, "Two.");
    const two = (await session.view()).messages[1];
    assert(two !== undefined);
    await session.send("Two, again.", { replace: two.id });
    const step = host.execution.advance({ session: session.id, head: main });
    (await script.started(3)).finish();
    await step;

    const tree = await session.tree();
    const view = await session.view();

    expect(tree.revision).toBe(view.revision);
    expect(tree.nodes.map((node) => [node.preview, node.depth, node.branch, node.active])).toEqual([
      ["One.", 0, false, true],
      ["Two.", 1, true, false],
      ["Two, again.", 1, false, true],
    ]);
    expect(tree.nodes.map((node) => node.kind)).toEqual(["user", "user", "user"]);
    expect(tree.nodes[2]?.heads).toEqual([main]);
    expect(tree.nodes[1]?.parent).toBe(tree.nodes[0]?.id);
    expect(tree.tip).toEqual({ kind: "commit", id: tree.nodes[2]?.id });
  });

  it("moves a head: stale, busy, handback, summarize and keep", async () => {
    const summarized: (readonly CommitId[])[] = [];

    const { host, script } = await setup({
      summarize: async (input) => {
        summarized.push(input.commits);

        return { kind: "ok", markdown: "Summary.", usage };
      },
    });

    const session = await host.sessions.create();
    await exchange(host, script, session, "One.");
    await exchange(host, script, session, "Two.");
    const before = await session.tree();
    const [one, two] = before.nodes;
    assert(one !== undefined && two !== undefined);

    const stale = await session.move({ kind: "start" }, { expect: asId("an-old-revision") });

    expect(await stale.settled()).toEqual({ kind: "stale", revision: before.revision });

    const handback = await session.move({ kind: "commit", id: two.id });

    expect(await handback.settled()).toMatchObject({
      kind: "moved",
      position: { kind: "commit", id: one.id },
      summary: null,
      handback: "Two.",
    });
    expect(
      (await session.view()).messages.map((message) => message.kind === "user" && message.content),
    ).toEqual(["One."]);

    const summary = await (
      await session.move({ kind: "start" }, { abandoned: { summarize: {} } })
    ).settled();

    assert(summary.kind === "moved");

    expect(summarized).toEqual([[one.id]]);
    expect(summary.summary).not.toBeNull();
    expect((await session.view()).messages).toMatchObject([
      {
        id: summary.summary,
        kind: "part",
        partKind: "branchSummary",
        role: "note",
        state: { markdown: "Summary." },
        status: { kind: "settled" },
      },
    ]);
    expect((await session.tree()).nodes.find((node) => node.active)).toMatchObject({
      kind: "branchSummary",
      preview: "Summary.",
    });

    const keep = await (await session.move({ kind: "start" })).settled();

    expect(keep).toEqual({
      kind: "moved",
      revision: "",
      position: { kind: "start" },
      summary: null,
      handback: null,
    });
    expect((await session.view()).messages).toEqual([]);

    await session.send("Busy.");
    const step = host.execution.advance({ session: session.id, head: main });
    const turn = await script.started(script.turns.length + 1);

    expect(await (await session.move({ kind: "start" })).settled()).toEqual({
      kind: "busy",
      run: turn.input.run.id,
    });

    turn.finish();
    await step;
  });

  it("moves with `running: stop` in one set, the fence then the head move, without waiting", async () => {
    const recorder = recording(await memoryStore().open());
    const { kernel, host, script } = await setup({ store: recorder.store });
    const session = await host.sessions.create();
    await session.send("One.");
    const step = host.execution.advance({ session: session.id, head: main });
    const turn = await script.started(1);
    const before = await kernel.store.refs.tail(session.id);
    const from = recorder.sets.length;
    const moved = await (await session.move({ kind: "start" }, { running: "stop" })).settled();

    expect(moved).toMatchObject({ kind: "moved", position: { kind: "start" } });
    expect(recorder.sets[from]).toEqual(["run:stopping", "head:moved"]);
    expect((await kernel.store.refs.log(session.id, before, 100)).map(label).slice(0, 2)).toEqual([
      "run:stopping",
      "head:moved",
    ]);
    expect(turn.input.signal.aborted).toBe(true);
    expect(await session.run(turn.input.run.id).settled()).toEqual({ kind: "stopped" });
    await step;
  });
});
