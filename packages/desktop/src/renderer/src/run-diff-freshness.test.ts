import assert from "node:assert/strict";
import { test } from "vitest";
import { sessionId } from "@nyte-ai/protocol";
import { RunDiffFreshness } from "./run-diff-freshness.ts";

test("a provisional live diff is refreshed once after the run becomes terminal", () => {
  const freshness = new RunDiffFreshness();
  const session = sessionId("session");
  const run = "run";
  const recorded = { kind: "recorded", files: [] } as const;

  assert.equal(freshness.needsRefresh(session, run, false, recorded), true);
  assert.equal(freshness.needsRefresh(session, run, true, recorded), true);

  freshness.recordCheck(session, run, true, recorded);

  assert.equal(freshness.needsRefresh(session, run, true, recorded), false);
});

test("a missing tree pair stays stale until one terminal check completes", () => {
  const freshness = new RunDiffFreshness();
  const session = sessionId("session");
  const run = "run";
  const missing = { kind: "not_found" } as const;

  assert.equal(freshness.needsRefresh(session, run, true, missing), true);
  freshness.recordCheck(session, run, true, missing);
  assert.equal(freshness.needsRefresh(session, run, true, missing), false);
});
