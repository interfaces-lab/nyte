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
} from "@nyte-ai/schema";
import { assert, describe, expect, it } from "vitest";
import {
  coalesce,
  createHostState,
  createKernel,
  decodeSeenRecord,
  envelope,
  headRef,
  inboxRef,
  memoryStore,
  project,
  publishSet,
  seenRef,
  sessionEvents,
  sessionInfo,
  sessionRef,
  watchHead,
  watchHost,
  watchSessions,
} from "../src/index.ts";
import type { CommitRecord, Kernel, SessionRecord } from "../src/index.ts";

const first: SessionId = asId("s1");

const second: SessionId = asId("s2");

const ada: PrincipalId = asId("ada");

const bob: PrincipalId = asId("bob");

const main: HeadName = asId("main");

const configuration = {
  kind: "exact",
  model: { provider: "test", id: "model" },
  thinking: "off",
  agent: null,
  settings: {},
  settingsVersion: "1",
} as const;

async function kernelOf(): Promise<Kernel> {
  return createKernel({
    hostId: asId("h1"),
    store: await memoryStore().open(),
    description: { name: "studio", platform: "darwin", version: "0.1.0" },
    host: createHostState({ catalog: asId("g1"), plugins: [], settings: [], operations: [] }),
  });
}

async function write(
  kernel: Kernel,
  entries: readonly {
    readonly name: string;
    readonly object: Json;
    readonly event?: DurableEvent;
  }[],
): Promise<void> {
  const updates: readonly RefUpdate[] = await Promise.all(
    entries.map(async (entry) => ({
      name: entry.name,
      target: await kernel.store.objects.put(entry.object),
      event: entry.event,
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
      event: {
        head: null,
        kind: "session",
        info: {
          ...record,
          activation: kernel.activation(id),
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
    },
  ]);
}

async function admit(kernel: Kernel, session: SessionId, message: string): Promise<void> {
  await write(kernel, [
    {
      name: inboxRef(session, main),
      object: envelope("inbox", { messages: [message] }, 0),
      event: {
        head: main,
        kind: "input",
        message: asId(message),
        change: "admitted",
        content: message,
        source: { kind: "user" },
        delivery: "steer",
        schedule: { kind: "next-turn", reason: "idle" },
        covered: true,
        configuration,
        replaced: null,
      },
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

  const id: CommitId = asId(await kernel.store.objects.put(envelope("commit", record, 0, parent)));
  await admit(kernel, session, message);
  await write(kernel, [
    {
      name: inboxRef(session, main),
      object: envelope("inbox", { messages: [] }, 0),
      event: {
        head: main,
        kind: "input",
        message: asId(message),
        change: "landed",
        commit: id,
        run: null,
      },
    },
    {
      name: headRef(session, main),
      object: envelope("commit", record, 0, parent),
      event: { head: main, kind: "commit", id, parent, run: null, body: record.body },
    },
  ]);

  return id;
}

async function seenCommit(
  kernel: Kernel,
  session: SessionId,
  principal: PrincipalId,
): Promise<CommitId | null | undefined> {
  const ref = await kernel.store.refs.get(seenRef(session, principal, main));

  return ref?.target
    ? decodeSeenRecord(await kernel.store.objects.get(ref.target))?.commit
    : undefined;
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

  it("advances the principal's seen mark to each tip it yields", async () => {
    const kernel = await kernelOf();
    await createSession(kernel, first, "triage", 1);
    const c1 = await land(kernel, first, "m1", null);

    for await (const view of watchHead(kernel, { session: first, head: main, principal: ada })) {
      expect(view.heads[0]).toMatchObject({ tip: { kind: "commit", id: c1 }, unread: true });
      break;
    }

    expect(await seenCommit(kernel, first, ada)).toBe(c1);
    expect(await seenCommit(kernel, first, bob)).toBeUndefined();
    expect((await sessionInfo(kernel, first, ada))?.heads[0]?.unread).toBe(false);
    expect((await sessionInfo(kernel, first, bob))?.heads[0]?.unread).toBe(true);

    const c2 = await land(kernel, first, "m2", c1);

    for await (const view of watchHead(kernel, { session: first, head: main, principal: ada })) {
      expect(view.messages.map((message) => message.id)).toEqual(["m1", "m2"]);
      expect(view.revision).not.toBe("");
      break;
    }

    expect(await seenCommit(kernel, first, ada)).toBe(c2);
  });

  it("shares one fold between watchers of the same session and principal", async () => {
    const kernel = await kernelOf();
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
    hold.release();
    other.release();
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
    const kernel = await kernelOf();
    await createSession(kernel, first, "triage", 1);
    await admit(kernel, first, "m1");
    let released = 0;

    const spied: Kernel = {
      ...kernel,
      folds: {
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
    const kernel = await kernelOf();
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
    const kernel = await kernelOf();
    const authority: ReadonlySet<Authority> = new Set(["participant", "owner"]);
    const host = watchHost(kernel, { principal: ada, authority })[Symbol.asyncIterator]();
    const before = await host.next();
    assert(!before.done);

    expect(before.value).toEqual({
      id: "h1",
      link: { kind: "connected" },
      name: "studio",
      platform: "darwin",
      version: "0.1.0",
      catalog: "g1",
      plugins: [],
      settings: [],
      authority,
      operations: [],
    });

    kernel.host.update({ catalog: asId("g2") });
    const after = await host.next();
    assert(!after.done);

    expect(after.value.catalog).toBe("g2");
    await host.return?.();
  });

  it("resumes a session's events after a seq: the log after it, the seeds, then live", async () => {
    const kernel = await kernelOf();
    await createSession(kernel, first, "One", 1);
    const commit = await land(kernel, first, "m1", null);
    const resume = await kernel.store.refs.tail(first);
    await land(kernel, first, "m2", commit);
    kernel.setActivation(first, { kind: "active" });
    const iterator = sessionEvents(kernel, first, resume)[Symbol.asyncIterator]();
    const kinds: string[] = [];

    for (;;) {
      const next = await iterator.next();

      assert(next.done !== true);
      const event = next.value.event;
      kinds.push(event.kind === "patch" ? "patch" : `${event.kind}:${event.seq}`);

      if (event.kind === "catalog") break;
    }

    await admit(kernel, first, "m3");
    const next = await iterator.next();
    await iterator.return?.();
    const live = next.done === true ? next : { done: false, value: next.value.event };

    expect(kinds).toEqual([
      `input:${resume + 1}`,
      `input:${resume + 2}`,
      `commit:${resume + 3}`,
      "activation:0",
      "catalog:0",
    ]);
    assert(live.done !== true && live.value.kind === "input");
    expect(live.value.seq).toBe(resume + 4);
  });
});
