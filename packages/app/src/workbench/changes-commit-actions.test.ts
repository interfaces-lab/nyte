import assert from "node:assert/strict";
import { test } from "vitest";
import { COMMIT_ACTIONS, commitActionPlan, commitActions } from "./changes-commit-bar.tsx";

test("a host without GitHub is offered no action that opens a pull request", () => {
  const offered = commitActions(false);

  assert.ok(offered.length > 0);
  assert.ok(offered.every((action) => !commitActionPlan(action).pullRequest));
  assert.deepEqual(commitActions(true), COMMIT_ACTIONS);
});
