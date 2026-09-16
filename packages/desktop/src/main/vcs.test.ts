import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "vitest";
import { CALL_INPUT_SCHEMAS } from "./ipc-inputs.ts";
import { createGitVcs } from "./vcs.ts";

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
  await writeFile(join(root, "tracked.txt"), "one\ntwo\n");
  git("add", ".");
  git("commit", "-m", "initial");
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("vcs contents", () => {
  test("returns committed and working-tree sides for a modified file", async () => {
    const root = await repository();
    await writeFile(join(root, "tracked.txt"), "one\ntwo\nthree\n");

    const result = await createGitVcs(root).contents({ path: "tracked.txt", base: "head" });

    assert.deepEqual(result, {
      path: "tracked.txt",
      old: { contents: "one\ntwo\n" },
      new: { contents: "one\ntwo\nthree\n" },
      binary: false,
      truncated: false,
    });
  });

  test("reads the staged side for base index", async () => {
    const root = await repository();
    await writeFile(join(root, "tracked.txt"), "staged\n");
    execFileSync("git", ["add", "tracked.txt"], { cwd: root });
    await writeFile(join(root, "tracked.txt"), "working\n");

    const result = await createGitVcs(root).contents({ path: "tracked.txt", base: "index" });

    assert.deepEqual(result.old, { contents: "staged\n" });
    assert.deepEqual(result.new, { contents: "working\n" });
  });

  test("reports a missing base blob as a null old side instead of failing", async () => {
    const root = await repository();
    await writeFile(join(root, "added.txt"), "new file\n");

    const result = await createGitVcs(root).contents({ path: "added.txt", base: "head" });

    assert.equal(result.old, null);
    assert.deepEqual(result.new, { contents: "new file\n" });
  });

  test("reports a deleted working-tree file as a null new side", async () => {
    const root = await repository();
    await rm(join(root, "tracked.txt"));

    const result = await createGitVcs(root).contents({ path: "tracked.txt", base: "head" });

    assert.deepEqual(result.old, { contents: "one\ntwo\n" });
    assert.equal(result.new, null);
  });

  test("both sides are null for a path that exists nowhere", async () => {
    const root = await repository();

    const result = await createGitVcs(root).contents({ path: "absent.txt", base: "head" });

    assert.deepEqual(result, {
      path: "absent.txt",
      old: null,
      new: null,
      binary: false,
      truncated: false,
    });
  });

  test("flags binary files and withholds their contents", async () => {
    const root = await repository();
    await writeFile(join(root, "image.bin"), Buffer.from([0x89, 0x00, 0x01, 0x02]));

    const result = await createGitVcs(root).contents({ path: "image.bin", base: "head" });

    assert.equal(result.binary, true);
    assert.deepEqual(result.new, { contents: "" });
    assert.equal(result.truncated, false);
  });

  test("trims a side past the preview cap and flags it truncated", async () => {
    const root = await repository();
    await writeFile(join(root, "big.txt"), "a".repeat(2_000_050));

    const result = await createGitVcs(root).contents({ path: "big.txt", base: "head" });

    assert.equal(result.truncated, true);
    assert.equal(result.new?.contents.length, 2_000_000);
  });

  test("refuses a path outside the workspace", async () => {
    const root = await repository();

    await assert.rejects(
      createGitVcs(root).contents({ path: "../escape.txt", base: "head" }),
      /outside the workspace/,
    );
  });
});

describe("vcs snapshot", () => {
  test("splits one file's staged and unstaged changes and reports head", async () => {
    const root = await repository();
    await writeFile(join(root, "tracked.txt"), "staged\n");
    gitIn(root)("add", "tracked.txt");
    await writeFile(join(root, "tracked.txt"), "working\n");
    await writeFile(join(root, "new.txt"), "fresh\n");

    const snapshot = await createGitVcs(root).snapshot();

    assert.equal(snapshot.kind, "repository");
    assert.deepEqual(snapshot.staged, [{ path: "tracked.txt", kind: "modified" }]);
    assert.deepEqual(snapshot.unstaged, [
      { path: "tracked.txt", kind: "modified" },
      { path: "new.txt", kind: "untracked" },
    ]);
    assert.equal(snapshot.head.branch, "main");
    assert.equal(snapshot.head.ahead, 0);
    assert.equal(snapshot.head.behind, 0);
    assert.match(snapshot.head.oid ?? "", /^[0-9a-f]{40}$/);
    // The whole-tree view the existing panel reads stays unchanged.
    assert.deepEqual(snapshot.status, {
      branch: "main",
      files: [
        { path: "tracked.txt", kind: "modified" },
        { path: "new.txt", kind: "untracked" },
      ],
    });
  });

  test("reports a null head oid on an unborn HEAD", async () => {
    const root = await emptyRepository();
    await writeFile(join(root, "first.txt"), "hello\n");
    gitIn(root)("add", "first.txt");

    const snapshot = await createGitVcs(root).snapshot();

    assert.equal(snapshot.head.oid, null);
    assert.equal(snapshot.head.branch, "main");
    assert.deepEqual(snapshot.staged, [{ path: "first.txt", kind: "added" }]);
    assert.deepEqual(snapshot.unstaged, []);
  });

  test("answers outside a repository without a head", async () => {
    const root = await mkdtemp(join(tmpdir(), "nyte-vcs-plain-"));
    roots.push(root);

    const snapshot = await createGitVcs(root).snapshot();

    assert.equal(snapshot.kind, "not_repository");
    assert.deepEqual(snapshot.head, { oid: null, ahead: 0, behind: 0 });
    assert.deepEqual(snapshot.staged, []);
    assert.deepEqual(snapshot.unstaged, []);
  });
});

describe("vcs scoped diff", () => {
  test("separates staged from unstaged for the same file", async () => {
    const root = await repository();
    await writeFile(join(root, "tracked.txt"), "one\ntwo\nstaged\n");
    gitIn(root)("add", "tracked.txt");
    await writeFile(join(root, "tracked.txt"), "one\ntwo\nstaged\nworking\n");
    const vcs = createGitVcs(root);

    const [staged, unstaged] = await Promise.all([
      vcs.scopedDiff({ scope: "staged" }),
      vcs.scopedDiff({ scope: "unstaged" }),
    ]);

    assert.deepEqual(
      staged.map((diff) => diff.path),
      ["tracked.txt"],
    );
    assert.match(staged[0]?.patch ?? "", /\+staged/);
    assert.doesNotMatch(staged[0]?.patch ?? "", /\+working/);
    assert.deepEqual(
      unstaged.map((diff) => diff.path),
      ["tracked.txt"],
    );
    assert.match(unstaged[0]?.patch ?? "", /\+working/);
    assert.doesNotMatch(unstaged[0]?.patch ?? "", /\+staged/);
  });

  test("worktree keeps the whole change since HEAD", async () => {
    const root = await repository();
    await writeFile(join(root, "tracked.txt"), "one\ntwo\nstaged\n");
    gitIn(root)("add", "tracked.txt");
    await writeFile(join(root, "tracked.txt"), "one\ntwo\nstaged\nworking\n");

    const diffs = await createGitVcs(root).scopedDiff({ scope: "worktree" });

    assert.match(diffs[0]?.patch ?? "", /\+staged/);
    assert.match(diffs[0]?.patch ?? "", /\+working/);
  });

  test("unstaged synthesizes a patch for an untracked file", async () => {
    const root = await repository();
    await writeFile(join(root, "new.txt"), "fresh\n");

    const diffs = await createGitVcs(root).scopedDiff({ scope: "unstaged" });

    assert.deepEqual(
      diffs.map((diff) => diff.path),
      ["new.txt"],
    );
    assert.match(diffs[0]?.patch ?? "", /\+fresh/);
  });

  test("ignoreWhitespace drops an indentation-only change", async () => {
    const root = await repository();
    await writeFile(join(root, "tracked.txt"), "  one\n  two\n");
    const vcs = createGitVcs(root);

    assert.equal((await vcs.scopedDiff({ scope: "unstaged" })).length, 1);
    assert.deepEqual(await vcs.scopedDiff({ scope: "unstaged", ignoreWhitespace: true }), []);
  });

  test("commit scope reads one commit, narrowed to paths", async () => {
    const root = await repository();
    const git = gitIn(root);
    await writeFile(join(root, "tracked.txt"), "one\ntwo\nthree\n");
    await writeFile(join(root, "other.txt"), "other\n");
    git("add", ".");
    git("commit", "-m", "second");
    const oid = git("rev-parse", "HEAD").trim();

    const whole = await createGitVcs(root).scopedDiff({ scope: "commit", commit: oid });
    const narrowed = await createGitVcs(root).scopedDiff({
      scope: "commit",
      commit: oid,
      paths: ["other.txt"],
    });

    assert.deepEqual(whole.map((diff) => diff.path).sort(), ["other.txt", "tracked.txt"]);
    assert.deepEqual(
      narrowed.map((diff) => diff.path),
      ["other.txt"],
    );
    assert.match(narrowed[0]?.patch ?? "", /\+other/);
  });

  test("staged answers on an unborn HEAD", async () => {
    const root = await emptyRepository();
    await writeFile(join(root, "first.txt"), "hello\n");
    gitIn(root)("add", "first.txt");

    const diffs = await createGitVcs(root).scopedDiff({ scope: "staged" });

    assert.deepEqual(
      diffs.map((diff) => diff.path),
      ["first.txt"],
    );
    assert.match(diffs[0]?.patch ?? "", /\+hello/);
  });

  test("refuses a path outside the workspace and a commit that is not a revision", async () => {
    const vcs = createGitVcs(await repository());

    await assert.rejects(
      vcs.scopedDiff({ scope: "staged", paths: ["../escape.txt"] }),
      /outside the workspace/,
    );
    await assert.rejects(
      vcs.scopedDiff({ scope: "commit", commit: "--output=/tmp/pwned" }),
      /Not a usable revision/,
    );
  });
});

describe("vcs log and refs", () => {
  test("pages history newest first and reports more", async () => {
    const root = await repository();
    const git = gitIn(root);
    await writeFile(join(root, "tracked.txt"), "one\ntwo\nthree\n");
    git("commit", "-am", "second");
    await writeFile(join(root, "tracked.txt"), "one\ntwo\nthree\nfour\n");
    git("commit", "-am", "third");
    const vcs = createGitVcs(root);

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
    assert.ok((newest?.oid ?? "").startsWith(newest?.shortOid ?? "x"));
    assert.ok((newest?.committedAt ?? 0) > 1_600_000_000_000);
  });

  test("an unborn HEAD has no commits", async () => {
    const root = await emptyRepository();

    assert.deepEqual(await createGitVcs(root).log({ limit: 10 }), {
      commits: [],
      hasMore: false,
    });
  });

  test("lists local and remote branches with the current one", async () => {
    const root = await repository();
    const git = gitIn(root);
    git("branch", "feature");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");

    const refs = await createGitVcs(root).refs();

    assert.deepEqual(refs, {
      current: "main",
      local: ["feature", "main"],
      remote: ["origin/main"],
    });
  });

  test("a detached HEAD has no current branch", async () => {
    const root = await repository();
    const git = gitIn(root);
    git("checkout", "--detach");

    const refs = await createGitVcs(root).refs();

    assert.equal(refs.current, undefined);
    assert.deepEqual(refs.local, ["main"]);
  });
});

describe("vcs revert", () => {
  /** Records what would go to the OS trash; no test may reach the real one. */
  function trashRecorder() {
    const trashed: string[] = [];
    return {
      trashed,
      trashItem: async (absolute: string) => {
        trashed.push(absolute);
        await rm(absolute, { recursive: true, force: true });
      },
    };
  }

  test("restores a tracked file in both the index and the worktree", async () => {
    const root = await repository();
    const git = gitIn(root);
    await writeFile(join(root, "tracked.txt"), "staged\n");
    git("add", "tracked.txt");
    await writeFile(join(root, "tracked.txt"), "working\n");
    const trash = trashRecorder();

    const result = await createGitVcs(root, trash).revert({ paths: ["tracked.txt"] });

    assert.deepEqual(result, { reverted: ["tracked.txt"], skipped: [] });
    assert.equal(await readFile(join(root, "tracked.txt"), "utf8"), "one\ntwo\n");
    assert.deepEqual((await createGitVcs(root, trash).snapshot()).status.files, []);
    assert.deepEqual(trash.trashed, []);
  });

  test("brings a deleted tracked file back", async () => {
    const root = await repository();
    await rm(join(root, "tracked.txt"));
    const trash = trashRecorder();

    const result = await createGitVcs(root, trash).revert({ paths: ["tracked.txt"] });

    assert.deepEqual(result.reverted, ["tracked.txt"]);
    assert.equal(await readFile(join(root, "tracked.txt"), "utf8"), "one\ntwo\n");
  });

  test("moves an untracked file to the trash instead of deleting it", async () => {
    const root = await repository();
    await writeFile(join(root, "scratch.txt"), "untracked\n");
    const trash = trashRecorder();

    const result = await createGitVcs(root, trash).revert({ paths: ["scratch.txt"] });

    assert.deepEqual(result, { reverted: ["scratch.txt"], skipped: [] });
    assert.deepEqual(trash.trashed, [join(root, "scratch.txt")]);
  });

  test("skips a path the status does not report, with a reason and no error", async () => {
    const root = await repository();
    await writeFile(join(root, "scratch.txt"), "untracked\n");
    const trash = trashRecorder();

    const result = await createGitVcs(root, trash).revert({
      paths: ["tracked.txt", "missing.txt", "scratch.txt"],
    });

    assert.deepEqual(result.reverted, ["scratch.txt"]);
    assert.deepEqual(result.skipped, [
      { path: "tracked.txt", reason: "This file has no changes to revert." },
      { path: "missing.txt", reason: "This file has no changes to revert." },
    ]);
  });

  test("a failing revert skips its own path and leaves the rest of the batch reverted", async () => {
    const root = await repository();
    await writeFile(join(root, "tracked.txt"), "changed\n");
    await writeFile(join(root, "scratch.txt"), "untracked\n");

    const result = await createGitVcs(root, {
      trashItem: () => Promise.reject(new Error("Trash is unavailable")),
    }).revert({ paths: ["scratch.txt", "tracked.txt"] });

    assert.deepEqual(result.reverted, ["tracked.txt"]);
    assert.deepEqual(result.skipped, [{ path: "scratch.txt", reason: "Trash is unavailable" }]);
    assert.equal(await readFile(join(root, "scratch.txt"), "utf8"), "untracked\n");
    assert.equal(await readFile(join(root, "tracked.txt"), "utf8"), "one\ntwo\n");
  });

  test("refuses a path outside the workspace before touching anything", async () => {
    const root = await repository();
    await writeFile(join(root, "tracked.txt"), "changed\n");
    const trash = trashRecorder();

    await assert.rejects(
      createGitVcs(root, trash).revert({ paths: ["tracked.txt", "../escape.txt"] }),
      /outside the workspace/,
    );
    assert.equal(await readFile(join(root, "tracked.txt"), "utf8"), "changed\n");
    assert.deepEqual(trash.trashed, []);
  });
});

/** A repository the backend itself commits into, so identity never comes from the machine. */
async function writableRepository(): Promise<string> {
  const root = await repository();
  const git = gitIn(root);
  git("config", "user.name", "Nyte");
  git("config", "user.email", "nyte@example.com");
  git("config", "commit.gpgsign", "false");
  return root;
}

/** A bare repository on disk. Nothing in these tests reaches a network remote. */
async function bareRemote(): Promise<string> {
  const remote = await mkdtemp(join(tmpdir(), "nyte-vcs-remote-"));
  roots.push(remote);
  execFileSync("git", ["init", "--bare", "--initial-branch=main", remote]);
  return remote;
}

describe("vcs stage", () => {
  test("stages an untracked file and unstages it again", async () => {
    const root = await repository();
    await writeFile(join(root, "scratch.txt"), "untracked\n");
    const vcs = createGitVcs(root);

    const staged = await vcs.stage({ paths: ["scratch.txt"], staged: true });

    assert.deepEqual(staged, { staged: ["scratch.txt"], skipped: [] });
    assert.deepEqual((await vcs.snapshot()).staged, [{ path: "scratch.txt", kind: "added" }]);

    const unstaged = await vcs.stage({ paths: ["scratch.txt"], staged: false });

    assert.deepEqual(unstaged, { staged: ["scratch.txt"], skipped: [] });
    assert.deepEqual((await vcs.snapshot()).staged, []);
    assert.equal(await readFile(join(root, "scratch.txt"), "utf8"), "untracked\n");
  });

  test("unstages before the first commit, where there is no HEAD to restore from", async () => {
    const root = await emptyRepository();
    await writeFile(join(root, "first.txt"), "one\n");
    const vcs = createGitVcs(root);
    await vcs.stage({ paths: ["first.txt"], staged: true });

    const result = await vcs.stage({ paths: ["first.txt"], staged: false });

    assert.deepEqual(result, { staged: ["first.txt"], skipped: [] });
    assert.deepEqual((await vcs.snapshot()).staged, []);
    assert.equal(await readFile(join(root, "first.txt"), "utf8"), "one\n");
  });

  test("skips a path git refuses and stages the rest of the batch", async () => {
    const root = await repository();
    await writeFile(join(root, "scratch.txt"), "untracked\n");

    const result = await createGitVcs(root).stage({
      paths: ["missing.txt", "scratch.txt"],
      staged: true,
    });

    assert.deepEqual(result.staged, ["scratch.txt"]);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0]?.path, "missing.txt");
    assert.match(result.skipped[0]?.reason ?? "", /did not match any files/);
  });

  test("refuses a path outside the workspace before touching the index", async () => {
    const root = await repository();
    await writeFile(join(root, "scratch.txt"), "untracked\n");

    await assert.rejects(
      createGitVcs(root).stage({ paths: ["scratch.txt", "../escape.txt"], staged: true }),
      /outside the workspace/,
    );
    assert.deepEqual((await createGitVcs(root).snapshot()).staged, []);
  });
});

describe("vcs commit", () => {
  test("commits the index and reports the new commit", async () => {
    const root = await writableRepository();
    await writeFile(join(root, "tracked.txt"), "changed\n");
    const vcs = createGitVcs(root);
    await vcs.stage({ paths: ["tracked.txt"], staged: true });

    const result = await vcs.commit({ message: "feat: change it\n\nwith a body" });

    assert.equal(result.kind, "committed");
    if (result.kind !== "committed") return;
    assert.equal(result.summary, "feat: change it");
    assert.equal(result.oid.length, 40);
    assert.ok(result.oid.startsWith(result.shortOid));
    assert.deepEqual((await vcs.snapshot()).status.files, []);
    assert.equal((await vcs.log({ limit: 1 })).commits[0]?.oid, result.oid);
  });

  test("passes a message that looks like an option as an argument, not a flag", async () => {
    const root = await writableRepository();
    await writeFile(join(root, "tracked.txt"), "changed\n");
    const vcs = createGitVcs(root);

    const result = await vcs.commit({ message: "--amend $(touch pwned) `id`", all: true });

    assert.equal(result.kind, "committed");
    assert.equal((await vcs.log({ limit: 2 })).commits[0]?.subject, "--amend $(touch pwned) `id`");
    assert.equal((await vcs.log({ limit: 2 })).commits.length, 2);
    assert.deepEqual((await createGitVcs(root).snapshot()).status.files, []);
  });

  test("commits every tracked change with all, leaving untracked files alone", async () => {
    const root = await writableRepository();
    await writeFile(join(root, "tracked.txt"), "changed\n");
    await writeFile(join(root, "scratch.txt"), "untracked\n");

    const result = await createGitVcs(root).commit({ message: "all", all: true });

    assert.equal(result.kind, "committed");
    assert.deepEqual((await createGitVcs(root).snapshot()).status.files, [
      { path: "scratch.txt", kind: "untracked" },
    ]);
  });

  test("commits only the named paths", async () => {
    const root = await writableRepository();
    await writeFile(join(root, "tracked.txt"), "changed\n");
    await writeFile(join(root, "other.txt"), "other\n");
    const vcs = createGitVcs(root);
    await vcs.stage({ paths: ["other.txt"], staged: true });

    const result = await vcs.commit({ message: "only one", paths: ["tracked.txt"] });

    assert.equal(result.kind, "committed");
    assert.deepEqual((await vcs.snapshot()).staged, [{ path: "other.txt", kind: "added" }]);
  });

  test("answers nothing_to_commit on a clean tree", async () => {
    const root = await writableRepository();

    assert.deepEqual(await createGitVcs(root).commit({ message: "empty" }), {
      kind: "nothing_to_commit",
    });
  });

  test("refuses a whitespace-only message before running git", async () => {
    const root = await writableRepository();
    await writeFile(join(root, "tracked.txt"), "changed\n");
    const vcs = createGitVcs(root);
    await vcs.stage({ paths: ["tracked.txt"], staged: true });

    const result = await vcs.commit({ message: "  \n\t " });

    assert.deepEqual(result, { kind: "failed", reason: "Write a commit message first." });
    assert.deepEqual((await vcs.snapshot()).staged, [{ path: "tracked.txt", kind: "modified" }]);
  });

  test("reports a rejecting hook as failed with git's own words", async () => {
    const root = await writableRepository();
    await writeFile(join(root, ".git", "hooks", "pre-commit"), "#!/bin/sh\necho no >&2\nexit 1\n", {
      mode: 0o755,
    });
    await writeFile(join(root, "tracked.txt"), "changed\n");

    const result = await createGitVcs(root).commit({ message: "blocked", all: true });

    assert.equal(result.kind, "failed");
    assert.equal(result.kind === "failed" ? result.reason : "", "no");
    assert.equal((await createGitVcs(root).log({ limit: 5 })).commits.length, 1);
  });

  test("refuses a path outside the workspace", async () => {
    const root = await writableRepository();

    await assert.rejects(
      createGitVcs(root).commit({ message: "escape", paths: ["../escape.txt"] }),
      /outside the workspace/,
    );
  });
});

describe("vcs createBranch", () => {
  test("creates a branch without moving HEAD", async () => {
    const root = await writableRepository();
    const vcs = createGitVcs(root);

    assert.deepEqual(await vcs.createBranch({ name: "feature/one", checkout: false }), {
      kind: "created",
    });
    const refs = await vcs.refs();
    assert.equal(refs.current, "main");
    assert.ok(refs.local.includes("feature/one"));
  });

  test("checks the new branch out when asked", async () => {
    const root = await writableRepository();
    const vcs = createGitVcs(root);

    assert.deepEqual(await vcs.createBranch({ name: "feature/two", checkout: true }), {
      kind: "created",
    });
    assert.equal((await vcs.refs()).current, "feature/two");
  });

  test("answers exists for a branch that is already there", async () => {
    const root = await writableRepository();

    assert.deepEqual(await createGitVcs(root).createBranch({ name: "main", checkout: false }), {
      kind: "exists",
    });
  });

  test.each(["bad name", "feature..one", "-force", "refs/heads/", "head~1"])(
    "rejects the name %j as invalid",
    async (name) => {
      const root = await writableRepository();

      const result = await createGitVcs(root).createBranch({ name, checkout: true });

      assert.equal(result.kind, "invalid_name");
      assert.equal((await createGitVcs(root).refs()).current, "main");
    },
  );
});

describe("vcs push", () => {
  test("answers no_upstream for a branch that tracks nothing", async () => {
    const root = await writableRepository();
    const remote = await bareRemote();
    gitIn(root)("remote", "add", "origin", remote);

    assert.deepEqual(await createGitVcs(root).push({}), { kind: "no_upstream", branch: "main" });
    assert.equal(execFileSync("git", ["branch", "-a"], { cwd: remote, encoding: "utf8" }), "");
  });

  test("publishes the branch with setUpstream against the single remote", async () => {
    const root = await writableRepository();
    const remote = await bareRemote();
    const git = gitIn(root);
    git("remote", "add", "origin", remote);

    const result = await createGitVcs(root).push({ setUpstream: true });

    assert.deepEqual(result, { kind: "pushed", remote: "origin", branch: "main" });
    assert.equal(git("config", "--get", "branch.main.remote").trim(), "origin");
    assert.match(
      execFileSync("git", ["log", "-1", "--format=%s", "main"], { cwd: remote, encoding: "utf8" }),
      /initial/,
    );
  });

  test("answers up_to_date when the remote already has the branch tip", async () => {
    const root = await writableRepository();
    const remote = await bareRemote();
    gitIn(root)("remote", "add", "origin", remote);
    await createGitVcs(root).push({ setUpstream: true });

    assert.deepEqual(await createGitVcs(root).push({}), {
      kind: "up_to_date",
      remote: "origin",
      branch: "main",
    });
  });

  test("answers rejected instead of forcing when the remote has moved on", async () => {
    const root = await writableRepository();
    const remote = await bareRemote();
    const git = gitIn(root);
    git("remote", "add", "origin", remote);
    await createGitVcs(root).push({ setUpstream: true });

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
    await createGitVcs(root).commit({ message: "mine", all: true });
    const result = await createGitVcs(root).push({});

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
    const root = await writableRepository();
    const remote = await bareRemote();
    const git = gitIn(root);
    git("remote", "add", "origin", remote);
    await createGitVcs(root).push({ setUpstream: true });
    git("checkout", "--detach");

    const result = await createGitVcs(root).push({ setUpstream: true });

    assert.equal(result.kind, "failed");
    assert.match(result.kind === "failed" ? result.reason : "", /detached/);
  });

  test("names the remotes instead of guessing when several are configured", async () => {
    const root = await writableRepository();
    const first = await bareRemote();
    const second = await bareRemote();
    const git = gitIn(root);
    git("remote", "add", "origin", first);
    git("remote", "add", "backup", second);

    const result = await createGitVcs(root).push({ setUpstream: true });

    assert.equal(result.kind, "failed");
    assert.match(result.kind === "failed" ? result.reason : "", /backup, origin/);
    assert.equal(execFileSync("git", ["branch"], { cwd: first, encoding: "utf8" }), "");
    assert.equal(execFileSync("git", ["branch"], { cwd: second, encoding: "utf8" }), "");
  });
});

describe("vcs write route input", () => {
  test("refuses a commit message that is only whitespace", () => {
    assert.throws(() => CALL_INPUT_SCHEMAS["host.vcs.commit"].Parse({ message: " \t\n" }));
    assert.deepEqual(CALL_INPUT_SCHEMAS["host.vcs.commit"].Parse({ message: "feat: ok" }), {
      message: "feat: ok",
    });
  });

  test.each([
    ["host.vcs.stage", { paths: [], staged: true }],
    ["host.vcs.stage", { paths: ["a.txt"] }],
    ["host.vcs.stage", { paths: [""], staged: true }],
    ["host.vcs.commit", { message: "ok", force: true }],
    ["host.vcs.commit", { message: "ok", paths: "a.txt" }],
    ["host.vcs.createBranch", { name: "", checkout: true }],
    ["host.vcs.createBranch", { name: "feature" }],
    ["host.vcs.push", { setUpstream: "yes" }],
    ["host.vcs.push", { force: true }],
    ["host.vcs.createPullRequest", { title: "  " }],
    ["host.vcs.createPullRequest", { title: "t", draft: "yes" }],
  ] as const)("refuses %s input %j", (path, input) => {
    assert.throws(() => CALL_INPUT_SCHEMAS[path].Parse(input));
  });

  test.each([
    ["host.vcs.stage", { paths: ["a.txt"], staged: false }],
    ["host.vcs.commit", { message: "ok", all: true, paths: ["a.txt"] }],
    ["host.vcs.createBranch", { name: "feature/one", checkout: true }],
    ["host.vcs.push", {}],
    ["host.vcs.push", { setUpstream: true }],
    ["host.vcs.createPullRequest", { title: "t", body: "b", draft: true }],
  ] as const)("accepts %s input %j", (path, input) => {
    assert.deepEqual(CALL_INPUT_SCHEMAS[path].Parse(input), input);
  });
});
