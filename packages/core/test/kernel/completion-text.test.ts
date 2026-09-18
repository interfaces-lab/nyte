import assert from "node:assert/strict";
import { test } from "vitest";
import { sessionId, type JobInfo } from "@nyte-ai/protocol";
import { completionText } from "@nyte-ai/client";

const base = {
  id: "job_1",
  runId: "run",
  callId: "call",
  head: "main",
  mode: "background",
  startedAt: 1,
  updatedAt: 2,
} as const;

const subagent = (state: JobInfo["state"], output: string): JobInfo => ({
  ...base,
  kind: "subagent",
  childSessionId: sessionId("child"),
  title: "explore",
  state,
  output,
});

test.each([
  { job: subagent("completed", "Found three call sites."), says: ["explore", "finished"] },
  {
    job: { ...base, kind: "command", title: "pnpm test", state: "completed", output: "12 passed" },
    says: ["pnpm test", "exited"],
  },
  { job: subagent("failed", ""), says: ["failed", "(no output)"] },
  { job: subagent("cancelled", ""), says: ["cancelled", "(no output)"] },
  { job: subagent("interrupted", ""), says: ["interrupted", "(no output)"] },
] satisfies { job: JobInfo; says: string[] }[])(
  "a landed completion names the job, how it ended, and its output: $job.state $job.kind",
  ({ job, says }) => {
    const text = completionText(job);
    assert.ok(text.includes(job.id));
    for (const phrase of [...says, ...(job.output === "" ? [] : [job.output])]) {
      assert.ok(text.includes(phrase), `${JSON.stringify(text)} lacks ${phrase}`);
    }
  },
);
