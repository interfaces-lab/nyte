import { describe, expect, test } from "vitest";
import type { JobInfo, SessionSnapshot } from "@nyte-ai/core";
import { sessionId } from "@nyte-ai/protocol";
import { foldEvent, stateFromSnapshot } from "@nyte-ai/core/client";
import { jobActionMessage, jobControls } from "./jobs-view.ts";
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
  kind: "command",
  runId: "run",
  callId: "call",
  head: "main",
  title: "Run tests",
  mode: "foreground",
  state: "running",
  startedAt: 1,
  updatedAt: 1,
  output: "test output",
};

describe("job controls", () => {
  test("foreground work can background or cancel; background work can only cancel", () => {
    expect(jobControls(job)).toEqual({ background: true, cancel: true });
    expect(jobControls({ ...job, mode: "background" })).toEqual({
      background: false,
      cancel: true,
    });
  });

  test.each(["completed", "failed", "cancelled", "interrupted"] as const)(
    "%s output remains inspectable without mutation controls",
    (state) => {
      const finished = { ...job, state };
      expect(jobControls(finished)).toEqual({ background: false, cancel: false });
    },
  );

  test("a job event alone never makes the foreground composer busy", () => {
    const folded = foldEvent(stateFromSnapshot(idleSnapshot), {
      kind: "job",
      seq: 1,
      job: { ...job, mode: "background" },
    });
    expect(folded.kind).toBe("state");
    if (folded.kind !== "state") return;
    expect(projectLive(IDLE, folded.state.overlay, folded.state.run)).toBe(IDLE);
  });

  test("action receipts distinguish applied, missing, and finished work", () => {
    expect(jobActionMessage({ kind: "applied" }, "background")).toBe("Running in background.");
    expect(jobActionMessage({ kind: "applied" }, "cancel")).toBe("Cancellation requested.");
    expect(jobActionMessage({ kind: "not_found" }, "cancel")).toBe(
      "This task is no longer available.",
    );
    expect(jobActionMessage({ kind: "finished" }, "background")).toContain("already finished");
  });
});
