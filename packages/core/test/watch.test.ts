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
  SessionView,
} from "@nyte-ai/schema";
import { assert, describe, expect, it, vi } from "vitest";
import { createHostState, watchHost } from "../src/api/host.ts";
import { sessionInfo, watchSessions } from "../src/api/session.ts";
import { createKernel } from "../src/compose.ts";
import { project } from "../src/fold/project.ts";
import { watchHead } from "../src/fold/view.ts";
import { publishSet } from "../src/fold/watch.ts";
import { coalesce } from "../src/index.ts";
import { envelope, headRef, inboxRef, memoryStore, sessionRef } from "../src/store.ts";
import type { Kernel } from "../src/contract/kernel.ts";
import type { CommitRecord, SessionRecord } from "../src/store.ts";
import { fakeModels, open } from "./fake-models.ts";

const first: SessionId = asId("s1");

const second: SessionId = asId("s2");

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

function shownTip(view: SessionView): CommitId | null {
  const tip = view.heads[0]?.tip;

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

  it("leaves a watched head unread until the principal sees its tip, and never moves the mark back", async () => {
    const fake = fakeModels();
    fake.reply(
      { content: [{ type: "text", text: "First." }] },
      { content: [{ type: "text", text: "Second." }] },
    );
    await using host = await open(fake);
    const { session, receipt } = await host.sessions.start({ content: "Hi." });
    await receipt.settled();
    const views = session.watch()[Symbol.asyncIterator]();

    const shown = async (accept: (view: SessionView) => boolean): Promise<SessionView> => {
      for (;;) {
        const next = await views.next();
        assert(!next.done);

        if (accept(next.value)) return next.value;
      }
    };

    const before = await shown((view) => view.execution.kind === "idle");
    const older = shownTip(before);

    expect(before.heads[0]?.unread).toBe(true);
    await (await session.send("Again.")).settled();

    const after = await shown((view) => view.execution.kind === "idle" && shownTip(view) !== older);

    expect(after.heads[0]?.unread).toBe(true);
    await views.return?.();
    expect((await session.view()).heads[0]?.unread).toBe(true);
    expect((await session.info()).heads[0]?.unread).toBe(true);

    const tip = shownTip(after);
    assert(older !== null && tip !== null);
    await session.see(tip);

    expect((await session.view()).heads[0]?.unread).toBe(false);
    expect((await session.info()).heads[0]?.unread).toBe(false);
    expect((await sessionInfo(host.kernel, session.id, ada))?.heads[0]?.unread).toBe(true);

    await session.see(older);

    expect((await session.view()).heads[0]?.unread).toBe(false);
    expect((await session.info()).heads[0]?.unread).toBe(false);
  });

  it("shares one fold between watchers of the same session and principal", async () => {
    const kernel = await createMemoryKernel();
    await createSession(kernel, first, "triage", 1);
    await admit(kernel, first, "m1");

    const left = watchHead(kernel, { session: first, head: main, principal: ada })[
      Symbol.asyncIterator
    ]();

    const right = watchHead(kernel, { session: first, head: main, principal: ada })[
      Symbol.asyncIterator
    ]();

    const [one, two] = await Promise.all([left.next(), right.next()]);
    assert(!one.done && !two.done);

    expect(one.value).toBe(two.value);
    expect(one.value.messages.map((message) => message.id)).toEqual(["m1"]);

    const hold = kernel.folds.acquire(first, ada);
    const other = kernel.folds.acquire(first, bob);
    let notified = 0;
    hold.subscribe(() => {
      notified += 1;
    });
    await Promise.all([hold.ready(), other.ready()]);

    expect(project(hold.state(), main)).toBe(one.value);
    expect(other.state()).not.toBe(hold.state());

    await land(kernel, first, "m2", null);

    expect(notified).toBe(3);
    expect(
      hold
        .state()
        .heads.get(main)
        ?.messages.map((message) => message.id),
    ).toEqual(["m2", "m1"]);

    await Promise.all([left.return?.(), right.return?.()]);
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

  it("releases the fold within a tick when a watcher returns while a pull is pending", async () => {
    const kernel = await createMemoryKernel();
    await createSession(kernel, first, "triage", 1);
    await admit(kernel, first, "m1");
    let released = 0;

    const spied: Kernel = {
      ...kernel,
      folds: {
        ...kernel.folds,
        acquire(session, principal) {
          const hold = kernel.folds.acquire(session, principal);

          return {
            ...hold,
            release() {
              released += 1;
              hold.release();
            },
          };
        },
      },
    };

    const views = watchHead(spied, { session: first, head: main, principal: ada })[
      Symbol.asyncIterator
    ]();

    const opened = await views.next();
    assert(!opened.done);
    const pending = views.next();
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(released).toBe(0);

    const closing = views.return?.();
    await Promise.resolve();

    expect(released).toBe(1);
    expect(await pending).toEqual({ done: true, value: undefined });
    expect(await closing).toEqual({ done: true, value: undefined });
    expect(await views.next()).toEqual({ done: true, value: undefined });
    expect(released).toBe(1);
  });

  it("re-yields the directory when a session publishes", async () => {
    const kernel = await createMemoryKernel();
    await createSession(kernel, first, "first", 1);
    const directory = watchSessions(kernel, ada)[Symbol.asyncIterator]();
    const before = await directory.next();
    assert(!before.done);

    expect(before.value.map((info) => info.name)).toEqual(["first"]);

    await createSession(kernel, second, "second", 2);
    const after = await directory.next();
    assert(!after.done);

    expect(after.value.map((info) => info.name)).toEqual(["second", "first"]);
    await directory.return?.();
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
