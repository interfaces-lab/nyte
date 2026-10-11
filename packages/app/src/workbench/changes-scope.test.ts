import assert from "node:assert/strict";
import { asId } from "@nyte-ai/schema";
import { test } from "vitest";
import { vcsRequestForScope } from "./change-scopes.ts";

test("each scope requests the corresponding Git comparison", () => {
  assert.deepEqual(vcsRequestForScope({ kind: "uncommitted" }), { kind: "worktree" });
  assert.deepEqual(vcsRequestForScope({ kind: "staged" }), { kind: "staged" });
  assert.deepEqual(vcsRequestForScope({ kind: "unstaged" }), { kind: "unstaged" });
  assert.deepEqual(vcsRequestForScope({ kind: "commit", oid: "c0ffee" }), {
    kind: "commit",
    commit: "c0ffee",
  });
  assert.equal(vcsRequestForScope({ kind: "turn", turnId: asId<"turn">("turn-1") }), undefined);
});
