import assert from "node:assert/strict";
import type { GitStatus } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { test } from "vitest";
import { changesSummary, vcsRequestForScope } from "./change-scopes.ts";

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

type Repository = Extract<GitStatus, { readonly kind: "repository" }>;

const clean: Repository = {
  kind: "repository",
  root: "/repo",
  head: asId<"git-commit">("abc1234"),
  branch: "main",
  upstream: null,
  revision: asId<"git-revision">("r1"),
  staged: [],
  unstaged: [],
  untracked: [],
  conflicts: [],
};

test("the Changes rail row shows the working tree's line totals", () => {
  const edited: Repository = {
    ...clean,
    staged: [{ path: "a.ts", status: "modified", added: 10, removed: 2 }],
    unstaged: [{ path: "b.ts", status: "modified", added: 2, removed: 1 }],
  };

  assert.deepEqual(changesSummary(edited), {
    label: "Changes",
    changed: true,
    added: 12,
    removed: 3,
  });
  assert.equal(changesSummary({ ...clean, untracked: ["new.ts"] }).label, "1 changed file");
  assert.equal(changesSummary(clean).label, "No changes");
});
