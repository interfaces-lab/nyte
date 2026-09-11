/** Kernel events become client events; refs and objects become a session's snapshot. */
import assert from "node:assert/strict";
import { test } from "vitest";
import { hashObject } from "../../src/kernel/hash.ts";
import type { JsonValue } from "@nyte-ai/schema";
import type { Change, Commit, Effect, Event, Obj, Oid, Run } from "../../src/kernel/model.ts";
import type { Objects } from "../../src/kernel/store.ts";
import {
  cancelledRef,
  compactionRef,
  effectRef,
  factRef,
  headRef,
  keyRef,
  queueBaseRef,
  queueTipRef,
  runRef,
  stackRef,
  DELETED_REF,
} from "../../src/kernel/names.ts";
import { projectEvent } from "../../src/kernel/sdk/events.ts";
import {
  headConfig,
  headInfo,
  pendingItems,
  runInfo,
  sessionInfo,
} from "../../src/kernel/sdk/snapshot.ts";
import type { SessionEvent } from "../../src/kernel/sdk/types.ts";
import { assistant, commit, message, user } from "./helpers.ts";

class MemoryObjects {
  private readonly store = new Map<Oid, Obj>();
  put(object: Obj): Oid {
    const oid = hashObject(object);
    this.store.set(oid, object);
    return oid;
  }
  readonly read: Pick<Objects, "get" | "chain"> = {
    get: (oid) => Promise.resolve(this.store.get(oid)),
    chain: (from, options) => {
      const page: { oid: Oid; object: Obj }[] = [];
      let oid: Oid | null = from;
      while (oid !== null && page.length < options.limit) {
        const object = this.store.get(oid);
        if (object === undefined) break;
        page.push({ oid, object });
        oid = "parent" in object ? object.parent : null;
      }
      return Promise.resolve(page);
    },
  };
}

function ref(name: string, from: Oid | null, to: Oid | null, reason = "test"): Event {
  return { seq: 7, at: 1, kind: "ref", name, from, to, reason };
}

function kinds(events: readonly SessionEvent[]): string[] {
  return events.map((event) => event.kind);
}

const run: Run = {
  kind: "run",
  id: "run_1",
  head: "main",
  phase: { kind: "waiting" },
  startedAt: 1,
  attempts: 2,
  config: {},
};

test("a head advance is one move plus one commit event per new commit, oldest first", async () => {
  const objects = new MemoryObjects();
  const a = objects.put(commit(null, message(user("a"))));
  const b = objects.put(commit(a, message(assistant("b"))));
  const c = objects.put(commit(b, message(user("c"))));
  const events = await projectEvent(ref(headRef("main"), a, c, "respond"), objects.read);
  assert.deepEqual(kinds(events), ["head_moved", "commit", "commit"]);
  assert.deepEqual(
    events.flatMap((event) => (event.kind === "commit" ? [event.item.oid] : [])),
    [b, c],
  );
  assert.ok(events.every((event) => event.seq === 7));
  const first = events[0];
  assert.ok(
    first?.kind === "head_moved" && first.head === "main" && first.from === a && first.to === c,
  );

  const back = await projectEvent(ref(headRef("main"), c, a, "move"), objects.read);
  assert.deepEqual(kinds(back), ["head_moved"]);
  const born = await projectEvent(ref(headRef("main"), null, a, "land"), objects.read);
  assert.deepEqual(kinds(born), ["head_moved", "commit"]);
});

test("queue refs become pending items, landings, and cancellations", async () => {
  const objects = new MemoryObjects();
  const first: Change = { kind: "change", previous: null, body: message(user("hi")), at: 5 };
  const firstOid = objects.put(first);
  const second: Change = {
    kind: "change",
    previous: firstOid,
    body: { kind: "config", agent: "x" },
    at: 6,
  };
  const secondOid = objects.put(second);

  const queued = await projectEvent(
    ref(queueTipRef("main", "queue"), null, firstOid, "submit"),
    objects.read,
  );
  assert.deepEqual(queued, [
    {
      seq: 7,
      kind: "queued",
      head: "main",
      item: { change: firstOid, lane: "queue", at: 5, content: "hi" },
    },
  ]);
  assert.deepEqual(
    await projectEvent(
      ref(queueTipRef("main", "steer"), firstOid, secondOid, "submit"),
      objects.read,
    ),
    [],
  );

  const landed = await projectEvent(
    ref(queueBaseRef("main", "steer"), null, secondOid, "land"),
    objects.read,
  );
  assert.deepEqual(landed, [
    { seq: 7, kind: "landed", head: "main", change: firstOid },
    { seq: 7, kind: "landed", head: "main", change: secondOid },
  ]);

  const tomb = objects.put({ kind: "blob", value: { at: 1 } });
  assert.deepEqual(
    await projectEvent(ref(cancelledRef(firstOid), null, tomb, "cancel"), objects.read),
    [{ seq: 7, kind: "queue_cancelled", change: firstOid }],
  );
});

test("run, effect, stack, fact, and deletion refs project their objects", async () => {
  const objects = new MemoryObjects();
  const runOid = objects.put(run);
  assert.deepEqual(await projectEvent(ref(runRef("main"), null, runOid, "wait"), objects.read), [
    { seq: 7, kind: "run", head: "main", run: runInfo(run) },
  ]);

  const compactionOid = objects.put({
    kind: "blob",
    value: {
      id: "compaction-1",
      reason: "manual",
      startedAt: 3,
      leaseOwner: "owner",
      leaseFence: 1,
    },
  });
  assert.deepEqual(
    await projectEvent(ref(compactionRef("main"), null, compactionOid, "compaction"), objects.read),
    [
      {
        seq: 7,
        kind: "compaction",
        head: "main",
        compaction: { id: "compaction-1", reason: "manual", startedAt: 3 },
      },
    ],
  );
  assert.deepEqual(
    await projectEvent(ref(compactionRef("main"), compactionOid, null, "compaction"), objects.read),
    [{ seq: 7, kind: "compaction", head: "main", compaction: null }],
  );

  const intent: Effect = {
    kind: "effect",
    state: "intent",
    runId: "run_1",
    callId: "c1",
    tool: "ask",
    args: { question: "why" },
    replay: "never",
    at: 1,
  };
  const intentOid = objects.put(intent);
  const waitingOid = objects.put({ kind: "effect", state: "waiting", intent: intentOid, at: 2 });
  assert.deepEqual(
    await projectEvent(ref(effectRef("run_1", "c1"), intentOid, waitingOid, "wait"), objects.read),
    [
      {
        seq: 7,
        kind: "effect",
        runId: "run_1",
        callId: "c1",
        state: "waiting",
        waitId: waitingOid,
        tool: "ask",
        args: { question: "why" },
      },
    ],
  );

  const expiredOid = objects.put({ kind: "effect", state: "expired", intent: intentOid, at: 3 });
  assert.deepEqual(
    await projectEvent(ref(effectRef("run_1", "c1"), waitingOid, expiredOid, "expired"), objects.read),
    [
      {
        seq: 7,
        kind: "effect",
        runId: "run_1",
        callId: "c1",
        state: "expired",
        tool: "ask",
        args: { question: "why" },
      },
    ],
  );

  const stackOid = objects.put({ kind: "stack", parent: "main", base: null });
  assert.deepEqual(
    await projectEvent(ref(stackRef("review"), null, stackOid, "create"), objects.read),
    [{ seq: 7, kind: "stack", head: "review", parent: "main", base: null }],
  );

  const nameOid = objects.put({ kind: "blob", value: "Chat" });
  assert.deepEqual(await projectEvent(ref(factRef("name"), null, nameOid, "fact"), objects.read), [
    { seq: 7, kind: "fact", key: "name", value: "Chat" },
  ]);
  assert.deepEqual(await projectEvent(ref(factRef("name"), nameOid, null, "fact"), objects.read), [
    { seq: 7, kind: "fact", key: "name", value: undefined },
  ]);

  const marker = objects.put({ kind: "blob", value: { at: 1 } });
  assert.deepEqual(
    kinds(await projectEvent(ref(DELETED_REF, null, marker, "delete"), objects.read)),
    ["deleted"],
  );
  assert.deepEqual(await projectEvent(ref(keyRef("k"), null, marker, "submit"), objects.read), []);
});

test("stream events pass through with their keys", async () => {
  const read = new MemoryObjects().read;
  const delta: Event = {
    seq: 9,
    at: 1,
    kind: "delta",
    runId: "r",
    attempt: 2,
    index: 0,
    part: "thinking",
    delta: "hm",
  };
  assert.deepEqual(await projectEvent(delta, read), [
    { seq: 9, kind: "reasoning_delta", runId: "r", attempt: 2, index: 0, delta: "hm" },
  ]);
  const progress: Event = {
    seq: 10,
    at: 1,
    kind: "progress",
    runId: "r",
    callId: "c",
    progress: { text: "50%" },
  };
  assert.deepEqual(await projectEvent(progress, read), [
    { seq: 10, kind: "tool_progress", runId: "r", callId: "c", progress: { text: "50%" } },
  ]);
  const notice: Event = {
    seq: 11,
    at: 1,
    kind: "notice",
    level: "warn",
    owner: "plugin x",
    message: "slow",
  };
  assert.deepEqual(await projectEvent(notice, read), [
    { seq: 11, kind: "diagnostic", level: "warn", owner: "plugin x", message: "slow" },
  ]);
});

test("a session's row folds its facts, its branch config, and its newest message", () => {
  const tip = commit(null, message(assistant("the answer")), { at: 9 });
  const commits: Commit[] = [
    commit(null, { kind: "config", model: { id: "m1" } }, { at: 1 }),
    commit(null, message(user("hello")), { at: 2 }),
    tip,
  ];
  const facts = new Map<string, JsonValue>([
    ["name", "Chat"],
    ["pinned", true],
    ["parent", { sessionId: "p", runId: "r", callId: "c", depth: 1 }],
  ]);
  const info = sessionInfo({
    id: "s1",
    activation: { kind: "active" },
    createdAt: 0,
    heads: [headInfo({ head: "main", tip: "t" }, "t")],
    facts,
    mainCommits: commits,
    pendingChanges: [],
  });
  assert.equal(info.name, "Chat");
  assert.equal(info.pinned, true);
  assert.equal(info.archived, false);
  assert.equal(info.preview, "the answer");
  assert.equal(info.lastActivityAt, 9);
  assert.deepEqual(info.config, { model: { id: "m1" } });
  assert.equal(info.parent?.sessionId, "p");

  assert.deepEqual(
    headInfo({ head: "r", tip: "c2", stack: { kind: "stack", parent: "main", base: "c1" } }, "c1")
      .stack,
    {
      parent: "main",
      base: "c1",
      stale: false,
    },
  );
  assert.equal(
    headInfo({ head: "r", tip: "c2", stack: { kind: "stack", parent: "main", base: "c1" } }, "c3")
      .stack?.stale,
    true,
  );

  const lease = { name: "refs/heads/main", owner: "o", fence: 1, expiresAt: 5 };
  assert.deepEqual(runInfo({ ...run, abortRequested: true }, lease), {
    runId: "run_1",
    head: "main",
    phase: { kind: "waiting" },
    startedAt: 1,
    attempts: 2,
    config: {},
    abortRequested: true,
    lease: { owner: "o", expiresAt: 5 },
  });

  const items = pendingItems([
    {
      oid: "x",
      lane: "steer",
      change: { kind: "change", previous: null, body: message(user("m")), at: 3 },
    },
    {
      oid: "y",
      lane: "queue",
      change: { kind: "change", previous: null, body: { kind: "config" }, at: 4 },
    },
  ]);
  assert.deepEqual(items, [{ change: "x", lane: "steer", at: 3, content: "m" }]);
});

test("session rows omit unknown thinking levels at the SDK boundary", () => {
  const project = (thinkingLevel: string) =>
    sessionInfo({
      id: "s1",
      activation: { kind: "active" },
      createdAt: 0,
      heads: [],
      facts: new Map(),
      mainCommits: [commit(null, { kind: "config", thinkingLevel })],
      pendingChanges: [],
    }).config.thinkingLevel;

  assert.equal(project("future-level"), undefined);
  assert.equal(project("high"), "high");
  assert.equal(
    runInfo({ ...run, config: { thinkingLevel: "future-level" } }).config.thinkingLevel,
    undefined,
  );
});

test("active run inputs outlive a mid-run choice; an idle head uses the next choice", () => {
  const config = { model: { provider: "openai", id: "sol" }, thinkingLevel: "high" } as const;
  const active = runInfo({ ...run, config });
  const commits = [
    commit(null, message(user("hello")), { run: run.id }),
    commit(null, { kind: "config", model: { provider: "openai", id: "luna" } }, { run: run.id }),
  ];
  assert.deepEqual(headConfig(commits, active), config);
  assert.deepEqual(headConfig(commits, { ...active, phase: { kind: "done" } }), {
    model: { provider: "openai", id: "luna" },
    thinkingLevel: "high",
  });
  assert.deepEqual(headConfig([], active), {});
});

test("legacy agent responses reveal their model until another agent is selected", () => {
  const commits = [
    commit(null, { kind: "config", agent: "reviewer" }),
    commit(null, message(assistant("reviewed"))),
  ];
  assert.deepEqual(headConfig(commits, undefined), {
    agent: "reviewer",
    model: { provider: "openai", id: "test-model" },
  });
  assert.deepEqual(
    headConfig([...commits, commit(null, { kind: "config", agent: "planner" })], undefined),
    {
      agent: "planner",
    },
  );
});

test("a choice landing during a snapshot cannot overwrite a newer branch choice", () => {
  const info = sessionInfo({
    id: "s1",
    activation: { kind: "active" },
    createdAt: 0,
    heads: [],
    facts: new Map(),
    mainCommits: [
      commit(null, { kind: "config", thinkingLevel: "low" }, { change: "landed" }),
      commit(null, { kind: "config", thinkingLevel: "high" }),
    ],
    pendingChanges: [
      {
        oid: "landed",
        lane: "steer",
        change: {
          kind: "change",
          previous: null,
          body: { kind: "config", thinkingLevel: "low" },
          at: 1,
        },
      },
    ],
  });
  assert.equal(info.config.thinkingLevel, "high");
});
