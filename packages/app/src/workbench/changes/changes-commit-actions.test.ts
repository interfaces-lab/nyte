import assert from "node:assert/strict";
import { test } from "vitest";
import { COMMIT_ACTIONS, commitActions } from "./changes-commit-bar.tsx";

test("a host without GitHub is offered every action except the two that open a pull request", () => {
  const withheld = COMMIT_ACTIONS.filter((action) => !commitActions(false).includes(action));

  assert.deepEqual(withheld, ["commit-pull-request", "pull-request"]);
});
