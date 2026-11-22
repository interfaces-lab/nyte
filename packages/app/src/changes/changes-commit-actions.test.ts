import assert from "node:assert/strict";
import { test } from "vitest";
import { commitActions } from "./changes-commit-bar.tsx";
import { COMMIT_ACTIONS } from "./changes-view-options.ts";

test("a host without GitHub is offered every action except the two that open a pull request", () => {
  const withheld = COMMIT_ACTIONS.filter((action) => !commitActions(false).includes(action));

  assert.deepEqual(withheld, ["commit-pull-request", "pull-request"]);
});
