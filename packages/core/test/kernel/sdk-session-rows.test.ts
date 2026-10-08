import assert from "node:assert/strict";
import type { Api, Model } from "@nyte-ai/ai";
import type { JsonValue } from "@nyte-ai/schema";
import { afterEach, test } from "vitest";
import type { Run } from "../../src/kernel/model.ts";
import { encodeFactKey, factRef, headRef, runRef } from "../../src/kernel/names.ts";
import { createNyte } from "../../src/kernel/sdk/nyte.ts";
import { CorruptObject, sessionId } from "../../src/kernel/sdk/types.ts";
import type { Nyte, SessionId } from "../../src/kernel/sdk/types.ts";
import type { Session, Store } from "../../src/kernel/store.ts";
import { chain, localOptions, message, openStore, seedHead, setHead, user } from "./helpers.ts";
import { pluginFactKey } from "../../src/plugins/storage.ts";

const model: Model<Api> = {
  id: "rows-model",
  name: "Rows",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 1_000,
};

/** Commits each session's history handed out, and an optional pause before one ref read. */
interface Probe {
  readonly commits: Map<string, number>;
  beforeRead?: { readonly name: string; readonly run: () => Promise<void> } | undefined;
}

/** The store as the SDK sees it, counting commit reads; `listing: false` keeps no rows across hosts. */
function probed(store: Store, probe: Probe, options: { readonly listing: boolean }): Store {
  const count = (id: string, commits: number) =>
    probe.commits.set(id, (probe.commits.get(id) ?? 0) + commits);
  const wrap = (opened: Session): Session => ({
    id: opened.id,
    events: opened.events,
    leases: opened.leases,
    close: () => opened.close(),
    listing: options.listing
      ? opened.listing
      : { read: async () => undefined, write: async () => undefined },
    refs: {
      async read(name) {
        const pause = probe.beforeRead;
        if (pause?.name === name) {
          probe.beforeRead = undefined;
          await pause.run();
        }
        return opened.refs.read(name);
      },
      list: (prefix) => opened.refs.list(prefix),
      update: (updates, update) => opened.refs.update(updates, update),
    },
    objects: {
      put: (objects) => opened.objects.put(objects),
      async get(oid) {
        const object = await opened.objects.get(oid);
        if (object?.kind === "commit") count(opened.id, 1);
        return object;
      },
      async chain(from, chain) {
        const page = await opened.objects.chain(from, chain);
        count(opened.id, page.filter((item) => item.object.kind === "commit").length);
        return page;
      },
      list: () => opened.objects.list(),
      commits: () => opened.objects.commits(),
      delete: (oids) => opened.objects.delete(oids),
    },
  });
  return {
    create: async (input) => wrap(await store.create(input)),
    open: async (id) => wrap(await store.open(id)),
    list: () => store.list(),
    delete: (id) => store.delete(id),
    close: () => store.close(),
  };
}

const hosts: Nyte[] = [];
afterEach(async () => {
  for (const nyte of hosts.splice(0)) await nyte.close();
});

async function host(store: Store): Promise<Nyte> {
  const nyte = await createNyte({
    store,
    model,
    thinkingLevel: "low",
    models: {
      getModels: () => [model],
      getModel: (provider, id) =>
        provider === model.provider && id === model.id ? model : undefined,
      getAvailable: async () => [model],
    },
    streamFn: () => {
      throw new Error("A session row never calls a provider");
    },
    ...localOptions("/tmp/session-rows"),
  });
  hosts.push(nyte);
  return nyte;
}

async function fixture(turns = 40) {
  const base = openStore();
  const probe: Probe = { commits: new Map() };
  const nyte = await host(probed(base, probe, { listing: true }));
  const { sessionId: id } = await nyte.sessions.create({ name: "first" });
  const handle = await base.open(id);
  await seedHead(
    handle,
    "main",
    Array.from({ length: turns }, (_, index) => message(user(`turn ${index}`, 1_000 + index))),
  );
  /** A row a full read builds, on a host that keeps none. */
  const fullRead = async (target: SessionId = id) =>
    (await host(probed(base, { commits: new Map() }, { listing: false }))).sessions.get({
      sessionId: target,
    });
  const commits = () => [...probe.commits.values()].reduce((sum, value) => sum + value, 0);
  const reset = () => probe.commits.clear();
  return { base, probe, nyte, id, handle, fullRead, commits, reset };
}

/** A user message landing on main after every seeded one. */
async function send(session: Session, text: string, at: number): Promise<void> {
  const from = await session.refs.read(headRef("main"));
  const [oid] = await chain(session, from, [message(user(text))], { at });
  await setHead(session, "main", oid ?? from);
}

async function setRef(session: Session, name: string, value: JsonValue | undefined): Promise<void> {
  const from = await session.refs.read(name);
  const to =
    value === undefined
      ? null
      : ((await session.objects.put([{ kind: "blob", value }]))[0] ?? null);
  const outcome = await session.refs.update([{ name, from, to }], { reason: "test" });
  assert.equal(outcome.ok, true);
}

test("fact writes refresh a row without reading history, and the row is the one a full read builds", async () => {
  const f = await fixture();
  await f.nyte.sessions.list({ includeArchived: true });
  f.reset();

  await f.nyte.sessions.setArchived({ sessionId: f.id, archived: true });
  await f.nyte.sessions.setPinned({ sessionId: f.id, pinned: true });
  await f.nyte.sessions.rename({ sessionId: f.id, name: "second" });
  const row = await f.nyte.sessions.get({ sessionId: f.id });
  const page = await f.nyte.sessions.list({ includeArchived: true });
  const hidden = await f.nyte.sessions.list();

  assert.equal(f.commits(), 0);
  assert.equal(row?.name, "second");
  assert.equal(row?.archived, true);
  assert.equal(row?.pinned, true);
  assert.equal(row?.preview, "turn 39");
  assert.deepEqual(row, await f.fullRead());
  assert.deepEqual(page.items, [row]);
  assert.deepEqual(hidden.items, []);

  // A removed name leaves the row, not an old value spread over it.
  await setRef(f.handle, factRef("name"), undefined);
  f.reset();
  const unnamed = await f.nyte.sessions.get({ sessionId: f.id });
  assert.equal(f.commits(), 0);
  assert.ok(unnamed !== undefined);
  assert.equal("name" in unnamed, false);
  assert.deepEqual(unnamed, await f.fullRead());
});

test("a fact the row never reads keeps it; a parent, a send, or a trimmed stream rebuilds it", async () => {
  const f = await fixture();
  const other = (await f.nyte.sessions.create()).sessionId;
  const before = await f.nyte.sessions.get({ sessionId: f.id });
  f.reset();

  await setRef(f.handle, factRef(encodeFactKey(pluginFactKey("demo", "enabled"))), true);
  assert.deepEqual(await f.nyte.sessions.get({ sessionId: f.id }), before);
  assert.equal(f.commits(), 0);

  // A fact and a send in one interval: the history moved, so the row is rebuilt.
  await f.nyte.sessions.setArchived({ sessionId: f.id, archived: true });
  await send(f.handle, "sent with the fact", 9_000);
  const sent = await f.nyte.sessions.get({ sessionId: f.id });
  assert.ok(f.commits() > 0);
  assert.equal(sent?.preview, "sent with the fact");
  assert.equal(sent?.archived, true);

  // The SDK writes a parent only at creation; a store-level rewrite still rebuilds.
  const parent = { sessionId: other, runId: "run", callId: "call", depth: 1 };
  await setRef(f.handle, factRef("parent"), parent);
  f.reset();
  const children = await f.nyte.sessions.list({ parent: other, includeArchived: true });
  assert.ok(f.commits() > 0);
  assert.deepEqual(
    children.items.map((item) => item.parent),
    [parent],
  );

  await send(f.handle, "after the trim", 10_000);
  await f.handle.events.trim(await f.handle.events.last());
  f.reset();
  const trimmed = await f.nyte.sessions.get({ sessionId: f.id });
  assert.ok(f.commits() > 0);
  assert.equal(trimmed?.preview, "after the trim");
  assert.deepEqual(trimmed, await f.fullRead());
});

test("a send that lands while facts are read is seen by the next read", async () => {
  const f = await fixture();
  await f.nyte.sessions.list({ includeArchived: true });
  await f.nyte.sessions.setArchived({ sessionId: f.id, archived: true });
  f.probe.beforeRead = {
    name: factRef("archived"),
    run: async () => {
      await send(f.handle, "landed during the refresh", 9_000);
    },
  };

  await f.nyte.sessions.list({ includeArchived: true });
  assert.equal(f.probe.beforeRead, undefined);
  const next = await f.nyte.sessions.get({ sessionId: f.id });
  assert.equal(next?.preview, "landed during the refresh");
  assert.deepEqual(next, await f.fullRead());
});

test("a parent filter reads no other session's history", async () => {
  const f = await fixture();
  const sibling = (await f.nyte.sessions.create()).sessionId;
  await seedHead(
    await f.base.open(sibling),
    "main",
    Array.from({ length: 30 }, (_, index) => message(user(`sibling ${index}`))),
  );
  const child = (
    await f.nyte.sessions.create({
      parent: { sessionId: f.id, runId: "run", callId: "call", depth: 1 },
    })
  ).sessionId;

  const probe: Probe = { commits: new Map() };
  const cold = await host(probed(f.base, probe, { listing: false }));
  const page = await cold.sessions.list({ parent: f.id, includeArchived: true });

  assert.deepEqual(
    page.items.map((item) => item.sessionId),
    [child],
  );
  assert.equal(probe.commits.get(f.id) ?? 0, 0);
  assert.equal(probe.commits.get(sibling) ?? 0, 0);
});

test("get reads every run's lease as it is now, whatever the run's phase", async () => {
  const f = await fixture(2);
  const run: Run = {
    kind: "run",
    id: "finished",
    head: "main",
    origin: { kind: "user" },
    root: "finished",
    phase: { kind: "done" },
    config: {},
    startedAt: 1_000,
    attempts: 1,
  };
  const [oid] = await f.handle.objects.put([run]);
  assert.ok(oid);
  await f.handle.refs.update([{ name: runRef("main"), from: null, to: oid }], { reason: "test" });
  const lease = await f.handle.leases.acquire(headRef("main"), 60_000);
  assert.ok(lease.ok);

  const held = await f.nyte.sessions.get({ sessionId: f.id });
  assert.equal(held?.heads[0]?.run?.phase.kind, "done");
  assert.deepEqual(held?.heads[0]?.run?.lease, {
    owner: lease.lease.owner,
    expiresAt: lease.lease.expiresAt,
  });

  assert.ok(await f.handle.leases.renew(lease.lease, 120_000));
  f.reset();
  const renewed = await f.nyte.sessions.get({ sessionId: f.id });
  assert.equal(f.commits(), 0);
  assert.ok((renewed?.heads[0]?.run?.lease?.expiresAt ?? 0) > lease.lease.expiresAt);
  assert.deepEqual(renewed, await f.fullRead());

  assert.ok(await f.handle.leases.release(lease.lease));
  const released = await f.nyte.sessions.get({ sessionId: f.id });
  const releasedRun = released?.heads[0]?.run;
  assert.equal(f.commits(), 0);
  assert.ok(releasedRun !== undefined);
  assert.equal("lease" in releasedRun, false);
  assert.deepEqual(released, await f.fullRead());
});

test("a child's get follows its legacy root's cwd, which its own stream never records", async () => {
  const base = openStore();
  const nyte = await host(probed(base, { commits: new Map() }, { listing: true }));
  const root = await base.create({ id: "legacy-root", initialFacts: { cwd: "/tmp/legacy-a" } });
  const parent = { sessionId: root.id, runId: "run", callId: "call", depth: 1 };
  await (await base.create({ id: "legacy-child", initialFacts: { parent } })).close();
  const child = sessionId("legacy-child");

  assert.equal((await nyte.sessions.get({ sessionId: child }))?.workspace.cwd, "/tmp/legacy-a");
  await setRef(root, factRef("cwd"), "/tmp/legacy-b");
  const moved = await nyte.sessions.get({ sessionId: child });
  assert.equal(moved?.workspace.cwd, "/tmp/legacy-b");
  const fresh = await (
    await host(probed(base, { commits: new Map() }, { listing: false }))
  ).sessions.get({ sessionId: child });
  assert.deepEqual(moved, fresh);
  await root.close();
});

test("a corrupt row fact leaves the listing and fails get, as a full read does", async () => {
  const f = await fixture(2);
  await f.nyte.sessions.list({ includeArchived: true });
  const head = await f.handle.refs.read(headRef("main"));
  const from = await f.handle.refs.read(factRef("archived"));
  await f.handle.refs.update([{ name: factRef("archived"), from, to: head }], { reason: "test" });

  const warnings: string[] = [];
  const warn = (warning: Error) => warnings.push(warning.name);
  process.on("warning", warn);
  try {
    assert.deepEqual((await f.nyte.sessions.list({ includeArchived: true })).items, []);
    await assert.rejects(f.nyte.sessions.get({ sessionId: f.id }), CorruptObject);
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(warnings.includes("CorruptSession"));
  } finally {
    process.off("warning", warn);
  }
});

test("a session root is read without history, with its depth, and a stored cycle throws", async () => {
  const f = await fixture();
  const child = (
    await f.nyte.sessions.create({
      parent: { sessionId: f.id, runId: "run", callId: "call", depth: 1 },
    })
  ).sessionId;
  f.reset();

  const root = await f.nyte.sessionRoot({ sessionId: child });
  assert.equal(f.commits(), 0);
  assert.equal(root?.sessionId, f.id);
  assert.equal(root?.depth, 1);
  assert.deepEqual(root?.workspace, (await f.nyte.sessionRoot({ sessionId: f.id }))?.workspace);
  assert.equal((await f.nyte.sessionRoot({ sessionId: f.id }))?.depth, 0);
  assert.equal(await f.nyte.sessionRoot({ sessionId: sessionId("missing") }), undefined);

  const link = (to: string) => ({
    parent: { sessionId: to, runId: "run", callId: "call", depth: 1 },
  });
  await (await f.base.create({ id: "cycle-a", initialFacts: link("cycle-b") })).close();
  await (await f.base.create({ id: "cycle-b", initialFacts: link("cycle-a") })).close();
  await assert.rejects(
    f.nyte.sessionRoot({ sessionId: sessionId("cycle-a") }),
    /parent chain forms a cycle/,
  );
});
