import { asId } from "@nyte-ai/schema";
import type {
  Authority,
  CommitId,
  DurableEvent,
  HeadName,
  Json,
  PrincipalId,
  RefUpdate,
  SessionId,
  SessionInfo,
} from "@nyte-ai/schema";
import { assert, describe, expect, it, vi } from "vitest";
import { createHostState, watchHost } from "../src/api/host.ts";
import { sessionInfo } from "../src/api/session.ts";
import { createKernel } from "../src/compose.ts";
import { readView } from "../src/fold/window.ts";
import { publishSet } from "../src/fold/watch.ts";
import { coalesce } from "../src/index.ts";
import { envelope, headRef, inboxRef, memoryStore, sessionRef } from "../src/store.ts";
import type { Kernel } from "../src/contract/kernel.ts";
import type { CommitRecord, SessionRecord } from "../src/store.ts";
import { fakeModels, open } from "./fake-models.ts";

const first: SessionId = asId("s1");

const ada: PrincipalId = asId("ada");

const bob: PrincipalId = asId("bob");

const main: HeadName = asId("main");

async function createMemoryKernel(): Promise<Kernel> {
  return createKernel({
    hostId: asId("h1"),
    store: await memoryStore().open(),
    description: { name: "studio", platform: "darwin", version: "0.1.0" },
    host: createHostState({
      catalog: asId("g1"),
      plugins: [],
      settings: [],
      views: [],
      defaultWorkspace: null,
    }),
  });
}

async function write(
  kernel: Kernel,
  entries: readonly {
    readonly name: string;
    readonly object: Json;
    readonly events?: readonly DurableEvent[];
  }[],
): Promise<void> {
  const updates: readonly RefUpdate[] = await Promise.all(
    entries.map(async (entry) => ({
      name: entry.name,
      target: await kernel.store.objects.put(entry.object),
      events: entry.events,
    })),
  );

  await publishSet(kernel, updates, await kernel.store.refs.set(updates));
}

async function createSession(
  kernel: Kernel,
  id: SessionId,
  name: string,
  lastActivityAt: number,
): Promise<void> {
  const record: SessionRecord = {
    id,
    name,
    parent: null,
    origin: null,
    workspace: asId("w1"),
    pinned: false,
    archived: false,
    createdAt: 0,
    lastActivityAt,
    heads: [{ name: main, stack: null, selected: null, lastRun: null }],
    prompt: null,
  };

  await write(kernel, [
    {
      name: sessionRef(id),
      object: envelope("session", record, lastActivityAt),
      events: [
        {
          head: null,
          kind: "session",
          info: {
            ...record,
            call: null,
            activation: kernel.sessions.activation(id),
            heads: [
              {
                name: main,
                tip: { kind: "start" },
                stack: null,
                execution: { kind: "idle", lastRun: null },
                unread: false,
                background: { working: 0, waiting: 0 },
              },
            ],
          },
        },
      ],
    },
  ]);
}

async function admit(kernel: Kernel, session: SessionId, message: string): Promise<void> {
  await write(kernel, [
    {
      name: inboxRef(session, main),
      object: envelope("inbox", { messages: [message], pendingInput: [message] }, 0),
      events: [
        {
          head: main,
          kind: "input",
          message: asId(message),
          change: "admitted",
          content: message,
          source: { kind: "user" },
          delivery: "steer",
          schedule: { kind: "next-turn", reason: "idle" },
          covered: true,
          replaced: null,
        },
      ],
    },
  ]);
}

async function land(
  kernel: Kernel,
  session: SessionId,
  message: string,
  parent: CommitId | null,
): Promise<CommitId> {
  const record: CommitRecord = {
    parent,
    at: 0,
    run: null,
    body: {
      kind: "user",
      message: asId(message),
      content: message,
      source: { kind: "user" },
      delivery: "steer",
      siblings: [],
    },
  };

  const id: CommitId = asId(await kernel.store.objects.put(envelope("commit", record, 0)));
  await admit(kernel, session, message);
  await write(kernel, [
    {
      name: inboxRef(session, main),
      object: envelope("inbox", { messages: [], pendingInput: [] }, 0),
      events: [
        {
          head: main,
          kind: "input",
          message: asId(message),
          change: "landed",
          commit: id,
          run: null,
        },
      ],
    },
    {
      name: headRef(session, main),
      object: envelope("commit", record, 0),
      events: [{ head: main, kind: "commit", id, parent, run: null, body: record.body }],
    },
  ]);

  return id;
}

function shownTip(info: SessionInfo): CommitId | null {
  const tip = info.heads[0]?.tip;

  return tip?.kind === "commit" ? tip.id : null;
}

describe("watch", () => {
  it("coalesces a burst to its first and newest values, one frame apart", async () => {
    const values: number[] = [];
    const times: number[] = [];

    const burst = async function* () {
      yield 1;
      yield 2;
      yield 3;
      yield 4;
    };

    for await (const value of coalesce(burst(), 30)) {
      values.push(value);
      times.push(Date.now());
    }

    expect(values).toEqual([1, 4]);
    expect((times[1] ?? 0) - (times[0] ?? 0)).toBeGreaterThanOrEqual(25);
  });

  it("leaves a head unread until the principal sees its tip, and never moves the mark back", async () => {
    const fake = fakeModels();
    fake.reply(
      { content: [{ type: "text", text: "First." }] },
      { content: [{ type: "text", text: "Second." }] },
    );
    await using host = await open(fake);
    const { session, receipt } = await host.sessions.start({ content: "Hi." });
    await receipt.settled();
    const before = await session.info();
    const older = shownTip(before);

    expect(before.heads[0]?.unread).toBe(true);
    await (await session.send("Again.")).settled();

    const after = await session.info();
    const tip = shownTip(after);

    expect(tip).not.toBe(older);
    expect(after.heads[0]?.unread).toBe(true);
    assert(older !== null && tip !== null);
    await session.see(tip);

    expect((await session.info()).heads[0]?.unread).toBe(false);
    expect((await sessionInfo(host.kernel, session.id, ada))?.heads[0]?.unread).toBe(true);

    await session.see(older);

    expect((await session.info()).heads[0]?.unread).toBe(false);
  });

  it("sends the time of the commit the principal last saw, so a message after it reads as unseen", async () => {
    const fake = fakeModels();
    fake.reply(
      { content: [{ type: "text", text: "First." }] },
      { content: [{ type: "text", text: "Second." }] },
    );
    await using host = await open(fake);
    const { session, receipt } = await host.sessions.start({ content: "Hi." });
    await receipt.settled();
    const opened = await session.view();
    const tip = shownTip(await session.info());

    expect(opened.seenThrough).toBeNull();
    assert(tip !== null);
    await session.see(tip);

    const seen = (await session.view()).seenThrough;
    assert(seen !== null);

    expect(opened.messages.map((message) => message.at <= seen)).toEqual([true, true]);
    await new Promise((resolve) => setTimeout(resolve, 2));
    await (await session.send("Again.")).settled();
    const current = await session.view();
    const again = current.messages.at(-2);
    assert(again?.kind === "user" && again.status.kind === "landed");

    expect(current.seenThrough).toBe(seen);
    expect(current.messages.map((message) => message.at > seen)).toEqual([
      false,
      false,
      true,
      true,
    ]);

    await session.see(again.status.commit);
    const moved = await session.view();

    expect((await session.info()).heads[0]?.unread).toBe(true);
    expect(moved.seenThrough).toBeGreaterThanOrEqual(again.at);
    expect(moved.seenThrough).toBeLessThanOrEqual(current.messages.at(-1)?.at ?? 0);
  });

  it("shares one fold between holders of the same session and principal, and rebuilds it after the last leaves", async () => {
    const kernel = await createMemoryKernel();
    await createSession(kernel, first, "triage", 1);
    await admit(kernel, first, "m1");

    const hold = kernel.folds.acquire(first, ada);
    const other = kernel.folds.acquire(first, bob);
    await Promise.all([hold.ready(), other.ready()]);
    let notified = 0;
    hold.subscribe(() => {
      notified += 1;
    });

    const shared = kernel.folds.acquire(first, ada);

    expect(shared.state()).toBe(hold.state());
    shared.release();
    expect(readView(hold.state(), main).messages.map((message) => message.id)).toEqual(["m1"]);
    expect(other.state()).not.toBe(hold.state());

    await land(kernel, first, "m2", null);

    expect(notified).toBe(3);
    expect(
      hold
        .state()
        .heads.get(main)
        ?.messages.map((message) => message.id),
    ).toEqual(["m2", "m1"]);

    const kept = hold.state();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    try {
      hold.release();
      other.release();
      const reused = kernel.folds.acquire(first, ada);

      expect(reused.state()).toBe(kept);
      reused.release();
      vi.advanceTimersByTime(30_000);

      expect(kernel.folds.folding(first)).toBe(false);
    } finally {
      vi.useRealTimers();
    }

    const rebuilt = kernel.folds.acquire(first, ada);
    await rebuilt.ready();

    expect(rebuilt.state()).not.toBe(kept);
    expect(rebuilt.state().seq).toBe(kept.seq);
    expect(
      rebuilt
        .state()
        .heads.get(main)
        ?.messages.map((message) => message.id),
    ).toEqual(["m2", "m1"]);
    rebuilt.release();
  });

  it("yields the host view again when the host state updates", async () => {
    const kernel = await createMemoryKernel();
    const authority: ReadonlySet<Authority> = new Set(["participant", "owner"]);
    const host = watchHost(kernel, { principal: ada, authority })[Symbol.asyncIterator]();
    const before = await host.next();
    assert(!before.done);

    expect(before.value).toEqual({
      id: "h1",
      link: { kind: "connected" },
      name: "studio",
      operations: null,
      platform: "darwin",
      version: "0.1.0",
      catalog: "g1",
      plugins: [],
      settings: [],
      views: [],
      defaultWorkspace: null,
      authority,
    });

    kernel.host.update({ catalog: asId("g2") });
    const after = await host.next();
    assert(!after.done);

    expect(after.value.catalog).toBe("g2");
    await host.return?.();
  });
});
