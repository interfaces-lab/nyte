import { describe, expect, test } from "vitest";
import type { JobInfo } from "@nyte-ai/core";
import { jobActionMessage, jobControls } from "./jobs-view.ts";
import { foldState, IDLE } from "../live-fold.ts";

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
    expect(
      foldState(IDLE, { kind: "job", seq: 1, job: { ...job, mode: "background" } }).snapshot,
    ).toBe(IDLE);
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
