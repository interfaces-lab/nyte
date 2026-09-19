import { describe, expect, test } from "vitest";
import type { JobInfo, SessionSnapshot } from "@nyte-ai/protocol";
import { sessionId } from "@nyte-ai/protocol";
import { foldEvent, stateFromSnapshot } from "@nyte-ai/client";
import { jobActionMessage } from "./jobs-view.ts";
import { IDLE, projectLive } from "../live-fold.ts";

const idleSnapshot: SessionSnapshot = {
  seq: 0,
  head: "main",
  tip: null,
  config: {},
  transcript: [],
  pending: [],
  context: { estimatedTokens: 0, usageTokens: 0, trailingTokens: 0, contextWindow: 1000 },
  session: {
    sessionId: sessionId("jobs-view"),
    createdAt: 0,
    lastActivityAt: 0,
    pinned: false,
    archived: false,
    activation: { kind: "active" },
    config: {},
    heads: [{ head: "main", tip: null }],
  },
};

const job: JobInfo = {
  id: "job",
  origin: { kind: "run", runId: "run", callId: "call" },
  head: "main",
  command: "pnpm test",
  phase: { kind: "running", mode: "background" },
  startedAt: 1,
  updatedAt: 1,
  output: "test output",
};

describe("jobs", () => {
  test("a job event alone never makes the foreground composer busy", () => {
    const folded = foldEvent(stateFromSnapshot(idleSnapshot), { kind: "job", seq: 1, job });
    expect(folded.kind).toBe("state");
    if (folded.kind !== "state") return;
    expect(projectLive(IDLE, folded.state.overlay, folded.state.run)).toBe(IDLE);
  });

  test("action receipts distinguish applied, missing, and finished work", () => {
    expect(jobActionMessage({ kind: "applied" })).toBe("Cancellation requested.");
    expect(jobActionMessage({ kind: "not_found" })).toBe("This task is no longer available.");
    expect(jobActionMessage({ kind: "finished" })).toContain("already finished");
  });
});
