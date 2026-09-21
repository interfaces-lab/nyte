import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
import { test } from "vitest";
import { sessionId, type DelegateRequest, type JobReport } from "@nyte-ai/protocol";
import { putDelegationRecord, type DelegationRecord } from "../../src/kernel/delegation-record.ts";
import { branch } from "../../src/kernel/graph.ts";
import type { Run } from "../../src/kernel/model.ts";
import { delegationRef, headRef, runRef } from "../../src/kernel/names.ts";
import { pending, submit } from "../../src/kernel/queue.ts";
import { waitForHead } from "../../src/kernel/sdk/wait.ts";
import { step } from "../../src/kernel/step.ts";
import type { Session } from "../../src/kernel/store.ts";
import type { Turn } from "../../src/kernel/turn.ts";
import { drain, message, openSession, user } from "./helpers.ts";

type HeadKind = "idle" | "live" | "settling";
type LeadKind = "none" | "user" | "passive" | "report" | "answer";

type Expected = "wait" | "join" | "settle" | "start";

const cells = [
  { head: "idle", lead: "none", expected: "wait" },
  { head: "idle", lead: "user", expected: "start" },
  { head: "idle", lead: "passive", expected: "settle" },
  { head: "idle", lead: "report", expected: "wait" },
  { head: "idle", lead: "answer", expected: "start" },
  { head: "live", lead: "none", expected: "wait" },
  { head: "live", lead: "user", expected: "join" },
  { head: "live", lead: "passive", expected: "join" },
  { head: "live", lead: "report", expected: "join" },
  { head: "live", lead: "answer", expected: "join" },
  { head: "settling", lead: "none", expected: "wait" },
  { head: "settling", lead: "user", expected: "wait" },
  { head: "settling", lead: "passive", expected: "wait" },
  { head: "settling", lead: "report", expected: "wait" },
  { head: "settling", lead: "answer", expected: "wait" },
] satisfies readonly {
  readonly head: HeadKind;
  readonly lead: LeadKind;
  readonly expected: Expected;
}[];

const turn: Turn = {
  respond: async () => assert.fail("admission cell called respond"),
  tools: async () => assert.fail("admission cell called tools"),
};

async function storedRun(session: Session): Promise<Run | undefined> {
  const oid = await session.refs.read(runRef("main"));
  if (oid === null) return undefined;
  const object = await session.objects.get(oid);
  return object?.kind === "run" ? object : undefined;
}

async function seedRun(session: Session, kind: HeadKind): Promise<Run> {
  const run: Run = {
    kind: "run",
    id: `${kind}-run`,
    head: "main",
    origin: { kind: "user" },
    root: `${kind}-run`,
    phase: kind === "idle" ? { kind: "done" } : { kind: "respond" },
    startedAt: 1,
    attempts: 0,
    config: {},
    ...(kind === "settling" ? { abortRequested: true } : {}),
  };
  const [oid] = await session.objects.put([run]);
  assert.ok(oid !== undefined);
  const outcome = await session.refs.update([{ name: runRef("main"), from: null, to: oid }], {
    reason: "seed admission head",
  });
  assert.equal(outcome.ok, true);
  return run;
}

function delegateReport(request: DelegateRequest): JobReport {
  return {
    kind: "delegate",
    session: sessionId("child"),
    title: "child",
    request,
    end: { kind: "completed" },
    report: { kind: "none" },
  };
}

async function authorizeAnswer(session: Session, root: string): Promise<DelegateRequest> {
  const request = { kind: "commit", oid: "child-request" } satisfies DelegateRequest;
  const record: DelegationRecord = {
    runId: root,
    callId: "call",
    head: "main",
    at: 1,
    continuation: { kind: "authorized", root },
    delivery: { kind: "delivered", change: "answer-change" },
    answer: { kind: "ready", request, source: { kind: "cancelled" } },
  };
  const oid = await putDelegationRecord(session, record);
  const outcome = await session.refs.update(
    [{ name: delegationRef(sessionId("child"), "child-change"), from: null, to: oid }],
    { reason: "authorize admission answer" },
  );
  assert.equal(outcome.ok, true);
  return request;
}

async function queueLead(session: Session, lead: LeadKind, root: string): Promise<void> {
  switch (lead) {
    case "none":
      return;
    case "user":
      await submit(session, {
        preparation: { kind: "none" },
        head: "main",
        delivery: "steer",
        kind: "user",
        body: message(user("hello")),
      });
      return;
    case "passive":
      await submit(session, {
        preparation: { kind: "none" },
        head: "main",
        delivery: "steer",
        kind: "passive",
        body: { kind: "config", thinkingLevel: "high" },
      });
      return;
    case "report":
      await submit(session, {
        preparation: { kind: "none" },
        head: "main",
        delivery: "steer",
        kind: "report",
        body: {
          kind: "completion",
          job: {
            kind: "command",
            id: "job",
            command: "check",
            end: { kind: "completed" },
            output: "done",
          },
        },
      });
      return;
    case "answer": {
      const request = await authorizeAnswer(session, root);
      await submit(session, {
        preparation: { kind: "none" },
        head: "main",
        delivery: "steer",
        kind: "answer",
        body: { kind: "completion", job: delegateReport(request) },
      });
      return;
    }
    default: {
      const _exhaustive: never = lead;
      return _exhaustive;
    }
  }
}

test.each(cells)("admission $head × $lead produces $expected", async ({ head, lead, expected }) => {
  const session = await openSession(`${head}-${lead}`);
  const previous = await seedRun(session, head);
  await queueLead(session, lead, previous.root);

  const outcome = await step(session, turn, { head: "main", drain });
  const run = await storedRun(session);
  const queued = await pending(session, "main");
  const tip = await session.refs.read(headRef("main"));
  const commits = await branch(session.objects, tip);

  switch (expected) {
    case "wait":
      if (head === "settling") {
        assert.equal(outcome.kind, "finished");
        assert.equal(run?.phase.kind, "aborted");
      } else {
        assert.equal(outcome.kind, head === "live" ? "finished" : "idle");
      }
      assert.equal(queued.length, lead === "none" ? 0 : 1);
      assert.equal(commits.length, 0);
      return;
    case "join":
      assert.equal(outcome.kind, "continue");
      assert.equal(run?.id, previous.id);
      assert.equal(queued.length, 0);
      assert.equal(commits.length, 1);
      return;
    case "settle":
      assert.equal(outcome.kind, "continue");
      assert.equal(run?.id, previous.id);
      assert.equal(run?.phase.kind, "done");
      assert.equal(queued.length, 0);
      assert.equal(commits[0]?.commit.body.kind, "config");
      return;
    case "start":
      assert.equal(outcome.kind, "continue");
      assert.notEqual(run?.id, previous.id);
      assert.equal(run?.phase.kind, "respond");
      assert.equal(run?.origin.kind, lead === "answer" ? "continuation" : "user");
      assert.equal(queued.length, 0);
      assert.equal(commits.length, 1);
      return;
    default: {
      const _exhaustive: never = expected;
      return _exhaustive;
    }
  }
});

test("passive input stays pending on a fresh head", async () => {
  const session = await openSession("fresh-passive");
  await queueLead(session, "passive", "unused-root");

  const outcome = await step(session, turn, { head: "main", drain });

  assert.deepEqual(outcome, { kind: "idle" });
  assert.equal(await storedRun(session), undefined);
  assert.equal((await pending(session, "main")).length, 1);
  assert.equal(await session.refs.read(headRef("main")), null);
});

test("agent handoff ends the live run and leaves its batch pending", async () => {
  const session = await openSession("handoff");
  const previous = await seedRun(session, "live");
  const oid = await session.refs.read(runRef("main"));
  assert.ok(oid !== null);
  const configured = { ...previous, config: { agent: "agent-a" } };
  const [configuredOid] = await session.objects.put([configured]);
  assert.ok(configuredOid !== undefined);
  const configuredUpdate = await session.refs.update(
    [{ name: runRef("main"), from: oid, to: configuredOid }],
    { reason: "configure live run" },
  );
  assert.equal(configuredUpdate.ok, true);
  await submit(session, {
    preparation: { kind: "none" },
    head: "main",
    delivery: "steer",
    kind: "user",
    body: { ...message(user("switch")), agent: "agent-b" },
  });

  const outcome = await step(session, turn, { head: "main", drain });
  assert.equal(outcome.kind, "finished");
  assert.equal((await storedRun(session))?.phase.kind, "done");
  assert.equal((await pending(session, "main")).length, 1);
  assert.equal(await session.refs.read(headRef("main")), null);
});

test("runs.wait treats a report as idle and an authorized answer as runnable", async () => {
  const reportSession = await openSession("wait-report");
  const reportRun = await seedRun(reportSession, "idle");
  await queueLead(reportSession, "report", reportRun.root);
  assert.deepEqual(await waitForHead(reportSession, { head: "main" }), { kind: "idle" });

  const answerSession = await openSession("wait-answer");
  const answerRun = await seedRun(answerSession, "idle");
  await queueLead(answerSession, "answer", answerRun.root);
  const controller = new AbortController();
  const waiting = waitForHead(answerSession, { head: "main", signal: controller.signal });
  await setTimeout(20);
  controller.abort();
  assert.deepEqual(await waiting, { kind: "cancelled" });
});
