import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "vitest";
import { createGitVcs } from "../src/git.ts";
import type { VcsSnapshot } from "@nyte-ai/protocol";

const roots: string[] = [];

function gitIn(root: string) {
  return (...args: readonly string[]) =>
    execFileSync("git", [...args], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Nyte",
        GIT_AUTHOR_EMAIL: "nyte@example.com",
        GIT_COMMITTER_NAME: "Nyte",
        GIT_COMMITTER_EMAIL: "nyte@example.com",
      },
    });
}

async function emptyRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "nyte-vcs-"));
  roots.push(root);
  gitIn(root)("init", "--initial-branch=main");
  return root;
}

async function repository(): Promise<string> {
  const root = await emptyRepository();
  const git = gitIn(root);
  git("config", "user.name", "Nyte");
  git("config", "user.email", "nyte@example.com");
  git("config", "commit.gpgsign", "false");
  await writeFile(join(root, "tracked.txt"), "one\ntwo\n");
  git("add", ".");
  git("commit", "-m", "initial");
  return root;
}

/** A bare repository on disk. Nothing in these tests reaches a network remote. */
async function bareRemote(): Promise<string> {
  const remote = await mkdtemp(join(tmpdir(), "nyte-vcs-remote-"));
  roots.push(remote);
  execFileSync("git", ["init", "--bare", "--initial-branch=main", remote]);
  return remote;
}

/** Records what would go to the OS trash; no test may reach the real one. */
function trashRecorder() {
  const trashed: string[] = [];
  return {
    trashed,
    discard: async (absolute: string) => {
      trashed.push(absolute);
      await rm(absolute, { recursive: true, force: true });
    },
  };
}

function vcsAt(root: string, options?: Parameters<typeof createGitVcs>[1]) {
  const backend = createGitVcs(root, options);
  const cwd = root;
  return {
    snapshot: () => backend.snapshot({ cwd }),
    repository: async (): Promise<Extract<VcsSnapshot, { kind: "repository" }>> => {
      const snapshot = await backend.snapshot({ cwd });
      assert.equal(snapshot.kind, "repository");
      if (snapshot.kind !== "repository") throw new Error("unreachable");
      return snapshot;
    },
    diff: (input: Omit<Parameters<typeof backend.diff>[0], "cwd">) =>
      backend.diff({ cwd, ...input }),
    contents: (input: Omit<Parameters<typeof backend.contents>[0], "cwd">) =>
      backend.contents({ cwd, ...input }),
    log: (input: Omit<Parameters<typeof backend.log>[0], "cwd">) => backend.log({ cwd, ...input }),
    refs: () => backend.refs({ cwd }),
    stage: (input: Omit<Parameters<typeof backend.stage>[0], "cwd">) =>
      backend.stage({ cwd, ...input }),
    discard: (input: Omit<Parameters<typeof backend.discard>[0], "cwd">) =>
      backend.discard({ cwd, ...input }),
    commit: (input: Omit<Parameters<typeof backend.commit>[0], "cwd">) =>
      backend.commit({ cwd, ...input }),
    createBranch: (input: Omit<Parameters<typeof backend.createBranch>[0], "cwd">) =>
      backend.createBranch({ cwd, ...input }),
    push: (input: Omit<Parameters<typeof backend.push>[0], "cwd">) =>
      backend.push({ cwd, ...input }),
  };
}

const WORKTREE = { kind: "worktree" } as const;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("snapshot", () => {
  test("splits one file's staged and unstaged changes and reports head", async () => {
    const root = await repository();
    await writeFile(join(root, "tracked.txt"), "staged\n");
    gitIn(root)("add", "tracked.txt");
    await writeFile(join(root, "tracked.txt"), "working\n");
    await writeFile(join(root, "new.txt"), "fresh\n");

    const snapshot = await vcsAt(root).repository();

    assert.equal(snapshot.root, await realpath(root));
    assert.deepEqual(snapshot.staged, [{ path: "tracked.txt", kind: "modified" }]);
    assert.deepEqual(snapshot.unstaged, [
      { path: "tracked.txt", kind: "modified" },
      { path: "new.txt", kind: "untracked" },
    ]);
    assert.deepEqual(snapshot.head.branch, { kind: "named", name: "main", upstream: null });
    assert.equal(snapshot.head.base, null);
    assert.match(snapshot.head.oid ?? "", /^[0-9a-f]{40}$/);
  });

  test("reports a null head oid on an unborn HEAD", async () => {
    const root = await emptyRepository();
    await writeFile(join(root, "first.txt"), "hello\n");
    gitIn(root)("add", "first.txt");

    const snapshot = await vcsAt(root).repository();

    assert.equal(snapshot.head.oid, null);
    assert.deepEqual(snapshot.head.branch, { kind: "named", name: "main", upstream: null });
    assert.deepEqual(snapshot.staged, [{ path: "first.txt", kind: "added" }]);
    assert.deepEqual(snapshot.unstaged, []);
  });

  test("answers none outside a repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "nyte-vcs-plain-"));
    roots.push(root);

    assert.deepEqual(await vcsAt(root).snapshot(), { kind: "none" });
  });

  test("reports a staged rename with its old path", async () => {
    const root = await repository();
    gitIn(root)("mv", "tracked.txt", "moved.txt");

    const snapshot = await vcsAt(root).repository();

    assert.deepEqual(snapshot.staged, [
      { path: "moved.txt", kind: "renamed", from: "tracked.txt" },
    ]);
  });

  test("reports a merge conflict as conflicted", async () => {
    const root = await repository();
    const git = gitIn(root);
    git("checkout", "-b", "other");
    await writeFile(join(root, "tracked.txt"), "theirs\n");
    git("commit", "-am", "theirs");
    git("checkout", "main");
    await writeFile(join(root, "tracked.txt"), "mine\n");
    git("commit", "-am", "mine");
    assert.throws(() => git("merge", "other"));

    const snapshot = await vcsAt(root).repository();

    assert.deepEqual(snapshot.unstaged, [{ path: "tracked.txt", kind: "conflicted" }]);
  });

  test("infers the review base from the branch's reflog, else the remote default", async () => {
    const root = await repository();
    const git = gitIn(root);
    git("checkout", "-b", "feature");
    assert.deepEqual((await vcsAt(root).repository()).head.base, {
      name: "main",
      source: "reflog",
    });

    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    git("checkout", "--orphan", "rootless");
    assert.deepEqual((await vcsAt(root).repository()).head.base, {
      name: "origin/main",
      source: "default",
    });

    git("checkout", "main");
    assert.equal((await vcsAt(root).repository()).head.base, null);
  });

  test("detached HEAD carries no branch and no base", async () => {
    const root = await repository();
    gitIn(root)("checkout", "--detach");

    const snapshot = await vcsAt(root).repository();

    assert.deepEqual(snapshot.head.branch, { kind: "detached" });
    assert.equal(snapshot.head.base, null);
  });
});

describe("contents", () => {
  test("returns committed and working-tree sides for a modified file", async () => {
    const root = await repository();
    await writeFile(join(root, "tracked.txt"), "one\ntwo\nthree\n");

    const result = await vcsAt(root).contents({ path: "tracked.txt", scope: WORKTREE });

    assert.deepEqual(result, {
      path: "tracked.txt",
      old: "one\ntwo\n",
      new: "one\ntwo\nthree\n",
      binary: false,
      truncated: false,
    });
  });

  test("reads the staged side for the unstaged scope", async () => {
    const root = await repository();
    await writeFile(join(root, "tracked.txt"), "staged\n");
    gitIn(root)("add", "tracked.txt");
    await writeFile(join(root, "tracked.txt"), "working\n");

    const result = await vcsAt(root).contents({ path: "tracked.txt", scope: { kind: "unstaged" } });

    assert.equal(result.old, "staged\n");
    assert.equal(result.new, "working\n");
  });

  test("reports a missing base blob as a null old side instead of failing", async () => {
    const root = await repository();
    await writeFile(join(root, "added.txt"), "new file\n");

    const result = await vcsAt(root).contents({ path: "added.txt", scope: WORKTREE });

    assert.equal(result.old, null);
    assert.equal(result.new, "new file\n");
  });

  test("reports a deleted working-tree file as a null new side", async () => {
    const root = await repository();
    await rm(join(root, "tracked.txt"));

    const result = await vcsAt(root).contents({ path: "tracked.txt", scope: WORKTREE });

    assert.equal(result.old, "one\ntwo\n");
    assert.equal(result.new, null);
  });

  test("flags binary files and withholds their contents", async () => {
    const root = await repository();
    await writeFile(join(root, "image.bin"), Buffer.from([0x89, 0x00, 0x01, 0x02]));

    const result = await vcsAt(root).contents({ path: "image.bin", scope: WORKTREE });

    assert.equal(result.binary, true);
    assert.equal(result.new, "");
    assert.equal(result.truncated, false);
  });

  test("trims a side past the preview cap and flags it truncated", async () => {
    const root = await repository();
    await writeFile(join(root, "big.txt"), "a".repeat(2_000_050));

    const result = await vcsAt(root).contents({ path: "big.txt", scope: WORKTREE });

    assert.equal(result.truncated, true);
    assert.equal(result.new?.length, 2_000_000);
  });

  test("reads both sides of one commit", async () => {
    const root = await repository();
    await writeFile(join(root, "tracked.txt"), "three\n");
    gitIn(root)("commit", "-am", "second");
    const oid = gitIn(root)("rev-parse", "HEAD").trim();

    const result = await vcsAt(root).contents({
      path: "tracked.txt",
      scope: { kind: "commit", oid },
    });

    assert.equal(result.old, "one\ntwo\n");
    assert.equal(result.new, "three\n");
  });

  test("refuses a path outside the workspace", async () => {
    const root = await repository();

    await assert.rejects(
      vcsAt(root).contents({ path: "../escape.txt", scope: WORKTREE }),
      /outside the workspace/,
    );
  });
});

describe("diff", () => {
  test("separates staged from unstaged for the same file and counts lines", async () => {
    const root = await repository();
    await writeFile(join(root, "tracked.txt"), "one\ntwo\nstaged\n");
    gitIn(root)("add", "tracked.txt");
    await writeFile(join(root, "tracked.txt"), "one\ntwo\nstaged\nworking\n");
    const vcs = vcsAt(root);

    const [staged, unstaged] = await Promise.all([
      vcs.diff({ scope: { kind: "staged" } }),
      vcs.diff({ scope: { kind: "unstaged" } }),
    ]);

    assert.equal(staged.length, 1);
    assert.equal(staged[0]?.kind, "modified");
    assert.equal(staged[0]?.added, 1);
    assert.equal(staged[0]?.removed, 0);
    assert.match(staged[0]?.patch ?? "", /\+staged/);
    assert.doesNotMatch(staged[0]?.patch ?? "", /\+working/);
    assert.match(unstaged[0]?.patch ?? "", /\+working/);
    assert.doesNotMatch(unstaged[0]?.patch ?? "", /\+staged/);
  });

  test("worktree keeps the whole change since HEAD", async () => {
    const root = await repository();
    await writeFile(join(root, "tracked.txt"), "one\ntwo\nstaged\n");
    gitIn(root)("add", "tracked.txt");
    await writeFile(join(root, "tracked.txt"), "one\ntwo\nstaged\nworking\n");

    const diffs = await vcsAt(root).diff({ scope: WORKTREE });

    assert.equal(diffs[0]?.added, 2);
    assert.match(diffs[0]?.patch ?? "", /\+staged/);
    assert.match(diffs[0]?.patch ?? "", /\+working/);
  });

  test("unstaged synthesizes a patch for an untracked file", async () => {
    const root = await repository();
    await writeFile(join(root, "new.txt"), "fresh\n");

    const diffs = await vcsAt(root).diff({ scope: { kind: "unstaged" } });

    assert.equal(diffs.length, 1);
    assert.equal(diffs[0]?.kind, "untracked");
    assert.match(diffs[0]?.patch ?? "", /\+fresh/);
  });

  test("ignoreWhitespace drops an indentation-only change", async () => {
    const root = await repository();
    await writeFile(join(root, "tracked.txt"), "  one\n  two\n");
    const vcs = vcsAt(root);

    assert.equal((await vcs.diff({ scope: { kind: "unstaged" } })).length, 1);
    assert.deepEqual(await vcs.diff({ scope: { kind: "unstaged" }, ignoreWhitespace: true }), []);
  });

  test("commit scope reads one commit, narrowed to paths, with renames", async () => {
    const root = await repository();
    const git = gitIn(root);
    git("mv", "tracked.txt", "moved.txt");
    await writeFile(join(root, "other.txt"), "other\n");
    git("add", ".");
    git("commit", "-m", "second");
    const oid = git("rev-parse", "HEAD").trim();

    const whole = await vcsAt(root).diff({ scope: { kind: "commit", oid } });
    const narrowed = await vcsAt(root).diff({
      scope: { kind: "commit", oid },
      paths: ["other.txt"],
    });

    assert.deepEqual(whole.map((diff) => `${diff.path} ${diff.kind}`).toSorted(), [
      "moved.txt renamed",
      "other.txt added",
    ]);
    assert.deepEqual(
      narrowed.map((diff) => diff.path),
      ["other.txt"],
    );
    assert.match(narrowed[0]?.patch ?? "", /\+other/);
  });

  test("branch scope compares the worktree with the merge base", async () => {
    const root = await repository();
    const git = gitIn(root);
    git("checkout", "-b", "feature");
    await writeFile(join(root, "feature.txt"), "on the branch\n");
    git("add", ".");
    git("commit", "-m", "branch work");
    git("checkout", "main");
    await writeFile(join(root, "tracked.txt"), "main moved on\n");
    git("commit", "-am", "main work");
    git("checkout", "feature");
    await writeFile(join(root, "scratch.txt"), "untracked\n");

    const diffs = await vcsAt(root).diff({ scope: { kind: "branch", base: "main" } });

    assert.deepEqual(diffs.map((diff) => `${diff.path} ${diff.kind}`).toSorted(), [
      "feature.txt added",
      "scratch.txt untracked",
    ]);
  });

  test("staged answers on an unborn HEAD", async () => {
    const root = await emptyRepository();
    await writeFile(join(root, "first.txt"), "hello\n");
    gitIn(root)("add", "first.txt");

    const diffs = await vcsAt(root).diff({ scope: { kind: "staged" } });

    assert.deepEqual(
      diffs.map((diff) => diff.path),
      ["first.txt"],
    );
    assert.match(diffs[0]?.patch ?? "", /\+hello/);
  });

  test("refuses a path outside the workspace and a commit that is not a revision", async () => {
    const vcs = vcsAt(await repository());

    await assert.rejects(
      vcs.diff({ scope: { kind: "staged" }, paths: ["../escape.txt"] }),
      /outside the workspace/,
    );
    await assert.rejects(
      vcs.diff({ scope: { kind: "commit", oid: "--output=/tmp/pwned" } }),
      /Not a usable revision/,
    );
  });
});

describe("log and refs", () => {
  test("pages history newest first and reports more", async () => {
    const root = await repository();
    const git = gitIn(root);
    await writeFile(join(root, "tracked.txt"), "one\ntwo\nthree\n");
    git("commit", "-am", "second");
    await writeFile(join(root, "tracked.txt"), "one\ntwo\nthree\nfour\n");
    git("commit", "-am", "third");
    const vcs = vcsAt(root);

    const first = await vcs.log({ limit: 2 });
    const next = await vcs.log({ limit: 2, before: first.commits[1]?.oid ?? "HEAD" });

    assert.deepEqual(
      first.commits.map((commit) => commit.subject),
      ["third", "second"],
    );
    assert.equal(first.hasMore, true);
    assert.deepEqual(
      next.commits.map((commit) => commit.subject),
      ["initial"],
    );
    assert.equal(next.hasMore, false);
    const newest = first.commits[0];
    assert.equal(newest?.author, "Nyte");
    assert.match(newest?.oid ?? "", /^[0-9a-f]{40}$/);
    assert.ok((newest?.committedAt ?? 0) > 1_600_000_000_000);
  });

  test("an unborn HEAD has no commits", async () => {
    const root = await emptyRepository();

    assert.deepEqual(await vcsAt(root).log({ limit: 10 }), { commits: [], hasMore: false });
  });

  test("lists local and remote branches without the remote HEAD pointer", async () => {
    const root = await repository();
    const git = gitIn(root);
    git("branch", "feature");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");

    assert.deepEqual(await vcsAt(root).refs(), {
      local: ["feature", "main"],
      remote: ["origin/main"],
    });
  });
});

describe("discard", () => {
  test("restores a tracked file in both the index and the worktree", async () => {
    const root = await repository();
    const git = gitIn(root);
    await writeFile(join(root, "tracked.txt"), "staged\n");
    git("add", "tracked.txt");
    await writeFile(join(root, "tracked.txt"), "working\n");
    const trash = trashRecorder();

    const result = await vcsAt(root, trash).discard({ paths: ["tracked.txt"] });

    assert.deepEqual(result, { kind: "applied", paths: ["tracked.txt"], skipped: [] });
    assert.equal(await readFile(join(root, "tracked.txt"), "utf8"), "one\ntwo\n");
    const snapshot = await vcsAt(root, trash).repository();
    assert.deepEqual([snapshot.staged, snapshot.unstaged], [[], []]);
    assert.deepEqual(trash.trashed, []);
  });

  test("brings a deleted tracked file back", async () => {
    const root = await repository();
    await rm(join(root, "tracked.txt"));

    const result = await vcsAt(root, trashRecorder()).discard({ paths: ["tracked.txt"] });

    assert.equal(result.kind, "applied");
    assert.equal(await readFile(join(root, "tracked.txt"), "utf8"), "one\ntwo\n");
  });

  test("moves an untracked file to the trash instead of deleting it", async () => {
    const root = await repository();
    await writeFile(join(root, "scratch.txt"), "untracked\n");
    const trash = trashRecorder();

    const result = await vcsAt(root, trash).discard({ paths: ["scratch.txt"] });

    assert.deepEqual(result, { kind: "applied", paths: ["scratch.txt"], skipped: [] });
    assert.deepEqual(trash.trashed, [join(root, "scratch.txt")]);
  });

  test("skips a path the status does not report, with a reason and no error", async () => {
    const root = await repository();
    await writeFile(join(root, "scratch.txt"), "untracked\n");

    const result = await vcsAt(root, trashRecorder()).discard({
      paths: ["tracked.txt", "missing.txt", "scratch.txt"],
    });

    assert.deepEqual(result, {
      kind: "applied",
      paths: ["scratch.txt"],
      skipped: [
        { path: "tracked.txt", reason: "This file has no changes to discard." },
        { path: "missing.txt", reason: "This file has no changes to discard." },
      ],
    });
  });

  test("a failing discard skips its own path and leaves the rest of the batch applied", async () => {
    const root = await repository();
    await writeFile(join(root, "tracked.txt"), "changed\n");
    await writeFile(join(root, "scratch.txt"), "untracked\n");

    const result = await vcsAt(root, {
      discard: () => Promise.reject(new Error("Trash is unavailable")),
    }).discard({ paths: ["scratch.txt", "tracked.txt"] });

    assert.deepEqual(result, {
      kind: "applied",
      paths: ["tracked.txt"],
      skipped: [{ path: "scratch.txt", reason: "Trash is unavailable" }],
    });
    assert.equal(await readFile(join(root, "scratch.txt"), "utf8"), "untracked\n");
    assert.equal(await readFile(join(root, "tracked.txt"), "utf8"), "one\ntwo\n");
  });

  test("refuses a path outside the workspace before touching anything", async () => {
    const root = await repository();
    await writeFile(join(root, "tracked.txt"), "changed\n");
    const trash = trashRecorder();

    const result = await vcsAt(root, trash).discard({ paths: ["tracked.txt", "../escape.txt"] });

    assert.equal(result.kind, "failed");
    assert.equal(await readFile(join(root, "tracked.txt"), "utf8"), "changed\n");
    assert.deepEqual(trash.trashed, []);
  });
});

describe("stage", () => {
  test("stages an untracked file and unstages it again", async () => {
    const root = await repository();
    await writeFile(join(root, "scratch.txt"), "untracked\n");
    const vcs = vcsAt(root);

    assert.deepEqual(await vcs.stage({ paths: ["scratch.txt"], staged: true }), {
      kind: "applied",
      paths: ["scratch.txt"],
      skipped: [],
    });
    assert.deepEqual((await vcs.repository()).staged, [{ path: "scratch.txt", kind: "added" }]);

    assert.deepEqual(await vcs.stage({ paths: ["scratch.txt"], staged: false }), {
      kind: "applied",
      paths: ["scratch.txt"],
      skipped: [],
    });
    assert.deepEqual((await vcs.repository()).staged, []);
    assert.equal(await readFile(join(root, "scratch.txt"), "utf8"), "untracked\n");
  });

  test("unstages before the first commit, where there is no HEAD to restore from", async () => {
    const root = await emptyRepository();
    await writeFile(join(root, "first.txt"), "one\n");
    const vcs = vcsAt(root);
    await vcs.stage({ paths: ["first.txt"], staged: true });

    const result = await vcs.stage({ paths: ["first.txt"], staged: false });

    assert.deepEqual(result, { kind: "applied", paths: ["first.txt"], skipped: [] });
    assert.deepEqual((await vcs.repository()).staged, []);
    assert.equal(await readFile(join(root, "first.txt"), "utf8"), "one\n");
  });

  test("skips a path git refuses and stages the rest of the batch", async () => {
    const root = await repository();
    await writeFile(join(root, "scratch.txt"), "untracked\n");

    const result = await vcsAt(root).stage({ paths: ["missing.txt", "scratch.txt"], staged: true });

    assert.equal(result.kind, "applied");
    if (result.kind !== "applied") return;
    assert.deepEqual(result.paths, ["scratch.txt"]);
    assert.equal(result.skipped[0]?.path, "missing.txt");
    assert.match(result.skipped[0]?.reason ?? "", /did not match any files/);
  });

  test("refuses a path outside the workspace before touching the index", async () => {
    const root = await repository();
    await writeFile(join(root, "scratch.txt"), "untracked\n");

    const result = await vcsAt(root).stage({
      paths: ["scratch.txt", "../escape.txt"],
      staged: true,
    });

    assert.equal(result.kind, "failed");
    assert.deepEqual((await vcsAt(root).repository()).staged, []);
  });
});

describe("commit", () => {
  test("commits the index and reports the new commit", async () => {
    const root = await repository();
    await writeFile(join(root, "tracked.txt"), "changed\n");
    const vcs = vcsAt(root);
    await vcs.stage({ paths: ["tracked.txt"], staged: true });

    const result = await vcs.commit({
      message: "feat: change it\n\nwith a body",
      target: { kind: "staged" },
    });

    assert.equal(result.kind, "committed");
    if (result.kind !== "committed") return;
    assert.equal(result.summary, "feat: change it");
    assert.equal(result.oid.length, 40);
    assert.deepEqual((await vcs.repository()).unstaged, []);
    assert.equal((await vcs.log({ limit: 1 })).commits[0]?.oid, result.oid);
  });

  test("passes a message that looks like an option as an argument, not a flag", async () => {
    const root = await repository();
    await writeFile(join(root, "tracked.txt"), "changed\n");
    const vcs = vcsAt(root);

    const result = await vcs.commit({
      message: "--amend $(touch pwned) `id`",
      target: { kind: "all" },
    });

    assert.equal(result.kind, "committed");
    const log = await vcs.log({ limit: 2 });
    assert.equal(log.commits[0]?.subject, "--amend $(touch pwned) `id`");
    assert.equal(log.commits.length, 2);
  });

  test("commits every tracked change with all, leaving untracked files alone", async () => {
    const root = await repository();
    await writeFile(join(root, "tracked.txt"), "changed\n");
    await writeFile(join(root, "scratch.txt"), "untracked\n");

    const result = await vcsAt(root).commit({ message: "all", target: { kind: "all" } });

    assert.equal(result.kind, "committed");
    assert.deepEqual((await vcsAt(root).repository()).unstaged, [
      { path: "scratch.txt", kind: "untracked" },
    ]);
  });

  test("commits only the named paths", async () => {
    const root = await repository();
    await writeFile(join(root, "tracked.txt"), "changed\n");
    await writeFile(join(root, "other.txt"), "other\n");
    const vcs = vcsAt(root);
    await vcs.stage({ paths: ["other.txt"], staged: true });

    const result = await vcs.commit({
      message: "only one",
      target: { kind: "paths", paths: ["tracked.txt"] },
    });

    assert.equal(result.kind, "committed");
    assert.deepEqual((await vcs.repository()).staged, [{ path: "other.txt", kind: "added" }]);
  });

  test("answers nothing_to_commit on a clean tree", async () => {
    const root = await repository();

    assert.deepEqual(await vcsAt(root).commit({ message: "empty", target: { kind: "staged" } }), {
      kind: "nothing_to_commit",
    });
  });

  test("reports a rejecting hook as failed with git's own words", async () => {
    const root = await repository();
    await writeFile(join(root, ".git", "hooks", "pre-commit"), "#!/bin/sh\necho no >&2\nexit 1\n", {
      mode: 0o755,
    });
    await writeFile(join(root, "tracked.txt"), "changed\n");

    const result = await vcsAt(root).commit({ message: "blocked", target: { kind: "all" } });

    assert.deepEqual(result, { kind: "failed", reason: "no" });
    assert.equal((await vcsAt(root).log({ limit: 5 })).commits.length, 1);
  });

  test("refuses a path outside the workspace", async () => {
    const root = await repository();

    const result = await vcsAt(root).commit({
      message: "escape",
      target: { kind: "paths", paths: ["../escape.txt"] },
    });

    assert.equal(result.kind, "failed");
  });
});

describe("createBranch", () => {
  test("creates a branch without moving HEAD, or checks it out when asked", async () => {
    const root = await repository();
    const vcs = vcsAt(root);

    assert.deepEqual(await vcs.createBranch({ name: "feature/one", checkout: false }), {
      kind: "created",
    });
    assert.deepEqual((await vcs.repository()).head.branch, {
      kind: "named",
      name: "main",
      upstream: null,
    });
    assert.ok((await vcs.refs()).local.includes("feature/one"));

    assert.deepEqual(await vcs.createBranch({ name: "feature/two", checkout: true }), {
      kind: "created",
    });
    assert.deepEqual((await vcs.repository()).head.branch, {
      kind: "named",
      name: "feature/two",
      upstream: null,
    });
  });

  test("answers exists for a branch that is already there", async () => {
    const root = await repository();

    assert.deepEqual(await vcsAt(root).createBranch({ name: "main", checkout: false }), {
      kind: "exists",
    });
  });

  test.each(["bad name", "feature..one", "-force", "refs/heads/", "head~1"])(
    "rejects the name %j as invalid",
    async (name) => {
      const root = await repository();

      const result = await vcsAt(root).createBranch({ name, checkout: true });

      assert.equal(result.kind, "invalid_name");
      assert.deepEqual((await vcsAt(root).repository()).head.branch, {
        kind: "named",
        name: "main",
        upstream: null,
      });
    },
  );
});

describe("push", () => {
  test("answers no_upstream for a branch that tracks nothing", async () => {
    const root = await repository();
    const remote = await bareRemote();
    gitIn(root)("remote", "add", "origin", remote);

    assert.deepEqual(await vcsAt(root).push({ setUpstream: false }), {
      kind: "no_upstream",
      branch: "main",
    });
    assert.equal(execFileSync("git", ["branch", "-a"], { cwd: remote, encoding: "utf8" }), "");
  });

  test("publishes the branch with setUpstream against the single remote", async () => {
    const root = await repository();
    const remote = await bareRemote();
    const git = gitIn(root);
    git("remote", "add", "origin", remote);

    const result = await vcsAt(root).push({ setUpstream: true });

    assert.deepEqual(result, { kind: "pushed", remote: "origin", branch: "main" });
    assert.equal(git("config", "--get", "branch.main.remote").trim(), "origin");
    assert.deepEqual((await vcsAt(root).repository()).head.branch, {
      kind: "named",
      name: "main",
      upstream: { name: "origin/main", ahead: 0, behind: 0 },
    });
  });

  test("answers up_to_date when the remote already has the branch tip", async () => {
    const root = await repository();
    const remote = await bareRemote();
    gitIn(root)("remote", "add", "origin", remote);
    await vcsAt(root).push({ setUpstream: true });

    assert.deepEqual(await vcsAt(root).push({ setUpstream: false }), { kind: "up_to_date" });
  });

  test("answers rejected instead of forcing when the remote has moved on", async () => {
    const root = await repository();
    const remote = await bareRemote();
    const git = gitIn(root);
    git("remote", "add", "origin", remote);
    await vcsAt(root).push({ setUpstream: true });

    const other = await mkdtemp(join(tmpdir(), "nyte-vcs-other-"));
    roots.push(other);
    execFileSync("git", ["clone", remote, other]);
    const otherGit = gitIn(other);
    otherGit("config", "user.name", "Other");
    otherGit("config", "user.email", "other@example.com");
    await writeFile(join(other, "tracked.txt"), "theirs\n");
    otherGit("commit", "--all", "-m", "theirs");
    otherGit("push");

    await writeFile(join(root, "tracked.txt"), "mine\n");
    await vcsAt(root).commit({ message: "mine", target: { kind: "all" } });
    const result = await vcsAt(root).push({ setUpstream: false });

    assert.equal(result.kind, "rejected");
    assert.equal(
      execFileSync("git", ["log", "-1", "--format=%s", "main"], {
        cwd: remote,
        encoding: "utf8",
      }).trim(),
      "theirs",
    );
  });

  test("never pushes from a detached HEAD", async () => {
    const root = await repository();
    const remote = await bareRemote();
    const git = gitIn(root);
    git("remote", "add", "origin", remote);
    await vcsAt(root).push({ setUpstream: true });
    git("checkout", "--detach");

    const result = await vcsAt(root).push({ setUpstream: true });

    assert.equal(result.kind, "failed");
    assert.match(result.kind === "failed" ? result.reason : "", /detached/);
  });

  test("names the remotes instead of guessing when several are configured", async () => {
    const root = await repository();
    const first = await bareRemote();
    const second = await bareRemote();
    const git = gitIn(root);
    git("remote", "add", "origin", first);
    git("remote", "add", "backup", second);

    const result = await vcsAt(root).push({ setUpstream: true });

    assert.equal(result.kind, "failed");
    assert.match(result.kind === "failed" ? result.reason : "", /backup, origin/);
    assert.equal(execFileSync("git", ["branch"], { cwd: first, encoding: "utf8" }), "");
    assert.equal(execFileSync("git", ["branch"], { cwd: second, encoding: "utf8" }), "");
  });
});
