import assert from "node:assert/strict";
import { test } from "vitest";
import { sessionId } from "@nyte-ai/protocol";
import type { DelegateRequest, JobReport, SessionId } from "@nyte-ai/protocol";
import {
  putDelegationRecord,
  readDelegation,
  type DelegationRecord,
} from "../../src/kernel/delegation-record.ts";
import { branch } from "../../src/kernel/graph.ts";
import type { Run } from "../../src/kernel/model.ts";
import { delegationRef, headRef, runRef } from "../../src/kernel/names.ts";
import { submit } from "../../src/kernel/queue.ts";
import { step } from "../../src/kernel/step.ts";
import type { Session } from "../../src/kernel/store.ts";
import type { Turn } from "../../src/kernel/turn.ts";
import { gateRefUpdate } from "./acceptance-helpers.ts";
import {
  assistant,
  drain,
  granted,
  message,
  openStore,
  storePath,
  user,
  within,
} from "./helpers.ts";

const turn: Turn = {
  respond: async () => ({ kind: "complete", message: assistant("done") }),
  tools: async () => assert.fail("delegation acceptance called tools"),
};

async function storedRun(
  session: Session,
): Promise<{ readonly oid: string; readonly run: Run } | undefined> {
  const oid = await session.refs.read(runRef("main"));
  if (oid === null) return undefined;
  const object = await session.objects.get(oid);
  return object?.kind === "run" ? { oid, run: object } : undefined;
}

async function startAndFinish(session: Session, text = "start"): Promise<Run> {
  await submit(session, {
    preparation: { kind: "none" },
    head: "main",
    delivery: "steer",
    kind: "user",
    body: message(user(text)),
  });
  assert.equal((await step(session, turn, { head: "main", drain })).kind, "continue");
  assert.equal((await step(session, turn, { head: "main", drain })).kind, "finished");
  const stored = await storedRun(session);
  assert.ok(stored);
  return stored.run;
}

function delegateReport(child: SessionId, request: DelegateRequest): JobReport {
  return {
    kind: "delegate",
    session: child,
    title: child,
    request,
    end: { kind: "completed" },
    report: { kind: "none" },
  };
}

async function writeDelegation(input: {
  readonly session: Session;
  readonly child: SessionId;
  readonly change: string;
  readonly request: DelegateRequest;
  readonly run: Run;
  readonly continuation: DelegationRecord["continuation"];
}): Promise<string> {
  const record: DelegationRecord = {
    runId: input.run.id,
    callId: `call-${input.change}`,
    head: "main",
    at: 1,
    continuation: input.continuation,
    delivery: { kind: "delivered", change: `completion-${input.change}` },
    answer: { kind: "ready", request: input.request, source: { kind: "cancelled" } },
  };
  const oid = await putDelegationRecord(input.session, record);
  const ref = delegationRef(input.child, input.change);
  const outcome = await input.session.refs.update([{ name: ref, from: null, to: oid }], {
    reason: "acceptance delegation",
  });
  assert.equal(outcome.ok, true);
  return ref;
}

async function queueDelegate(
  session: Session,
  child: SessionId,
  request: DelegateRequest,
): Promise<void> {
  await submit(session, {
    preparation: { kind: "none" },
    head: "main",
    delivery: "steer",
    kind: "answer",
    body: { kind: "completion", job: delegateReport(child, request) },
  });
}

test("an authorized continuation is consumed once and inherits its owner's root", async () => {
  const consumedSession = await openStore().create({ id: "accept-consume" });
  const parent = await startAndFinish(consumedSession);
  const child = sessionId("consume-child");
  const request = { kind: "commit", oid: "consume-request" } satisfies DelegateRequest;
  const ref = await writeDelegation({
    session: consumedSession,
    child,
    change: "consume-change",
    request,
    run: parent,
    continuation: { kind: "authorized", root: parent.root },
  });
  await queueDelegate(consumedSession, child, request);

  assert.equal((await step(consumedSession, turn, { head: "main", drain })).kind, "continue");
  const consumedOid = await consumedSession.refs.read(ref);
  assert.ok(consumedOid);
  const consumed = await readDelegation(
    consumedSession,
    { name: ref, oid: consumedOid },
    delegationRef(child, ""),
  );
  assert.equal(consumed.record.continuation.kind, "consumed");
  const continuation = await storedRun(consumedSession);
  assert.ok(continuation);
  assert.deepEqual(continuation.run.origin, { kind: "continuation", session: child, request });
  assert.equal(continuation.run.root, parent.root);
});

test("an abort winning the model-send CAS leaves no child request", async () => {
  const path = storePath();
  const base = openStore(path);
  const session = await base.create({ id: "send-abort" });
  await submit(session, {
    preparation: { kind: "none" },
    head: "main",
    delivery: "steer",
    kind: "user",
    body: message(user("start")),
  });
  await step(session, turn, { head: "main", drain });
  const owner = await storedRun(session);
  assert.ok(owner);
  const child = sessionId("send-abort-child");
  const record: DelegationRecord = {
    runId: owner.run.id,
    callId: "send-call",
    head: "main",
    at: 1,
    continuation: { kind: "authorized", root: owner.run.root },
    delivery: { kind: "owed" },
    answer: { kind: "pending" },
  };
  const recordOid = await putDelegationRecord(session, record);
  const requestRef = delegationRef(child, "child-change");
  const gate = gateRefUpdate(base);
  const sendingSession = await gate.store.open(session.id);
  const barrier = gate.arm();
  const sending = sendingSession.refs.update(
    [
      { name: requestRef, from: null, to: recordOid },
      { name: runRef("main"), from: owner.oid, to: owner.oid },
    ],
    { reason: "model send" },
  );
  await within(barrier.entered);
  const aborted: Run = { ...owner.run, abortRequested: true };
  const [abortedOid] = await session.objects.put([aborted]);
  assert.ok(abortedOid);
  const abort = await session.refs.update(
    [{ name: runRef("main"), from: owner.oid, to: abortedOid }],
    { reason: "abort" },
  );
  assert.equal(abort.ok, true);
  barrier.release();

  const sendOutcome = await sending;
  assert.equal(sendOutcome.ok, false);
  if (sendOutcome.ok) assert.fail("the model send won the abort race");
  assert.equal(sendOutcome.reason, "conflict");
  assert.equal(await session.refs.read(requestRef), null);
});

test("two one-step hosts racing one authorization publish one continuation", async () => {
  const path = storePath();
  const firstStore = openStore(path);
  const firstSession = await firstStore.create({ id: "authorization-race" });
  const parent = await startAndFinish(firstSession);
  const child = sessionId("race-child");
  const request = { kind: "commit", oid: "race-request" } satisfies DelegateRequest;
  await writeDelegation({
    session: firstSession,
    child,
    change: "race-change",
    request,
    run: parent,
    continuation: { kind: "authorized", root: parent.root },
  });
  await queueDelegate(firstSession, child, request);
  const secondSession = await openStore(path).open(firstSession.id);
  const lease = granted(await firstSession.leases.acquire(headRef("main"), 30_000));
  const gate = Promise.withResolvers<void>();
  let arrived = 0;
  const beforeStep = async (): Promise<void> => {
    arrived += 1;
    if (arrived === 2) gate.resolve();
    await gate.promise;
  };
  try {
    await Promise.all([
      step(firstSession, turn, { head: "main", drain, lease, beforeStep }),
      step(secondSession, turn, { head: "main", drain, lease, beforeStep }),
    ]);
  } finally {
    await firstSession.leases.release(lease);
  }

  const commits = await branch(firstSession.objects, await firstSession.refs.read(headRef("main")));
  assert.equal(
    commits.filter(
      (item) => item.commit.body.kind === "completion" && item.commit.body.job.kind === "delegate",
    ).length,
    1,
  );
  const continuations = new Set<string>();
  for (const event of await firstSession.events.read({ afterSeq: 0 })) {
    if (event.kind !== "ref" || event.name !== runRef("main") || event.to === null) continue;
    const object = await firstSession.objects.get(event.to);
    if (object?.kind === "run" && object.origin.kind === "continuation")
      continuations.add(object.id);
  }
  assert.equal(continuations.size, 1);
  const current = await storedRun(firstSession);
  assert.ok(current);
  assert.deepEqual(current.run.origin, { kind: "continuation", session: child, request });
  assert.equal(current.run.root, parent.root);
});
