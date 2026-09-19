import assert from "node:assert/strict";
import { test } from "vitest";
import { Value } from "typebox/value";
import {
  OPERATIONS,
  schemas,
  sessionId,
  type JobActionOutcome,
  type JobInfo,
  type JobPhase,
  type JobReport,
  type SessionEvent,
} from "../src/index.ts";

const command: JobInfo = {
  id: "job-1",
  head: "main",
  origin: { kind: "run", runId: "run-1", callId: "call-1" },
  command: "pnpm test",
  phase: { kind: "running", mode: "foreground" },
  startedAt: 1,
  updatedAt: 2,
  output: "partial output\n",
};

const phases: readonly JobPhase[] = [
  { kind: "running", mode: "foreground" },
  { kind: "running", mode: "background" },
  { kind: "completed" },
  { kind: "failed", reason: "exit 1" },
  { kind: "cancelled" },
  { kind: "interrupted" },
];

test("a job names its command, its origin, and its phase", () => {
  for (const job of [command, { ...command, origin: { kind: "user" } } satisfies JobInfo]) {
    assert.ok(Value.Check(schemas.JobInfo, job));
    for (const key of Object.keys(job)) {
      const missing: unknown = Object.fromEntries(
        Object.entries(job).filter(([field]) => field !== key),
      );
      assert.ok(!Value.Check(schemas.JobInfo, missing), key);
    }
  }
  for (const invalid of [
    { ...command, origin: { kind: "run", runId: "run-1" } },
    { ...command, phase: { kind: "running" } },
    { ...command, phase: { kind: "running", mode: "detached" } },
    { ...command, phase: { kind: "failed" } },
    { ...command, phase: { kind: "pending" } },
    { ...command, startedAt: "1" },
    { ...command, updatedAt: null },
    { ...command, output: [] },
  ])
    assert.ok(!Value.Check(schemas.JobInfo, invalid));
});

test("job lists and events carry every phase", () => {
  for (const phase of phases) {
    const job: JobInfo = { ...command, phase };
    const event: SessionEvent = { seq: 3, kind: "job", job };
    assert.ok(Value.Check(OPERATIONS["jobs.list"].output, [job]));
    assert.ok(Value.Check(schemas.SessionEvent, JSON.parse(JSON.stringify(event))));
  }
  assert.ok(Value.Check(OPERATIONS["jobs.list"].output, []));
  assert.ok(!Value.Check(OPERATIONS["jobs.list"].output, undefined));
  assert.ok(!Value.Check(schemas.SessionEvent, { seq: 3, kind: "job" }));
});

test("completion commits carry a command's or a child's report through the wire", () => {
  const reports: readonly JobReport[] = [
    {
      kind: "command",
      id: "job-1",
      command: "pnpm test",
      end: { kind: "completed" },
      output: "ok",
    },
    {
      kind: "delegate",
      session: sessionId("child"),
      title: "Map the repository",
      request: "request-commit",
      end: { kind: "failed", reason: "provider" },
      report: { kind: "text", text: "Three files.", commit: "answer-commit" },
    },
    {
      kind: "delegate",
      session: sessionId("child"),
      title: "Map the repository",
      request: "request-commit",
      end: { kind: "cancelled" },
      report: { kind: "none" },
    },
  ];
  for (const job of reports) {
    const event: SessionEvent = {
      seq: 4,
      kind: "commit",
      head: "main",
      item: {
        oid: "completion",
        commit: { kind: "commit", parent: null, at: 3, body: { kind: "completion", job } },
      },
    };
    assert.ok(Value.Check(schemas.SessionEvent, JSON.parse(JSON.stringify(event))));
  }
  for (const invalid of [
    { kind: "completion", job: { ...reports[0], end: { kind: "running", mode: "foreground" } } },
    { kind: "completion", job: { ...reports[0], output: null } },
    { kind: "completion", job: { ...reports[1], session: "" } },
    { kind: "completion", job: { ...reports[1], report: { kind: "text", text: "x" } } },
    { kind: "completion", job: command },
    { kind: "completion", message: { role: "user", content: "result", timestamp: 3 } },
  ])
    assert.ok(!Value.Check(schemas.CommitBody, invalid));
});

test("delegation tool classes name the child once it exists", () => {
  for (const valid of [
    { kind: "spawn", title: "Map the repository" },
    { kind: "delegate_call", role: "send", session: "child" },
    { kind: "delegate", role: "create", session: "child", title: "Map the repository" },
    { kind: "delegate", role: "await", session: "child", title: "Map the repository" },
  ])
    assert.ok(Value.Check(schemas.ToolClass, valid));
  for (const invalid of [
    { kind: "spawn" },
    { kind: "delegate", role: "spawn", title: "x" },
    { kind: "delegate", role: "await", jobId: "j" },
    { kind: "delegate_call", role: "create", session: "child" },
    { kind: "delegate", role: "send", session: "child" },
    { kind: "delegate", role: "send", session: "", title: "x" },
  ])
    assert.ok(!Value.Check(schemas.ToolClass, invalid));
});

test("job inputs are strict and actions return only the agreed outcomes", () => {
  const userJob: JobInfo = { ...command, id: "job-user", origin: { kind: "user" } };
  assert.ok(Value.Check(OPERATIONS["jobs.start"].input, { sessionId: "s", command: "pwd" }));
  assert.ok(
    Value.Check(OPERATIONS["jobs.start"].input, {
      sessionId: "s",
      head: "branch",
      command: "pwd",
    }),
  );
  assert.ok(Value.Check(OPERATIONS["jobs.start"].output, userJob));
  for (const input of [
    undefined,
    {},
    { sessionId: "s" },
    { sessionId: "", command: "pwd" },
    { sessionId: "s", command: "" },
    { sessionId: "s", command: "pwd", retain: true },
  ]) {
    assert.ok(!Value.Check(OPERATIONS["jobs.start"].input, input));
  }

  assert.ok(Value.Check(OPERATIONS["jobs.list"].input, { sessionId: "s" }));
  assert.ok(Value.Check(OPERATIONS["jobs.list"].input, { sessionId: "s", head: "branch" }));
  assert.ok(!Value.Check(OPERATIONS["jobs.list"].input, { sessionId: "s", jobId: "j" }));
  const outcomes: readonly JobActionOutcome[] = [
    { kind: "applied" },
    { kind: "not_found" },
    { kind: "finished" },
  ];
  for (const operation of [OPERATIONS["jobs.background"], OPERATIONS["jobs.cancel"]]) {
    assert.ok(Value.Check(operation.input, { sessionId: "s", jobId: "j" }));
    for (const input of [
      undefined,
      {},
      { sessionId: "", jobId: "j" },
      { sessionId: "s" },
      { sessionId: "s", jobId: 1 },
      { sessionId: "s", jobId: "j", head: "main" },
    ]) {
      assert.ok(!Value.Check(operation.input, input));
    }
    for (const outcome of outcomes) assert.ok(Value.Check(operation.output, outcome));
    assert.ok(!Value.Check(operation.output, { kind: "cancelled" }));
    assert.ok(!Value.Check(operation.output, undefined));
  }
});
