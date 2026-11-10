import { asId } from "@nyte-ai/schema";
import { expect, it } from "vitest";
import { owedCalls, readToolInput } from "../src/agent/tool-runner.ts";
import type { Kernel } from "../src/contract/kernel.ts";
import { decodeCallRecord } from "../src/contract/records.ts";
import { intendedCall } from "../src/engine/durable.ts";
import { createHookDispatch } from "../src/extend/hooks.ts";
import { migrateStore } from "../src/store.ts";
import type { StoredRecord } from "../src/store.ts";
import type { StoreChange } from "../src/store/migrations.ts";
import { callRef, partRef } from "../src/store/refs.ts";
import { main, setup, startRun } from "../src/harness.ts";

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

it("moves a tool call's name and args to its part alone, which recovery then replays", async () => {
  const { kernel, host } = await setup();
  const { session } = await host.sessions.start({ content: "Hi." });

  const run = await startRun(kernel, session.id, main, { kind: "continuation", from: "wake" });

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

  const run = await startRun(kernel, session.id, main, { kind: "continuation", from: "wake" });

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
