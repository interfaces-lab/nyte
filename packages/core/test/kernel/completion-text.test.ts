import assert from "node:assert/strict";
import { test } from "vitest";
import { sessionId, type JobReport } from "@nyte-ai/protocol";
import { completionText } from "@nyte-ai/client";

const child = sessionId("s_child_1");

const agent = (end: JobReport["end"], text: string): JobReport => ({
  kind: "delegate",
  session: child,
  title: "explore",
  request: { kind: "commit", oid: "request-commit" },
  end,
  report: text === "" ? { kind: "none" } : { kind: "text", text, commit: "answer-commit" },
});

test.each([
  {
    job: agent({ kind: "completed" }, "Found three call sites."),
    says: ["explore", child, "finished", "Found three call sites."],
  },
  {
    job: {
      kind: "command",
      id: "job_1",
      command: "pnpm test",
      end: { kind: "completed" },
      output: "12 passed",
    },
    says: ["job_1", "pnpm test", "finished", "12 passed"],
  },
  {
    job: {
      kind: "command",
      id: "job_1",
      command: "pnpm test",
      end: { kind: "failed", reason: "exit 1" },
      output: "",
    },
    says: ["failed: exit 1", "(no output)"],
  },
  {
    job: agent({ kind: "failed", reason: "provider down" }, ""),
    says: ["failed: provider down", "(no report)"],
  },
  { job: agent({ kind: "cancelled" }, ""), says: ["was cancelled", "(no report)"] },
  { job: agent({ kind: "interrupted" }, ""), says: ["was interrupted", "(no report)"] },
] satisfies { job: JobReport; says: string[] }[])(
  "a landed completion names the work, how it ended, and what it produced: $job.kind $job.end.kind",
  ({ job, says }) => {
    const text = completionText(job);
    assert.ok(text.startsWith("Background "), text);
    for (const phrase of says)
      assert.ok(text.includes(phrase), `${JSON.stringify(text)} lacks ${phrase}`);
  },
);
