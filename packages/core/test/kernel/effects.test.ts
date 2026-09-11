/** One tool call's durable life: intent, waiting, expired, signal, result, and recovery. */
import assert from "node:assert/strict";
import { test } from "vitest";
import {
  clearEffects,
  decideRecovery,
  expireEffect,
  listEffects,
  openEffect,
  parkEffect,
  readEffect,
  settleEffect,
  signalEffect,
  type EffectView,
  type ParkEffectOutcome,
  type SettleEffectOutcome,
} from "../../src/kernel/effects.ts";
import { headRef } from "../../src/kernel/names.ts";
import type { Lease } from "../../src/kernel/model.ts";
import type { Session } from "../../src/kernel/store.ts";
import { granted, lease, openSession, sleep, toolResult } from "./helpers.ts";

async function open(
  session: Session,
  held: Lease,
  callId: string,
  replay: "safe" | "never" = "never",
): Promise<EffectView> {
  const outcome = await openEffect(session, {
    lease: held,
    runId: "run_1",
    callId,
    tool: "read",
    args: { path: "a.txt" },
    replay,
  });
  assert.ok(outcome.kind === "opened" || outcome.kind === "exists");
  return outcome.view;
}

function view(value: ParkEffectOutcome | SettleEffectOutcome): EffectView {
  assert.ok(value.kind === "parked" || value.kind === "settled");
  return value.view;
}

test("concurrent opens share one durable intent; a later open finds it instead of writing another", async () => {
  const session = await openSession();
  const held = await lease(session, "main");
  const before = await session.events.last();
  const intent = {
    lease: held,
    runId: "run_1",
    callId: "c1",
    tool: "read",
    args: { path: "a.txt" },
    replay: "safe",
  } as const;
  const outcomes = await Promise.all([openEffect(session, intent), openEffect(session, intent)]);
  assert.deepEqual(outcomes.map((outcome) => outcome.kind).sort(), ["exists", "opened"]);
  assert.equal((await session.events.read({ afterSeq: before })).length, 1);
  const cursor = await session.events.last();
  const again = await openEffect(session, {
    ...intent,
    args: { path: "other.txt" },
    replay: "never",
  });
  assert.ok(again.kind === "exists");
  assert.equal(await session.events.last(), cursor);
  const stored = await readEffect(session, { runId: "run_1", callId: "c1" });
  assert.equal(stored?.oid, again.view.oid);
  assert.deepEqual(stored?.intent.args, { path: "a.txt" });
  assert.equal(stored?.intent.replay, "safe");
  assert.equal(await readEffect(session, { runId: "run_1", callId: "nope" }), undefined);
});

test("a parked call takes exactly one answer", async () => {
  const session = await openSession();
  const held = await lease(session, "main");
  const parked = view(
    await parkEffect(session, { lease: held, view: await open(session, held, "c1") }),
  );
  assert.equal(parked.effect.state, "waiting");

  const first = await signalEffect(session, {
    runId: "run_1",
    callId: "c1",
    signal: { answer: "yes" },
  });
  const second = await signalEffect(session, {
    runId: "run_1",
    callId: "c1",
    signal: { answer: "no" },
  });
  assert.equal(first.kind, "signalled");
  assert.equal(second.kind, "not_waiting");
  const stored = await readEffect(session, { runId: "run_1", callId: "c1" });
  assert.ok(stored?.effect.state === "signal");
  assert.deepEqual(stored.effect.signal, { answer: "yes" });
  assert.deepEqual(stored.intent.args, { path: "a.txt" });

  assert.equal(
    (await signalEffect(session, { runId: "run_1", callId: "zz", signal: 1 })).kind,
    "not_found",
  );
  await open(session, held, "c2");
  assert.equal(
    (await signalEffect(session, { runId: "run_1", callId: "c2", signal: 1 })).kind,
    "not_waiting",
  );
});

test("expiry claims a wait once and refuses every later answer", async () => {
  const session = await openSession();
  const held = await lease(session, "main");
  const waiting = view(
    await parkEffect(session, {
      lease: held,
      view: await open(session, held, "expired"),
      until: 0,
    }),
  );
  const expired = await expireEffect(session, { lease: held, view: waiting, now: 0 });
  assert.ok(expired.kind === "expired");
  assert.equal(decideRecovery(expired.view), "wake");

  assert.equal(
    (
      await signalEffect(session, {
        runId: "run_1",
        callId: "expired",
        signal: { answer: "late" },
      })
    ).kind,
    "not_waiting",
  );
  assert.equal(
    (await readEffect(session, { runId: "run_1", callId: "expired" }))?.effect.state,
    "expired",
  );
});

test("a reply before the deadline wins over a later expiry claim", async () => {
  const session = await openSession();
  const held = await lease(session, "main");
  const until = Date.now() + 60_000;
  const waiting = view(
    await parkEffect(session, {
      lease: held,
      view: await open(session, held, "race"),
      until,
    }),
  );

  const reply = await signalEffect(session, {
    runId: "run_1",
    callId: "race",
    waitId: waiting.oid,
    signal: "answer",
  });
  const expiration = await expireEffect(session, { lease: held, view: waiting, now: until });
  assert.equal(reply.kind, "signalled");
  assert.equal(expiration.kind, "conflict");
  assert.equal(
    (await readEffect(session, { runId: "run_1", callId: "race" }))?.effect.state,
    "signal",
  );
});

test("a wait without a reached deadline cannot expire", async () => {
  const session = await openSession();
  const held = await lease(session, "main");
  const indefinite = view(
    await parkEffect(session, { lease: held, view: await open(session, held, "indefinite") }),
  );
  const future = view(
    await parkEffect(session, {
      lease: held,
      view: await open(session, held, "future"),
      until: 100,
    }),
  );

  assert.equal(
    (await expireEffect(session, { lease: held, view: indefinite, now: 100 })).kind,
    "conflict",
  );
  assert.equal(
    (await expireEffect(session, { lease: held, view: future, now: 99 })).kind,
    "conflict",
  );
});

test("a call settles once, from any live state, and a stale view cannot settle it again", async () => {
  const session = await openSession();
  const held = await lease(session, "main");
  const result = toolResult("c1", "read", "contents");

  const fromIntent = await open(session, held, "c1");
  const settled = view(await settleEffect(session, { lease: held, view: fromIntent, result }));
  assert.ok(settled.effect.state === "result");
  assert.deepEqual(settled.effect.result, result);
  const cursor = await session.events.last();
  assert.deepEqual(await settleEffect(session, { lease: held, view: fromIntent, result }), {
    kind: "conflict",
  });
  assert.deepEqual(await parkEffect(session, { lease: held, view: fromIntent }), {
    kind: "conflict",
  });
  assert.equal((await readEffect(session, { runId: "run_1", callId: "c1" }))?.oid, settled.oid);
  assert.equal(await session.events.last(), cursor);

  const waiting = view(
    await parkEffect(session, { lease: held, view: await open(session, held, "c2") }),
  );
  assert.equal(
    view(await settleEffect(session, { lease: held, view: waiting, result })).effect.state,
    "result",
  );

  const parked = view(
    await parkEffect(session, { lease: held, view: await open(session, held, "c3") }),
  );
  await signalEffect(session, { runId: "run_1", callId: "c3", signal: "go" });
  const signalled = await readEffect(session, { runId: "run_1", callId: "c3" });
  assert.ok(signalled !== undefined);
  assert.equal(
    view(await settleEffect(session, { lease: held, view: signalled, result })).effect.state,
    "result",
  );
  assert.equal(parked.effect.state, "waiting");
});

test("a wake that decides to keep waiting parks the call again for the next answer", async () => {
  const session = await openSession();
  const held = await lease(session, "main");
  const parked = view(
    await parkEffect(session, { lease: held, view: await open(session, held, "c1") }),
  );
  await signalEffect(session, { runId: "run_1", callId: "c1", signal: "first" });
  const signalled = await readEffect(session, { runId: "run_1", callId: "c1" });
  assert.ok(signalled !== undefined && signalled.oid !== parked.oid);
  const again = view(await parkEffect(session, { lease: held, view: signalled }));
  assert.equal(again.effect.state, "waiting");
  assert.equal(
    (
      await signalEffect(session, {
        runId: "run_1",
        callId: "c1",
        waitId: parked.oid,
        signal: "stale",
      })
    ).kind,
    "not_waiting",
  );
  assert.equal(
    (
      await signalEffect(session, {
        runId: "run_1",
        callId: "c1",
        waitId: again.oid,
        signal: "second",
      })
    ).kind,
    "signalled",
  );
});

test("a runner that lost its lease can no longer move an effect", async () => {
  const session = await openSession();
  const old = await lease(session, "main", 1);
  const opened = await open(session, old, "c1");
  await sleep(5);
  const successor = granted(await session.leases.acquire(headRef("main"), 30_000));

  assert.deepEqual(await parkEffect(session, { lease: old, view: opened }), { kind: "fenced" });
  assert.deepEqual(
    await settleEffect(session, {
      lease: old,
      view: opened,
      result: toolResult("c1", "read", "x"),
    }),
    { kind: "fenced" },
  );
  assert.equal((await readEffect(session, { runId: "run_1", callId: "c1" }))?.oid, opened.oid);
  assert.equal(
    view(await parkEffect(session, { lease: successor, view: opened })).effect.state,
    "waiting",
  );
});

test("a run's effects list in call order and clear together", async () => {
  const session = await openSession();
  const held = await lease(session, "main");
  await open(session, held, "c2");
  await open(session, held, "c1");
  await open(session, held, "c10");
  const views = await listEffects(session, "run_1");
  assert.deepEqual(
    views.map((item) => item.intent.callId),
    ["c1", "c10", "c2"],
  );
  assert.deepEqual(await listEffects(session, "run_other"), []);

  const cleared = await clearEffects(session, { lease: held, runId: "run_1", views });
  assert.equal(cleared.ok, true);
  assert.deepEqual(await listEffects(session, "run_1"), []);
});
