import { asId, isJsonObject } from "@nyte-ai/schema";
import type { Json } from "@nyte-ai/schema";
import { expect, it } from "vitest";
import { owedCalls, readToolInput } from "../src/agent/tool-runner.ts";
import type { Kernel } from "../src/contract/kernel.ts";
import { decodeCallRecord } from "../src/contract/records.ts";
import { intendedCall, runStep } from "../src/engine/durable.ts";
import { createHookDispatch } from "../src/extend/hooks.ts";
import { migrateStore } from "../src/store.ts";
import type { StoredRecord } from "../src/store.ts";
import type { StoreChange } from "../src/store/migrations.ts";
import { callRef, endedRunRef, liveRef, partRef, runRef, sessionRef } from "../src/store/refs.ts";
import { wokenIndex } from "../src/store/wait-index.ts";
import { configuration, main, setup, startRun } from "../src/harness.ts";

it("gives an older store's unstopped runs their live ref and its parked calls their wait index", async () => {
  const { kernel, host } = await setup();
  const { session } = await host.sessions.start({ content: "Hi." });

  const run = await startRun(
    kernel,
    session.id,
    main,
    { kind: "continuation", from: "wake" },
    configuration,
  );

  await runStep<Json>(kernel, {
    session: session.id,
    head: main,
    run: null,
    call: asId("c1"),
    kind: "hook",
    replay: "safe",
    intent: { test: true },
    part: null,
    signal: new AbortController().signal,
    body: async (durable) => durable.wait({ kind: "timer", until: Date.now() + 60_000 }),
    settle: async () => ({ result: null, updates: [] }),
    decode: (result) => result,
  });

  const live = liveRef(session.id, run.id);
  const index = (await kernel.store.refs.list("waits/")).map((ref) => ref.name);
  const records: StoredRecord[] = [];

  for (const ref of await kernel.store.refs.list("sessions/"))
    if (ref.target !== null && ref.name !== live)
      records.push({
        name: ref.name,
        target: ref.target,
        revision: ref.revision,
        body: JSON.stringify(await kernel.store.objects.get(ref.target)),
      });

  const created: string[] = [];
  const moved: string[] = [];

  await migrateStore({
    dialect: "sqlite",
    stamp: async () => ({ version: 8, empty: false }),
    records: async () => records,
    logs: async function* () {},
    objects: async function* () {},
    commit: async (change) => {
      created.push(...change.creates.map((creation) => creation.name));
      moved.push(...change.repoints.map((repoint) => repoint.name));

      return "committed";
    },
  });

  expect(index).toHaveLength(1);
  expect(moved).toEqual([]);
  expect(created.toSorted()).toEqual([live, ...index].toSorted());
});

/** Every record under `sessions/` as the migration reads it. */
async function storedRecords(kernel: Kernel): Promise<StoredRecord[]> {
  const records: StoredRecord[] = [];

  for (const ref of await kernel.store.refs.list("sessions/"))
    if (ref.target !== null)
      records.push({
        name: ref.name,
        target: ref.target,
        revision: ref.revision,
        body: JSON.stringify(await kernel.store.objects.get(ref.target)),
      });

  return records;
}

/** Lands a migration's repoints in the kernel's store, as a store's own commit does. */
async function landChange(kernel: Kernel, change: StoreChange): Promise<"committed"> {
  for (const repoint of change.repoints) {
    const id = await kernel.store.objects.put(JSON.parse(repoint.body));

    expect(id).toBe(repoint.id);
    await kernel.store.refs.set([
      { name: repoint.name, target: id, expect: asId<"revision">(repoint.expect) },
    ]);
  }

  return "committed";
}

it("keeps an older store's ended runs' last snapshot records under their ended refs", async () => {
  const { kernel, host } = await setup();
  const session = await host.sessions.create();

  const run = await startRun(
    kernel,
    session.id,
    main,
    { kind: "continuation", from: "wake" },
    configuration,
  );

  const live = await kernel.store.refs.get(runRef(session.id, run.id));
  const stored = live?.target ? await kernel.store.objects.get(live.target) : null;

  if (!isJsonObject(stored) || !isJsonObject(stored.body))
    throw new Error("The run has no record.");
  const record = { ...stored, body: { ...stored.body, snapshot: "git:before" } };
  const first = { ...record, at: 1, body: { ...record.body, lastSnapshot: null } };
  const last = { ...record, at: 5, body: { ...record.body, lastSnapshot: "git:after" } };
  const [firstId, lastId] = [
    await kernel.store.objects.put(first),
    await kernel.store.objects.put(last),
  ];
  const sessionRecord = await kernel.store.refs.get(sessionRef(session.id));
  const created: StoreChange["creates"][number][] = [];

  await migrateStore({
    dialect: "sqlite",
    stamp: async () => ({ version: 14, empty: false }),
    records: async () => [
      {
        name: sessionRef(session.id),
        target: sessionRecord?.target ?? asId("missing"),
        revision: sessionRecord?.revision ?? "r",
        body: "{}",
      },
    ],
    logs: async function* () {
      yield {
        session: session.id,
        events: [
          {
            seq: 1,
            event: JSON.stringify({
              head: main,
              kind: "run",
              run: run.id,
              change: "ended",
              end: { kind: "stopped" },
            }),
          },
        ],
      };
    },
    objects: async function* () {
      yield { id: firstId, body: JSON.stringify(first) };
      yield { id: lastId, body: JSON.stringify(last) };
    },
    commit: async (change) => {
      created.push(...change.creates);

      return "committed";
    },
  });

  expect(created).toEqual([{ name: endedRunRef(session.id, run.id), target: lastId }]);
});

it("moves a tool call's name and args to its part alone, which recovery then replays", async () => {
  const { kernel, host } = await setup();
  const { session } = await host.sessions.start({ content: "Hi." });

  const run = await startRun(
    kernel,
    session.id,
    main,
    { kind: "continuation", from: "wake" },
    configuration,
  );

  const call = asId<"call">(`${run.id}:7:toolu_01`);
  const args = { command: "sed -n 100,112p open.ts", description: "Read the wiring" };
  const intent = { name: "bash", args, principal: "local" };

  const callBody = {
    id: call,
    kind: "tool",
    run: run.id,
    head: "main",
    part: call,
    intent,
    memos: {},
    clock: [],
    waits: [],
    waiting: null,
    partial: [],
    nested: {},
    acquisitions: {},
    result: null,
    replay: "never",
    reran: null,
  };

  const partBody = {
    id: call,
    partKind: "tool",
    placement: { kind: "transcript", role: "step" },
    state: {
      call,
      name: "bash",
      args,
      class: { kind: "shell", command: args.command, description: args.description },
      phase: "running",
      progress: null,
    },
    version: 2,
    owner: null,
    run: run.id,
    status: { kind: "live", run: run.id },
  };

  for (const [name, kind, body] of [
    [callRef(session.id, call), "call", callBody],
    [partRef(session.id, asId<"part">(call)), "part", partBody],
  ] as const) {
    const target = await kernel.store.objects.put({ kind, parent: null, at: 1, body });

    await kernel.store.refs.set([{ name, target, expect: "absent" }]);
  }

  await migrateStore({
    dialect: "sqlite",
    stamp: async () => ({ version: 10, empty: false }),
    records: async () => storedRecords(kernel),
    logs: async function* () {},
    objects: async function* () {},
    commit: async (change) => landChange(kernel, change),
  });

  const ref = await kernel.store.refs.get(callRef(session.id, call));

  const migrated = decodeCallRecord(
    ref?.target ? await kernel.store.objects.get(ref.target) : null,
  );

  expect(migrated).toEqual({ ...callBody, intent: { principal: "local" } });
  const owed = await owedCalls(kernel.store, session.id, run.id);

  expect(owed.map(({ record, parked }) => ({ call: record.id, parked }))).toEqual([
    { call, parked: false },
  ]);
  expect(
    await Promise.all(owed.map(({ record }) => readToolInput(kernel.store, session.id, record))),
  ).toEqual([intent]);
});

it("gives an older Nyte's unopened tool call position 0, so recovery still owes it", async () => {
  const { kernel, host } = await setup();
  const { session } = await host.sessions.start({ content: "Hi." });

  const run = await startRun(
    kernel,
    session.id,
    main,
    { kind: "continuation", from: "wake" },
    configuration,
  );

  const call = asId<"call">(`${run.id}:1:toolu_01`);
  const intent = { name: "bash", args: { command: "ls" }, principal: "local" };

  const target = await kernel.store.objects.put({
    kind: "call",
    parent: null,
    at: 1,
    body: { ...intendedCall({ call, run: run.id, head: main, intent: {} }), intent },
  });

  await kernel.store.refs.set([{ name: callRef(session.id, call), target, expect: "absent" }]);
  expect(await owedCalls(kernel.store, session.id, run.id)).toEqual([]);

  await migrateStore({
    dialect: "sqlite",
    stamp: async () => ({ version: 11, empty: false }),
    records: async () => storedRecords(kernel),
    logs: async function* () {},
    objects: async function* () {},
    commit: async (change) => landChange(kernel, change),
  });

  const owed = await owedCalls(kernel.store, session.id, run.id);

  expect(owed.map(({ record, parked }) => ({ call: record.id, parked }))).toEqual([
    { call, parked: false },
  ]);
  expect(
    await Promise.all(owed.map(({ record }) => readToolInput(kernel.store, session.id, record))),
  ).toEqual([intent]);
});

it("indexes as woken a call an older Nyte woke and had not stepped since", async () => {
  const { kernel, host } = await setup();
  const { session } = await host.sessions.start({ content: "Hi." });
  const soon = Date.now() + 1;

  for (const call of ["woken", "parked"])
    await runStep<Json>(kernel, {
      session: session.id,
      head: main,
      run: null,
      call: asId(call),
      kind: "hook",
      replay: "safe",
      intent: { test: true },
      part: null,
      signal: new AbortController().signal,
      body: async (durable) =>
        durable.wait({ kind: "timer", until: call === "woken" ? soon : soon + 60_000 }),
      settle: async () => ({ result: null, updates: [] }),
      decode: (result) => result,
    });

  await kernel.waits.tick(soon + 1);
  const woken = wokenIndex(session.id, asId("woken"));
  await kernel.store.refs.set([{ name: woken, target: null }]);
  const created: string[] = [];

  await migrateStore({
    dialect: "sqlite",
    stamp: async () => ({ version: 12, empty: false }),
    records: async () => storedRecords(kernel),
    logs: async function* () {},
    objects: async function* () {},
    commit: async (change) => {
      created.push(...change.creates.map((creation) => creation.name));

      return "committed";
    },
  });

  expect(created).toEqual([woken]);
});

it("keeps a before_tool hook call's modify result its old decoder could not read as it was", async () => {
  const { kernel, host } = await setup();
  const session = await host.sessions.create();
  const call = asId<"call">("hook:before_tool:toolu_02");
  const unreadable = { action: "modify", value: { other: 1 } };

  const target = await kernel.store.objects.put({
    kind: "call",
    parent: null,
    at: 1,
    body: {
      ...intendedCall({ call, run: asId("r1"), head: main, intent: {} }),
      kind: "hook",
      intent: { principal: "local", args: {} },
      result: unreadable,
    },
  });

  await kernel.store.refs.set([{ name: callRef(session.id, call), target, expect: "absent" }]);

  await migrateStore({
    dialect: "sqlite",
    stamp: async () => ({ version: 13, empty: false }),
    records: async () => storedRecords(kernel),
    logs: async function* () {},
    objects: async function* () {},
    commit: async (change) => landChange(kernel, change),
  });

  const ref = await kernel.store.refs.get(callRef(session.id, call));
  const migrated = decodeCallRecord(
    ref?.target ? await kernel.store.objects.get(ref.target) : null,
  );

  expect(migrated?.intent).toEqual({ principal: "local" });
  expect(migrated?.result).toEqual(unreadable);
});

it("keeps a before_tool hook call's principal and changed args alone, which its replay still reads", async () => {
  const { kernel, host } = await setup();
  const { session } = await host.sessions.start({ content: "Hi." });
  const call = asId<"call">("hook:before_tool:toolu_01");
  const proposed = {
    call: asId<"call">("toolu_01"),
    name: "bash",
    args: { command: "rm -rf build" },
    class: { kind: "shell", command: "rm -rf build" },
  } as const;
  const changed = { command: "rm -rf build/cache" };

  const target = await kernel.store.objects.put({
    kind: "call",
    parent: null,
    at: 1,
    body: {
      ...intendedCall({ call, run: asId("r1"), head: main, intent: {} }),
      kind: "hook",
      intent: { ...proposed, principal: "local" },
      result: { action: "modify", value: { ...proposed, args: changed } },
    },
  });

  await kernel.store.refs.set([{ name: callRef(session.id, call), target, expect: "absent" }]);

  await migrateStore({
    dialect: "sqlite",
    stamp: async () => ({ version: 13, empty: false }),
    records: async () => storedRecords(kernel),
    logs: async function* () {},
    objects: async function* () {},
    commit: async (change) => landChange(kernel, change),
  });

  const ref = await kernel.store.refs.get(callRef(session.id, call));
  const migrated = decodeCallRecord(
    ref?.target ? await kernel.store.objects.get(ref.target) : null,
  );

  expect(migrated?.intent).toEqual({ principal: "local" });
  expect(migrated?.result).toEqual({ action: "modify", value: changed });

  const replayed = await createHookDispatch(kernel, session.id).decide(
    "before_tool",
    proposed,
    { session: session.id, head: main, run: null, principal: asId("local") },
    { call, run: asId("r1"), head: main, part: null, signal: new AbortController().signal },
  );

  expect(replayed).toEqual({
    kind: "done",
    value: { action: "modify", value: { ...proposed, args: changed } },
  });
});
