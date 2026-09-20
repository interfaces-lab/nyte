import assert from "node:assert/strict";
import { describe, test } from "vitest";
import type { RunInfo, RunPhase, SessionEvent } from "@nyte-ai/protocol";
import { EMPTY_LIVE_PARTS, foldLiveParts } from "@nyte-ai/client";
import type { LiveParts } from "@nyte-ai/client";
import { IDLE, livePartKey, liveRun, projectLive } from "./live-fold.ts";

const RUN = "run-1";

function run(phase: RunPhase, runId = RUN): RunInfo {
  return {
    runId,
    head: "main",
    origin: { kind: "user" },
    root: runId,
    phase,
    startedAt: 1_000,
    attempts: 1,
    config: {},
  };
}

function textDelta(seq: number, attempt: number, index: number, delta: string): SessionEvent {
  return { seq, kind: "text_delta", runId: RUN, attempt, index, delta };
}

function reasoningDelta(seq: number, attempt: number, index: number, delta: string): SessionEvent {
  return { seq, kind: "reasoning_delta", runId: RUN, attempt, index, delta };
}

function progress(callId: string, value: string): SessionEvent {
  return { seq: 1, kind: "tool_progress", runId: RUN, callId, progress: { text: value } };
}

function parts(events: readonly SessionEvent[], from: LiveParts = EMPTY_LIVE_PARTS): LiveParts {
  return events.reduce((current, event) => foldLiveParts(current, event), from);
}

describe("live projection: streaming lookups", () => {
  test("keys deltas by run, attempt, and index in arrival order", () => {
    const snapshot = projectLive(
      IDLE,
      parts([
        reasoningDelta(1, 1, 0, "hm"),
        textDelta(2, 1, 1, "Hel"),
        textDelta(3, 1, 1, "lo"),
        textDelta(4, 2, 0, "again"),
      ]),
      run({ kind: "respond" }),
    );

    assert.equal(snapshot.runState, "working");
    assert.equal(snapshot.thinking.get(livePartKey(RUN, 1, 0)), "hm");
    assert.equal(snapshot.text.get(livePartKey(RUN, 1, 1)), "Hello");
    assert.equal(snapshot.text.get(livePartKey(RUN, 2, 0)), "again");
    assert.deepEqual(
      snapshot.order.map((ref) => [ref.kind, ref.attempt, ref.index]),
      [
        ["thinking", 1, 0],
        ["text", 1, 1],
        ["text", 2, 0],
      ],
    );
  });

  test("tool progress is keyed by call and kept by identity across text frames", () => {
    const first = projectLive(IDLE, parts([progress("c1", "reading")]), run({ kind: "tools" }));
    assert.deepEqual(first.tools.get("c1"), { runId: RUN, progress: { text: "reading" } });

    const second = projectLive(
      first,
      parts([textDelta(2, 1, 0, "x")], first.parts),
      run({ kind: "tools" }),
    );
    assert.equal(second.tools, first.tools);
    assert.notEqual(second.order, first.order);
    assert.equal(second.text.get(livePartKey(RUN, 1, 0)), "x");

    const third = projectLive(
      second,
      parts([textDelta(3, 1, 0, "y")], second.parts),
      run({ kind: "tools" }),
    );
    assert.equal(third.tools, second.tools);
    assert.equal(third.order, second.order);
    assert.equal(third.text.get(livePartKey(RUN, 1, 0)), "xy");
  });

  test("the same overlay and run project to the same snapshot", () => {
    const streaming = projectLive(
      IDLE,
      parts([textDelta(1, 1, 0, "Hello")]),
      run({ kind: "respond" }),
    );
    assert.equal(projectLive(streaming, streaming.parts, run({ kind: "respond" })), streaming);
    assert.equal(projectLive(IDLE, EMPTY_LIVE_PARTS, undefined), IDLE);
  });

  test("projection reads no tool display value the frame did not change", () => {
    let progressReads = 0;
    const value = { text: "working" };
    const initial: LiveParts = Array.from({ length: 50 }, (_, index) => ({
      kind: "tool",
      runId: RUN,
      callId: `call-${String(index)}`,
      get progress() {
        progressReads += 1;
        return value;
      },
    }));
    const events = Array.from({ length: 100 }, () => textDelta(1, 1, 0, "x"));
    const overlay = parts(events, initial);
    assert.equal(progressReads, 0);
    const displayed = projectLive(IDLE, overlay, run({ kind: "respond" }));
    assert.equal(displayed.text.get(livePartKey(RUN, 1, 0)), "x".repeat(100));
    assert.equal(displayed.tools.size, 50);
    assert.deepEqual(
      [...displayed.tools.values()].map((tool) => tool.progress),
      Array.from({ length: 50 }, () => value),
    );
  });
});

describe("live projection: run phases", () => {
  test("respond and tools are working; waiting, terminal phases, and no run are idle", () => {
    assert.equal(liveRun(run({ kind: "respond" })).runState, "working");
    assert.equal(liveRun(run({ kind: "tools" })).runState, "working");
    assert.equal(liveRun(run({ kind: "waiting" })).runState, "idle");
    assert.equal(liveRun(run({ kind: "done" })).runState, "idle");
    assert.equal(liveRun(run({ kind: "aborted" })).runState, "idle");
    assert.equal(
      liveRun(run({ kind: "failed", failure: { class: "provider", message: "boom" } })).runState,
      "idle",
    );
    assert.equal(liveRun(undefined).runState, "idle");
  });

  test("retry carries its time and error, and a phase change alone replaces the snapshot", () => {
    const streaming = projectLive(
      IDLE,
      parts([textDelta(1, 1, 0, "partial")]),
      run({ kind: "respond" }),
    );
    const retrying = projectLive(
      streaming,
      streaming.parts,
      run({
        kind: "retry",
        at: 5_000,
        retries: 1,
        failure: { class: "rate_limit", message: "429" },
      }),
    );
    assert.notEqual(retrying, streaming);
    assert.equal(retrying.runState, "retrying");
    assert.deepEqual(retrying.retry, { at: 5_000, message: "429" });
    assert.equal(retrying.text, streaming.text);
    assert.equal(retrying.order, streaming.order);

    const resumed = projectLive(retrying, retrying.parts, run({ kind: "respond" }));
    assert.equal(resumed.runState, "working");
    assert.equal(resumed.retry, undefined);
  });
});
