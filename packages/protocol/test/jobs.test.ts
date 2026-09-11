import assert from "node:assert/strict";
import { test } from "vitest";
import { Value } from "typebox/value";
import {
  OPERATIONS,
  schemas,
  sessionId,
  isUserJob,
  USER_JOB_RUN_ID,
  type JobInfo,
  type JobActionOutcome,
  type SessionEvent,
} from "../src/index.ts";

const command: JobInfo = {
  kind: "command",
  id: "job-1",
  runId: "run-1",
  callId: "call-1",
  head: "main",
  title: "Run tests",
  mode: "foreground",
  state: "running",
  startedAt: 1,
  updatedAt: 2,
  output: "partial output\n",
};

test("job variants require their fields and keep the child session exclusive to subagents", () => {
  const subagent: JobInfo = { ...command, kind: "subagent", childSessionId: sessionId("child") };
  for (const job of [command, subagent]) {
    assert.ok(Value.Check(schemas.JobInfo, job));
    for (const key of Object.keys(job)) {
      const missing: unknown = Object.fromEntries(
        Object.entries(job).filter(([field]) => field !== key),
      );
      assert.ok(!Value.Check(schemas.JobInfo, missing), key);
    }
  }
  for (const invalid of [
    { ...command, childSessionId: "child" },
    { ...subagent, childSessionId: "" },
    { ...command, kind: "other" },
    { ...command, mode: "detached" },
    { ...command, state: "pending" },
    { ...command, startedAt: "1" },
    { ...command, updatedAt: null },
    { ...command, output: [] },
  ])
    assert.ok(!Value.Check(schemas.JobInfo, invalid));
});

test("job lists and events carry every mode and state", () => {
  const modes: readonly JobInfo["mode"][] = ["foreground", "background"];
  const states: readonly JobInfo["state"][] = [
    "running",
    "completed",
    "failed",
    "cancelled",
    "interrupted",
  ];
  for (const mode of modes)
    for (const state of states) {
      const job: JobInfo = { ...command, mode, state };
      const event: SessionEvent = { seq: 3, kind: "job", job };
      assert.ok(Value.Check(OPERATIONS["jobs.list"].output, [job]));
      assert.ok(Value.Check(schemas.SessionEvent, JSON.parse(JSON.stringify(event))));
    }
  assert.ok(Value.Check(OPERATIONS["jobs.list"].output, []));
  assert.ok(!Value.Check(OPERATIONS["jobs.list"].output, undefined));
  assert.ok(!Value.Check(schemas.SessionEvent, { seq: 3, kind: "job" }));
});

test("completion commits preserve job identity through the wire", () => {
  const event: SessionEvent = {
    seq: 4,
    kind: "commit",
    head: "main",
    item: {
      oid: "completion",
      commit: {
        kind: "commit",
        parent: null,
        at: 3,
        body: { kind: "completion", job: { ...command, mode: "background", state: "completed" } },
      },
    },
  };
  assert.ok(Value.Check(schemas.SessionEvent, JSON.parse(JSON.stringify(event))));
  assert.ok(
    !Value.Check(schemas.CommitBody, { kind: "completion", job: { ...command, output: null } }),
  );
  assert.ok(
    !Value.Check(schemas.CommitBody, {
      kind: "completion",
      message: { role: "user", content: "result", timestamp: 3 },
    }),
  );
});

test("job inputs are strict and actions return only the agreed outcomes", () => {
  const userJob: JobInfo = {
    ...command,
    id: "job-user",
    runId: USER_JOB_RUN_ID,
    callId: "job-user",
  };
  assert.ok(isUserJob(userJob));
  assert.ok(!isUserJob(command));
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
