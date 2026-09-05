/** One tool call's durable life: intent, waiting, signal, result, and what recovery does with each. */
import assert from "node:assert/strict";
import { test } from "vitest";
import {
  clearEffects,
  listEffects,
  openEffect,
  parkEffect,
  readEffect,
  decideRecovery,
  settleEffect,
  signalEffect,
  type EffectView,
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
  return outcome.view;
}

function view(value: EffectView | { readonly kind: "conflict" }): EffectView {
  if ("kind" in value) assert.fail("expected a view, got a conflict");
  return value;
}

test("an opened intent is durable and a second open finds it instead of writing another", async () => {
  const session = await openSession();
  const held = await lease(session, "main");
  const first = await openEffect(session, {
    lease: held,
    runId: "run_1",
    callId: "c1",
    tool: "read",
    args: { path: "a.txt" },
    replay: "safe",
  });
  const again = await openEffect(session, {
    lease: held,
    runId: "run_1",
    callId: "c1",
    tool: "read",
    args: { path: "other.txt" },
    replay: "never",
  });
  assert.equal(first.kind, "opened");
  assert.equal(again.kind, "exists");
  assert.equal(again.view.oid, first.view.oid);
  const stored = await readEffect(session, { runId: "run_1", callId: "c1" });
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

test("a call settles once, from any live state, and a stale view cannot settle it again", async () => {
  const session = await openSession();
  const held = await lease(session, "main");
  const result = toolResult("c1", "read", "contents");

  const fromIntent = await open(session, held, "c1");
  const settled = view(await settleEffect(session, { lease: held, view: fromIntent, result }));
  assert.ok(settled.effect.state === "result");
  assert.deepEqual(settled.effect.result, result);
  assert.deepEqual(await settleEffect(session, { lease: held, view: fromIntent, result }), {
    kind: "conflict",
  });
  assert.equal((await readEffect(session, { runId: "run_1", callId: "c1" }))?.oid, settled.oid);

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
  assert.deepEqual(await parkEffect(session, { lease: held, view: fromIntent }), {
    kind: "conflict",
  });
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
    (await signalEffect(session, { runId: "run_1", callId: "c1", signal: "second" })).kind,
    "signalled",
  );
});

test("a runner that lost its lease can no longer move an effect", async () => {
  const session = await openSession();
  const old = await lease(session, "main", 1);
  const opened = await open(session, old, "c1");
  await sleep(5);
  const successor = granted(await session.leases.acquire(headRef("main"), 30_000));

  assert.deepEqual(await parkEffect(session, { lease: old, view: opened }), { kind: "conflict" });
  assert.deepEqual(
    await settleEffect(session, {
      lease: old,
      view: opened,
      result: toolResult("c1", "read", "x"),
    }),
    { kind: "conflict" },
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

test("recovery is decided by the effect's state and the tool's replay policy", async () => {
  const session = await openSession();
  const held = await lease(session, "main");
  const safe = await open(session, held, "safe", "safe");
  const never = await open(session, held, "never", "never");
  assert.equal(decideRecovery(safe), "execute");
  assert.equal(decideRecovery(never), "interrupted");

  const waiting = view(await parkEffect(session, { lease: held, view: never }));
  assert.equal(decideRecovery(waiting), "blocked");
  await signalEffect(session, { runId: "run_1", callId: "never", signal: "x" });
  const signalled = await readEffect(session, { runId: "run_1", callId: "never" });
  assert.ok(signalled !== undefined);
  assert.equal(decideRecovery(signalled), "wake");
  const settled = view(
    await settleEffect(session, {
      lease: held,
      view: signalled,
      result: toolResult("never", "read", "x"),
    }),
  );
  assert.equal(decideRecovery(settled), "reuse");
});
