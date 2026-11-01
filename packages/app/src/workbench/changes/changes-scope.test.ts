import assert from "node:assert/strict";
import type { ChangeSet, GitStatus } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { test } from "vitest";
import { changesSummary, vcsRequestForScope } from "./change-scopes.ts";
import { changeTotals, workingRows } from "./changes-model.ts";

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

test("the Changes rail row totals the Uncommitted diff, untracked files included", () => {
  const edited: Repository = {
    ...clean,
    staged: [{ path: "a.ts", status: "modified", added: 10, removed: 2 }],
    untracked: ["new.ts"],
  };

  const manifest: ChangeSet = {
    revision: asId<"git-revision">("r2"),
    files: [
      { path: "a.ts", status: "modified", stat: { kind: "text", added: 10, removed: 2 } },
      { path: "new.ts", status: "untracked", stat: { kind: "text", added: 30, removed: 0 } },
    ],
  };

  const summary = (repository: Repository, read: ChangeSet | undefined) =>
    changesSummary(changeTotals(workingRows(repository, { kind: "uncommitted" }), read));

  assert.deepEqual(summary(edited, manifest), {
    label: "Changes",
    changed: true,
    added: 40,
    removed: 2,
  });
  assert.equal(summary(edited, undefined).label, "2 changed files");
  assert.deepEqual(summary(clean, manifest), {
    label: "No changes",
    changed: false,
    added: 0,
    removed: 0,
  });
});
