import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test, vi } from "vitest";
import { createGitVcs } from "../src/git.ts";
import { VCS_DIFF_PATHS_MAX } from "@nyte-ai/protocol";
import type { VcsDiff, VcsScope, VcsSnapshot } from "@nyte-ai/protocol";

const roots: string[] = [];

function testEnv(root: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (name.startsWith("GIT_") || value === undefined) continue;
    env[name] = value;
  }
  return {
    ...env,
    HOME: root,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: devNull,
    GIT_TERMINAL_PROMPT: "0",
  };
}

function gitIn(root: string) {
  return (...args: readonly string[]) =>
    execFileSync("git", [...args], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...testEnv(root),
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

/**
 * `repository()` plus a committed `sub/inside.txt`, for a workspace opened at
 * `sub`. Mutation locks and the host's own trash land under an isolated
 * `NYTE_HOME` outside the repository, never under the real one.
 */
async function nestedRepository(): Promise<{
  readonly root: string;
  readonly sub: string;
  readonly home: string;
}> {
  const root = await repository();
  const sub = join(root, "sub");
  await mkdir(sub);
  await writeFile(join(sub, "inside.txt"), "inside\n");
  gitIn(root)("add", ".");
  gitIn(root)("commit", "-m", "nested");
  const home = await mkdtemp(join(tmpdir(), "nyte-home-"));
  roots.push(home);
  vi.stubEnv("NYTE_HOME", home);
  return { root, sub, home };
}

/** A bare repository on disk. Nothing in these tests reaches a network remote. */
async function bareRemote(): Promise<string> {
  const remote = await mkdtemp(join(tmpdir(), "nyte-vcs-remote-"));
  roots.push(remote);
  execFileSync("git", ["init", "--bare", "--initial-branch=main", remote], {
    env: testEnv(remote),
  });
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

function vcsAt(root: string, options?: Parameters<typeof createGitVcs>[0]) {
  const backend = createGitVcs(options);
  const cwd = root;
  const repository = async (): Promise<Extract<VcsSnapshot, { kind: "repository" }>> => {
    const snapshot = await backend.snapshot({ cwd });
    assert.equal(snapshot.kind, "repository");
    if (snapshot.kind !== "repository") throw new Error("unreachable");
    return snapshot;
  };
  const expect = async () => ({ revision: (await repository()).revision });
  return {
    backend,
    snapshot: () => backend.snapshot({ cwd }),
    repository,
    changes: (input: { readonly scope: VcsScope; readonly ignoreWhitespace?: boolean }) =>
      backend.changes({
        cwd,
        scope: input.scope,
        ignoreWhitespace: input.ignoreWhitespace ?? false,
      }),
    /** Without `paths`, every file the scope's manifest reports, named explicitly. */
    diff: async (input: {
      readonly scope: VcsScope;
      readonly paths?: readonly string[];
      readonly ignoreWhitespace?: boolean;
    }) => {
      const ignoreWhitespace = input.ignoreWhitespace ?? false;

      const paths =
        input.paths ??
        (await backend.changes({ cwd, scope: input.scope, ignoreWhitespace })).map(
          (change) => change.path,
        );

      const diffs: VcsDiff[] = [];

      for (let start = 0; start < paths.length; start += VCS_DIFF_PATHS_MAX) {
        diffs.push(
          ...(await backend.diff({
            cwd,
            scope: input.scope,
            paths: paths.slice(start, start + VCS_DIFF_PATHS_MAX),
            ignoreWhitespace,
          })),
        );
      }

      return diffs;
    },
    contents: (input: Omit<Parameters<typeof backend.contents>[0], "cwd">) =>
      backend.contents({ cwd, ...input }),
    log: (input: Omit<Parameters<typeof backend.log>[0], "cwd">) => backend.log({ cwd, ...input }),
    refs: () => backend.refs({ cwd }),
    stage: async (input: Omit<Parameters<typeof backend.stage>[0], "cwd" | "expect">) =>
      backend.stage({ cwd, ...input, expect: await expect() }),
    discard: async (input: Omit<Parameters<typeof backend.discard>[0], "cwd" | "expect">) =>
      backend.discard({ cwd, ...input, expect: await expect() }),
    commit: async (input: Omit<Parameters<typeof backend.commit>[0], "cwd" | "expect">) =>
      backend.commit({ cwd, ...input, expect: await expect() }),
    createBranch: async (
      input: Omit<Parameters<typeof backend.createBranch>[0], "cwd" | "expect">,
    ) => backend.createBranch({ cwd, ...input, expect: await expect() }),
    push: async (input: Omit<Parameters<typeof backend.push>[0], "cwd" | "expect">) =>
      backend.push({ cwd, ...input, expect: await expect() }),
  };
}

const WORKTREE = { kind: "worktree" } as const;

function patchText(diff: VcsDiff | undefined): string {
  return diff === undefined || diff.kind === "too_large" || diff.kind === "failed"
    ? ""
    : diff.patch;
}

function attachedBranch(snapshot: Extract<VcsSnapshot, { kind: "repository" }>): string {
  assert.equal(snapshot.head.kind, "attached");
  if (snapshot.head.kind !== "attached") throw new Error("unreachable");
  return snapshot.head.branch;
}

afterEach(async () => {
  vi.unstubAllEnvs();
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
    assert.equal(snapshot.head.kind, "attached");
    if (snapshot.head.kind !== "attached") throw new Error("unreachable");
    assert.equal(snapshot.head.branch, "main");
    assert.equal(snapshot.head.upstream, null);
    assert.equal(snapshot.head.base, null);
    assert.match(snapshot.head.oid, /^[0-9a-f]{40}$/);
  });

  test("reports an unborn HEAD", async () => {
    const root = await emptyRepository();
    await writeFile(join(root, "first.txt"), "hello\n");
    gitIn(root)("add", "first.txt");

    const snapshot = await vcsAt(root).repository();

    assert.deepEqual(snapshot.head, { kind: "unborn", branch: "main" });
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

    assert.deepEqual(snapshot.staged, [{ path: "tracked.txt", kind: "conflicted" }]);
    assert.deepEqual(snapshot.unstaged, [{ path: "tracked.txt", kind: "conflicted" }]);
  });

  test("infers the review base from the branch's reflog, else the remote default", async () => {
    const root = await repository();
    const git = gitIn(root);
    git("checkout", "-b", "feature");
    git("branch", "--set-upstream-to=main", "feature");
    const feature = (await vcsAt(root).repository()).head;
    assert.equal(feature.kind, "attached");
    if (feature.kind !== "attached") throw new Error("unreachable");
    assert.deepEqual(feature.upstream, { name: "main", ahead: 0, behind: 0 });
    assert.deepEqual(feature.base, {
      name: git("rev-parse", "main").trim(),
      source: "reflog",
    });

    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    git("checkout", "--orphan", "rootless");
    git("commit", "--allow-empty", "-m", "rootless");
    const rootless = (await vcsAt(root).repository()).head;
    assert.equal(rootless.kind, "attached");
    if (rootless.kind !== "attached") throw new Error("unreachable");
    assert.deepEqual(rootless.base, {
      name: "origin/main",
      source: "default",
    });

    git("checkout", "main");
    const main = (await vcsAt(root).repository()).head;
    assert.equal(main.kind, "attached");
    if (main.kind !== "attached") throw new Error("unreachable");
    assert.equal(main.base, null);
  });

  test("ignores inherited git repository and index overrides", async () => {
    const root = await repository();
    const other = await repository();
    vi.stubEnv("GIT_DIR", join(other, ".git"));
    vi.stubEnv("GIT_WORK_TREE", other);
    vi.stubEnv("GIT_INDEX_FILE", join(other, ".git", "index"));
    vi.stubEnv("GIT_CONFIG_SYSTEM", join(other, "system-config"));

    const snapshot = await vcsAt(root).repository();

    assert.equal(snapshot.root, await realpath(root));
  });

  test("detached HEAD carries no branch and no base", async () => {
    const root = await repository();
    gitIn(root)("checkout", "--detach");

    const snapshot = await vcsAt(root).repository();

    assert.equal(snapshot.head.kind, "detached");
    if (snapshot.head.kind !== "detached") throw new Error("unreachable");
    assert.match(snapshot.head.oid, /^[0-9a-f]{40}$/);
  });
});

describe("contents", () => {
  test("returns committed and working-tree sides for a modified file", async () => {
    const root = await repository();
    await writeFile(join(root, "tracked.txt"), "one\ntwo\nthree\n");

    const result = await vcsAt(root).contents({ path: "tracked.txt", scope: WORKTREE });

    assert.deepEqual(result, {
      path: "tracked.txt",
      old: { kind: "text", text: "one\ntwo\n" },
      new: { kind: "text", text: "one\ntwo\nthree\n" },
    });
  });

  test("reads the staged side for the unstaged scope", async () => {
    const root = await repository();
    await writeFile(join(root, "tracked.txt"), "staged\n");
    gitIn(root)("add", "tracked.txt");
    await writeFile(join(root, "tracked.txt"), "working\n");

    const result = await vcsAt(root).contents({ path: "tracked.txt", scope: { kind: "unstaged" } });

    assert.deepEqual(result.old, { kind: "text", text: "staged\n" });
    assert.deepEqual(result.new, { kind: "text", text: "working\n" });
  });

  test("reports a missing base blob as an absent old side instead of failing", async () => {
    const root = await repository();
    await writeFile(join(root, "added.txt"), "new file\n");

    const result = await vcsAt(root).contents({ path: "added.txt", scope: WORKTREE });

    assert.deepEqual(result.old, { kind: "absent" });
    assert.deepEqual(result.new, { kind: "text", text: "new file\n" });
  });

  test("reports a deleted working-tree file as an absent new side", async () => {
    const root = await repository();
    await rm(join(root, "tracked.txt"));

    const result = await vcsAt(root).contents({ path: "tracked.txt", scope: WORKTREE });

    assert.deepEqual(result.old, { kind: "text", text: "one\ntwo\n" });
    assert.deepEqual(result.new, { kind: "absent" });
  });

  test("flags binary files and withholds their contents", async () => {
    const root = await repository();
    await writeFile(join(root, "image.bin"), Buffer.from([0x89, 0x00, 0x01, 0x02]));

    const result = await vcsAt(root).contents({ path: "image.bin", scope: WORKTREE });

    assert.deepEqual(result.new, { kind: "binary" });
  });

  test("uses git numstat attributes to classify binary data without a NUL", async () => {
    const root = await repository();
    await writeFile(join(root, ".gitattributes"), "*.dat binary\n");
    await writeFile(join(root, "payload.dat"), "printable bytes only\n");

    const result = await vcsAt(root).contents({ path: "payload.dat", scope: WORKTREE });

    assert.deepEqual(result.new, { kind: "binary" });
  });

  test("trims a side past the preview cap and flags it truncated", async () => {
    const root = await repository();
    await writeFile(join(root, "big.txt"), "a".repeat(2_000_050));

    const result = await vcsAt(root).contents({ path: "big.txt", scope: WORKTREE });

    assert.equal(result.new.kind, "truncated");
    if (result.new.kind !== "truncated") throw new Error("unreachable");
    assert.equal(result.new.head.length, 2_000_000);
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

    assert.deepEqual(result.old, { kind: "text", text: "one\ntwo\n" });
    assert.deepEqual(result.new, { kind: "text", text: "three\n" });
  });

  test("uses the branch merge base for content and binary classification", async () => {
    const root = await repository();
    const git = gitIn(root);
    git("checkout", "-b", "comparison");
    await writeFile(join(root, "tracked.txt"), Buffer.from([0x00, 0x01, 0x02]));
    git("commit", "-am", "binary on comparison");
    git("checkout", "main");
    await writeFile(join(root, "tracked.txt"), "one\ntwo\nthree\n");

    const result = await vcsAt(root).contents({
      path: "tracked.txt",
      scope: { kind: "branch", base: "comparison" },
    });

    assert.deepEqual(result.old, { kind: "text", text: "one\ntwo\n" });
    assert.deepEqual(result.new, { kind: "text", text: "one\ntwo\nthree\n" });
  });

  test("rethrows worktree filesystem errors instead of reporting a missing side", async () => {
    const root = await repository();
    const blocked = join(root, "blocked");
    await mkdir(blocked);
    await writeFile(join(blocked, "file.txt"), "blocked\n");
    await chmod(blocked, 0);
    try {
      await assert.rejects(
        vcsAt(root).contents({ path: "blocked/file.txt", scope: WORKTREE }),
        /permission denied|operation not permitted/i,
      );
    } finally {
      await chmod(blocked, 0o700);
    }
  });

  test("does not run repository fsmonitor or textconv helpers", async () => {
    const root = await repository();
    const marker = join(root, "helper-ran");
    const helper = join(root, "helper.sh");
    await writeFile(helper, `#!/bin/sh\ntouch '${marker}'\ncat "$1"\n`, { mode: 0o755 });
    const git = gitIn(root);
    git("config", "core.fsmonitor", helper);
    git("config", "diff.evil.textconv", helper);
    await writeFile(join(root, ".gitattributes"), "*.txt diff=evil\n");
    await writeFile(join(root, "tracked.txt"), "changed\n");

    await vcsAt(root).snapshot();
    await vcsAt(root).diff({ scope: WORKTREE });

    await assert.rejects(access(marker));
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
    const stagedDiff = staged[0];
    assert.equal(stagedDiff?.status, "modified");
    assert.equal(stagedDiff?.kind, "text");
    if (stagedDiff?.kind !== "text") throw new Error("unreachable");
    assert.equal(stagedDiff.added, 1);
    assert.equal(stagedDiff.removed, 0);
    assert.match(stagedDiff.patch, /\+staged/);
    assert.doesNotMatch(stagedDiff.patch, /\+working/);
    assert.match(patchText(unstaged[0]), /\+working/);
    assert.doesNotMatch(patchText(unstaged[0]), /\+staged/);
  });

  test("worktree keeps the whole change since HEAD", async () => {
    const root = await repository();
    await writeFile(join(root, "tracked.txt"), "one\ntwo\nstaged\n");
    gitIn(root)("add", "tracked.txt");
    await writeFile(join(root, "tracked.txt"), "one\ntwo\nstaged\nworking\n");

    const diffs = await vcsAt(root).diff({ scope: WORKTREE });

    const diff = diffs[0];
    assert.equal(diff?.kind, "text");
    if (diff?.kind !== "text") throw new Error("unreachable");
    assert.equal(diff.added, 2);
    assert.match(diff.patch, /\+staged/);
    assert.match(diff.patch, /\+working/);
  });

  test("a binary diff has a patch but no line counts", async () => {
    const root = await repository();
    const git = gitIn(root);
    await writeFile(join(root, "image.bin"), new Uint8Array([0, 1, 2]));
    git("add", "image.bin");
    git("commit", "-m", "binary");
    await writeFile(join(root, "image.bin"), new Uint8Array([0, 3, 4]));

    const diffs = await vcsAt(root).diff({ scope: WORKTREE });

    assert.equal(diffs.length, 1);
    const diff = diffs[0];
    assert.equal(diff?.path, "image.bin");
    assert.equal(diff?.status, "modified");
    assert.equal(diff?.kind, "binary");
    if (diff?.kind !== "binary") throw new Error("unreachable");
    assert.match(diff.patch, /Binary files/);
  });

  test("unstaged synthesizes a patch for an untracked file", async () => {
    const root = await repository();
    await writeFile(join(root, "new.txt"), "fresh\n");

    const diffs = await vcsAt(root).diff({ scope: { kind: "unstaged" } });

    assert.equal(diffs.length, 1);
    assert.equal(diffs[0]?.status, "untracked");
    assert.match(patchText(diffs[0]), /\+fresh/);
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

    assert.deepEqual(whole.map((diff) => `${diff.path} ${diff.status}`).toSorted(), [
      "moved.txt renamed",
      "other.txt added",
    ]);
    assert.deepEqual(
      narrowed.map((diff) => diff.path),
      ["other.txt"],
    );
    assert.match(patchText(narrowed[0]), /\+other/);
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

    assert.deepEqual(diffs.map((diff) => `${diff.path} ${diff.status}`).toSorted(), [
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
    assert.match(patchText(diffs[0]), /\+hello/);
  });

  test("matches a literal pathspec that looks like magic", async () => {
    const root = await repository();
    await writeFile(join(root, ":(glob)*.txt"), "literal\n");
    await writeFile(join(root, "other.txt"), "other\n");

    const diffs = await vcsAt(root).diff({
      scope: WORKTREE,
      paths: [":(glob)*.txt"],
    });

    assert.deepEqual(
      diffs.map((item) => item.path),
      [":(glob)*.txt"],
    );
  });
});

/**
 * A `git` first on PATH that logs every call, and for patch reads (the only
 * calls carrying `--no-color`) logs when the real process starts and when it
 * has exited, so overlapping lines in the log are overlapping processes.
 * `NYTE_GIT_FLOOD` swaps a patch read for endless output.
 */
async function loggingGit(): Promise<{
  readonly log: string;
  readonly events: () => Promise<readonly string[]>;
}> {
  const bin = await mkdtemp(join(tmpdir(), "nyte-git-bin-"));
  roots.push(bin);
  const log = join(bin, "calls.log");
  const real = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  await writeFile(log, "");
  await writeFile(
    join(bin, "git"),
    [
      "#!/bin/sh",
      'echo call >> "$NYTE_GIT_LOG"',
      'case " $* " in *" --no-color "*) ;; *) exec "$NYTE_REAL_GIT" "$@" ;; esac',
      'echo start >> "$NYTE_GIT_LOG"',
      "trap 'kill $child 2>/dev/null; wait $child 2>/dev/null; echo end >> \"$NYTE_GIT_LOG\"; exit 143' TERM",
      "sleep 0.1 & child=$!; wait $child",
      'if [ -n "$NYTE_GIT_FLOOD" ]; then yes +flood & child=$!; else "$NYTE_REAL_GIT" "$@" & child=$!; fi',
      "wait $child; status=$?",
      'echo end >> "$NYTE_GIT_LOG"',
      "exit $status",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  vi.stubEnv("PATH", `${bin}:${process.env.PATH ?? ""}`);
  vi.stubEnv("NYTE_REAL_GIT", real);
  vi.stubEnv("NYTE_GIT_LOG", log);

  return {
    log,
    events: async () => (await readFile(log, "utf8")).split("\n").filter((line) => line !== ""),
  };
}

/** The most patch processes alive at once, and how many were still alive at the end. */
function patchProcesses(events: readonly string[]): {
  readonly peak: number;
  readonly left: number;
} {
  let active = 0;
  let peak = 0;

  for (const event of events) {
    if (event === "start") active += 1;
    if (event === "end") active -= 1;
    peak = Math.max(peak, active);
  }

  return { peak, left: active };
}

describe("demanded patches", () => {
  test("changes keeps rename identity and counts what diff would count", async () => {
    const root = await repository();
    const git = gitIn(root);
    await writeFile(join(root, "image.bin"), new Uint8Array([0, 1, 2]));
    await writeFile(join(root, "body.txt"), "a\nb\nc\nd\ne\nf\n");
    git("add", ".");
    git("commit", "-m", "files");
    git("mv", "body.txt", "renamed.txt");
    await writeFile(join(root, "renamed.txt"), "a\nb\nc\nd\ne\nf\ng\n");
    git("add", "renamed.txt");
    await writeFile(join(root, "image.bin"), new Uint8Array([0, 3, 4]));
    await writeFile(join(root, "tracked.txt"), "one\nchanged\nthree\n");
    await writeFile(join(root, "new.txt"), "fresh\n");
    const vcs = vcsAt(root);

    const changes = await vcs.changes({ scope: WORKTREE });
    const diffs = await vcs.diff({ scope: WORKTREE });

    assert.deepEqual(
      changes.toSorted((left, right) => left.path.localeCompare(right.path)),
      [
        { path: "image.bin", kind: "modified", stat: { kind: "binary" } },
        { path: "new.txt", kind: "untracked", stat: { kind: "unknown" } },
        {
          path: "renamed.txt",
          kind: "renamed",
          from: "body.txt",
          stat: { kind: "text", added: 1, removed: 0 },
        },
        { path: "tracked.txt", kind: "modified", stat: { kind: "text", added: 2, removed: 1 } },
      ],
    );

    for (const change of changes) {
      const diff = diffs.find((entry) => entry.path === change.path);

      if (change.stat.kind === "text") {
        assert.equal(diff?.kind, "text");
        if (diff?.kind !== "text") throw new Error("unreachable");
        assert.deepEqual([diff.added, diff.removed], [change.stat.added, change.stat.removed]);
      }

      if (change.stat.kind === "binary") assert.equal(diff?.kind, "binary");
    }

    const commit = git("rev-parse", "HEAD").trim();
    assert.deepEqual(await vcs.changes({ scope: { kind: "commit", oid: commit } }), [
      { path: "body.txt", kind: "added", stat: { kind: "text", added: 6, removed: 0 } },
      { path: "image.bin", kind: "added", stat: { kind: "binary" } },
    ]);
  });

  test("a demanded patch is byte-equal to git's own and alone in the answer", async () => {
    const root = await repository();
    await writeFile(join(root, "tracked.txt"), "one\nchanged\n");
    await writeFile(join(root, "other.txt"), "other\n");
    gitIn(root)("add", "other.txt");
    const vcs = vcsAt(root);

    const [alone] = await vcs.diff({ scope: WORKTREE, paths: ["tracked.txt"] });
    const all = await vcs.diff({ scope: WORKTREE });

    assert.equal(
      patchText(alone),
      gitIn(root)(
        "-c",
        "core.quotepath=false",
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--find-renames",
        "HEAD",
        "--",
        "tracked.txt",
      ),
    );
    assert.equal(patchText(alone), patchText(all.find((diff) => diff.path === "tracked.txt")));
    assert.deepEqual(await vcs.diff({ scope: WORKTREE, paths: ["not-reported.txt"] }), []);
  });

  test("git writes untracked patches: a new-file header, and binary by git's own test", async () => {
    const root = await repository();
    await writeFile(join(root, "new file.txt"), "fresh\nlines\n");
    await writeFile(join(root, "blob.dat"), new Uint8Array([0, 1, 2]));

    const diffs = await vcsAt(root).diff({ scope: { kind: "unstaged" } });
    const text = diffs.find((diff) => diff.path === "new file.txt");

    assert.equal(text?.kind, "text");
    if (text?.kind !== "text") throw new Error("unreachable");
    assert.equal(text.status, "untracked");
    assert.deepEqual([text.added, text.removed], [2, 0]);
    assert.match(
      text.patch,
      /^diff --git a\/new file\.txt b\/new file\.txt\nnew file mode 100644\n/,
    );
    assert.match(
      text.patch,
      /^--- \/dev\/null\n\+\+\+ b\/new file\.txt\t?\n@@ -0,0 \+1,2 @@\n\+fresh\n\+lines\n/m,
    );
    assert.equal(diffs.find((diff) => diff.path === "blob.dat")?.kind, "binary");
  });

  test("one unreadable file fails alone; a vanished or whitespace-only one is left out", async () => {
    const root = await repository();
    await writeFile(join(root, "tracked.txt"), "  one\n  two\n");
    await writeFile(join(root, "kept.txt"), "kept\n");
    await writeFile(join(root, "gone.txt"), "soon gone\n");
    await mkdir(join(root, "target"));
    execFileSync("ln", ["-s", "target", join(root, "link")]);
    const backend = createGitVcs();
    const paths = ["tracked.txt", "kept.txt", "gone.txt", "link"];

    const changes = await backend.changes({ cwd: root, scope: WORKTREE, ignoreWhitespace: true });
    assert.deepEqual(changes.map((change) => change.path).toSorted(), [...paths].toSorted());
    await rm(join(root, "gone.txt"));

    const diffs = await backend.diff({ cwd: root, scope: WORKTREE, paths, ignoreWhitespace: true });

    assert.deepEqual(diffs.map((diff) => `${diff.path} ${diff.kind}`).toSorted(), [
      "kept.txt text",
      "link failed",
    ]);
    const failed = diffs.find((diff) => diff.path === "link");
    assert.equal(failed?.kind === "failed" ? failed.reason : "", "Diff paths must be files: link");
  });

  test("a patch read names at most VCS_DIFF_PATHS_MAX paths", async () => {
    const root = await repository();
    const paths = Array.from({ length: VCS_DIFF_PATHS_MAX + 1 }, (_, index) => `f${String(index)}`);

    await assert.rejects(
      createGitVcs().diff({ cwd: root, scope: WORKTREE, paths, ignoreWhitespace: false }),
      /at most 16 paths/,
    );
  });

  test("an empty demand answers nothing without running git", async () => {
    const git = await loggingGit();
    const backend = createGitVcs();

    assert.deepEqual(
      await backend.diff({
        cwd: "/nonexistent/nyte",
        scope: WORKTREE,
        paths: [],
        ignoreWhitespace: false,
      }),
      [],
    );
    assert.deepEqual(await git.events(), []);
  });

  test("a patch past the byte limit answers too_large, tracked or untracked", async () => {
    const root = await repository();
    const line = `${"x".repeat(99)}\n`;
    await writeFile(join(root, "tracked.txt"), line.repeat(25_000));
    await writeFile(join(root, "huge-new.txt"), line.repeat(25_000));
    await writeFile(join(root, "small.txt"), "small\n");
    const vcs = vcsAt(root);

    const diffs = await vcs.diff({ scope: WORKTREE });

    assert.deepEqual(
      diffs
        .map((diff) => `${diff.path} ${diff.kind === "too_large" ? String(diff.limit) : diff.kind}`)
        .toSorted(),
      ["huge-new.txt 2000000", "small.txt text", "tracked.txt 2000000"],
    );
  });

  test("endless patch output stops at the limit and its process exits first", async () => {
    const root = await repository();
    await writeFile(join(root, "tracked.txt"), "changed\n");
    const git = await loggingGit();
    vi.stubEnv("NYTE_GIT_FLOOD", "1");

    const [diff] = await vcsAt(root).diff({ scope: WORKTREE, paths: ["tracked.txt"] });

    assert.deepEqual(diff, {
      path: "tracked.txt",
      status: "modified",
      kind: "too_large",
      limit: 2_000_000,
    });
    assert.deepEqual(patchProcesses(await git.events()), { peak: 1, left: 0 });
  });

  test("an unborn worktree joins staged and unstaged patches within one byte budget", async () => {
    const root = await emptyRepository();
    const git = gitIn(root);
    await writeFile(join(root, "first.txt"), "hello\n");
    git("add", "first.txt");
    await writeFile(join(root, "first.txt"), "hello\nworld\n");
    const half = `${"y".repeat(99)}\n`.repeat(12_000);
    await writeFile(join(root, "split.txt"), half);
    git("add", "split.txt");
    await writeFile(join(root, "split.txt"), `${half}${half}`);
    const vcs = vcsAt(root);

    const changes = await vcs.changes({ scope: WORKTREE });
    const diffs = await vcs.diff({ scope: WORKTREE });
    const first = diffs.find((diff) => diff.path === "first.txt");

    assert.deepEqual(changes.find((change) => change.path === "first.txt")?.stat, {
      kind: "text",
      added: 2,
      removed: 0,
    });
    assert.equal(first?.kind, "text");
    if (first?.kind !== "text") throw new Error("unreachable");
    assert.deepEqual([first.added, first.removed], [2, 0]);
    assert.match(first.patch, /^\+hello\n/m);
    assert.match(first.patch, /^\+world\n/m);
    assert.deepEqual(
      diffs.find((diff) => diff.path === "split.txt"),
      {
        path: "split.txt",
        status: "added",
        kind: "too_large",
        limit: 2_000_000,
      },
    );
  });

  test("unborn fallbacks read their halves one after another inside the shared bound", async () => {
    const root = await emptyRepository();
    const git = gitIn(root);
    const paths = Array.from({ length: 6 }, (_, index) => `file-${String(index)}.txt`);
    await Promise.all(paths.map((path) => writeFile(join(root, path), "staged\n")));
    git("add", ".");
    await Promise.all(paths.map((path) => writeFile(join(root, path), "staged\nworking\n")));
    const logging = await loggingGit();

    const diffs = await createGitVcs().diff({
      cwd: root,
      scope: WORKTREE,
      paths,
      ignoreWhitespace: false,
    });

    assert.equal(diffs.length, 6);
    const events = await logging.events();
    assert.equal(events.filter((event) => event === "start").length, 18);
    assert.deepEqual(patchProcesses(events), { peak: 4, left: 0 });
  });

  test("concurrent diff calls share four patch processes", async () => {
    const root = await repository();
    const paths = Array.from({ length: 12 }, (_, index) => `file-${String(index)}.txt`);
    await Promise.all(paths.map((path) => writeFile(join(root, path), "base\n")));
    gitIn(root)("add", ".");
    gitIn(root)("commit", "-m", "many");
    await Promise.all(paths.map((path) => writeFile(join(root, path), "changed\n")));
    const git = await loggingGit();
    const backend = createGitVcs();
    const read = () => backend.diff({ cwd: root, scope: WORKTREE, paths, ignoreWhitespace: false });

    const [first, second] = await Promise.all([read(), read()]);

    assert.equal(first.length, 12);
    assert.equal(second.length, 12);
    const events = await git.events();
    assert.equal(events.filter((event) => event === "start").length, 24);
    assert.deepEqual(patchProcesses(events), { peak: 4, left: 0 });
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
    assert.deepEqual(trash.trashed, [join(await realpath(root), "scratch.txt")]);
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

  test("moves a staged addition to trash and removes it from the index", async () => {
    const root = await repository();
    await writeFile(join(root, "added.txt"), "added\n");
    const trash = trashRecorder();
    const vcs = vcsAt(root, trash);
    await vcs.stage({ paths: ["added.txt"], staged: true });

    const result = await vcs.discard({ paths: ["added.txt"] });

    assert.deepEqual(result, { kind: "applied", paths: ["added.txt"], skipped: [] });
    assert.deepEqual(trash.trashed, [join(await realpath(root), "added.txt")]);
    assert.deepEqual((await vcs.repository()).staged, []);
  });

  test("restores a rename source and trashes its destination", async () => {
    const root = await repository();
    gitIn(root)("mv", "tracked.txt", "moved.txt");
    const trash = trashRecorder();

    const result = await vcsAt(root, trash).discard({ paths: ["moved.txt"] });

    assert.equal(result.kind, "applied");
    assert.equal(await readFile(join(root, "tracked.txt"), "utf8"), "one\ntwo\n");
    assert.deepEqual(trash.trashed, [join(await realpath(root), "moved.txt")]);
  });

  test("answers stale when the worktree moved after the caller's snapshot", async () => {
    const root = await repository();
    const vcs = vcsAt(root);
    const revision = (await vcs.repository()).revision;
    await writeFile(join(root, "tracked.txt"), "human edit\n");

    assert.deepEqual(
      await vcs.backend.stage({
        cwd: root,
        paths: ["tracked.txt"],
        staged: true,
        expect: { revision },
      }),
      { kind: "stale" },
    );
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

  test("serializes clients with the same revision so the second answers stale", async () => {
    const root = await repository();
    await writeFile(join(root, "scratch.txt"), "untracked\n");
    const first = createGitVcs();
    const second = createGitVcs();
    const snapshot = await first.snapshot({ cwd: root });
    assert.equal(snapshot.kind, "repository");
    if (snapshot.kind !== "repository") return;
    const input = {
      cwd: root,
      paths: ["scratch.txt"] as const,
      staged: true,
      expect: { revision: snapshot.revision },
    };

    const outcomes = await Promise.all([first.stage(input), second.stage(input)]);

    assert.deepEqual(outcomes.map((outcome) => outcome.kind).toSorted(), ["applied", "stale"]);
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
      files: { kind: "staged" },
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
      files: { kind: "all" },
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

    const result = await vcsAt(root).commit({ message: "all", files: { kind: "all" } });

    assert.equal(result.kind, "committed");
    assert.deepEqual((await vcsAt(root).repository()).unstaged, [
      { path: "scratch.txt", kind: "untracked" },
    ]);
  });

  test("commits the named index entries without reading later worktree edits", async () => {
    const root = await repository();
    await writeFile(join(root, "tracked.txt"), "staged\n");
    await writeFile(join(root, "other.txt"), "other\n");
    const vcs = vcsAt(root);
    await vcs.stage({ paths: ["tracked.txt", "other.txt"], staged: true });
    await writeFile(join(root, "tracked.txt"), "working\n");

    const result = await vcs.commit({
      message: "only one",
      files: { kind: "paths", paths: ["tracked.txt"] },
    });

    assert.equal(result.kind, "committed");
    assert.equal(gitIn(root)("show", "HEAD:tracked.txt"), "staged\n");
    const snapshot = await vcs.repository();
    assert.deepEqual(snapshot.staged, [{ path: "other.txt", kind: "added" }]);
    assert.deepEqual(snapshot.unstaged, [{ path: "tracked.txt", kind: "modified" }]);
  });

  test("committing a staged rename by destination keeps both rename endpoints", async () => {
    const root = await repository();
    const git = gitIn(root);
    git("mv", "tracked.txt", "moved.txt");

    const result = await vcsAt(root).commit({
      message: "move it",
      files: { kind: "paths", paths: ["moved.txt"] },
    });

    assert.equal(result.kind, "committed");
    assert.equal(
      git("show", "--format=", "--name-status", "--find-renames", "HEAD").trim(),
      "R100\ttracked.txt\tmoved.txt",
    );
  });

  test("answers nothing_to_commit on a clean tree", async () => {
    const root = await repository();

    assert.deepEqual(await vcsAt(root).commit({ message: "empty", files: { kind: "staged" } }), {
      kind: "nothing_to_commit",
    });
  });

  test("does not run a repository pre-commit hook", async () => {
    const root = await repository();
    await writeFile(join(root, ".git", "hooks", "pre-commit"), "#!/bin/sh\necho no >&2\nexit 1\n", {
      mode: 0o755,
    });
    await writeFile(join(root, "tracked.txt"), "changed\n");

    const result = await vcsAt(root).commit({ message: "blocked", files: { kind: "all" } });

    assert.equal(result.kind, "committed");
    assert.equal((await vcsAt(root).log({ limit: 5 })).commits.length, 2);
  });

  test("refuses a path outside the repository and commits nothing", async () => {
    const root = await repository();
    await writeFile(join(root, "tracked.txt"), "changed\n");
    const vcs = vcsAt(root);

    const result = await vcs.commit({
      message: "escape",
      files: { kind: "paths", paths: ["../escape.txt"] },
    });

    assert.equal(result.kind, "failed");
    assert.equal((await vcs.log({ limit: 5 })).commits.length, 1);
  });
});

describe("createBranch", () => {
  test("creates a branch without moving HEAD, or checks it out when asked", async () => {
    const root = await repository();
    const vcs = vcsAt(root);

    assert.deepEqual(await vcs.createBranch({ name: "feature/one", checkout: false }), {
      kind: "created",
    });
    assert.equal(attachedBranch(await vcs.repository()), "main");
    assert.ok((await vcs.refs()).local.includes("feature/one"));

    assert.deepEqual(await vcs.createBranch({ name: "feature/two", checkout: true }), {
      kind: "created",
    });
    assert.equal(attachedBranch(await vcs.repository()), "feature/two");
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
      assert.equal(attachedBranch(await vcsAt(root).repository()), "main");
    },
  );
});

describe("per-call workspace", () => {
  test("tree and repository reads use the call cwd", async () => {
    const called = await repository();
    await writeFile(join(called, "only-there.txt"), "called\n");
    const backend = createGitVcs();

    const snapshot = await backend.snapshot({ cwd: called });
    const tree = await backend.tree({ cwd: called });

    assert.equal(snapshot.kind, "repository");
    if (snapshot.kind !== "repository" || tree.kind !== "tree") return;
    assert.equal(snapshot.root, await realpath(called));
    const files = await backend.diffTrees({
      cwd: called,
      from: tree.id,
      to: tree.id,
    });
    assert.deepEqual(files, []);
  });
});

describe("workspace opened at a repository subfolder", () => {
  test("reads repository paths and commits only the selected file", async () => {
    const { root, sub } = await nestedRepository();
    const git = gitIn(root);
    await writeFile(join(root, "tracked.txt"), "sibling\n");
    git("add", "tracked.txt");
    await writeFile(join(sub, "inside.txt"), "changed\n");
    await writeFile(join(sub, "scratch.txt"), "scratch\n");
    const vcs = vcsAt(sub);

    const snapshot = await vcs.repository();

    assert.deepEqual(snapshot, await vcsAt(root).repository());
    assert.equal(snapshot.root, await realpath(root));
    assert.deepEqual(snapshot.staged, [{ path: "tracked.txt", kind: "modified" }]);
    assert.deepEqual(snapshot.unstaged, [
      { path: "sub/inside.txt", kind: "modified" },
      { path: "sub/scratch.txt", kind: "untracked" },
    ]);
    await writeFile(join(sub, "inside.txt"), "changed again\n");
    assert.notEqual((await vcs.repository()).revision, snapshot.revision);

    const diffs = await vcs.diff({ scope: WORKTREE });

    assert.deepEqual(
      diffs.map((diff) => [diff.path, diff.status, diff.kind === "text" ? diff.added : -1]),
      [
        ["sub/inside.txt", "modified", 1],
        ["sub/scratch.txt", "untracked", 1],
        ["tracked.txt", "modified", 1],
      ],
    );
    assert.match(patchText(diffs[0]), /^-inside\n\+changed again\n/m);
    assert.match(patchText(diffs[1]), /^\+scratch\n/m);
    assert.deepEqual(await vcs.contents({ scope: WORKTREE, path: "sub/inside.txt" }), {
      path: "sub/inside.txt",
      old: { kind: "text", text: "inside\n" },
      new: { kind: "text", text: "changed again\n" },
    });

    assert.deepEqual(await vcs.stage({ paths: ["sub/inside.txt"], staged: true }), {
      kind: "applied",
      paths: ["sub/inside.txt"],
      skipped: [],
    });
    assert.equal(git("diff", "--cached", "--name-only"), "sub/inside.txt\ntracked.txt\n");

    const wrongPath = await vcs.commit({
      message: "cwd-relative",
      files: { kind: "paths", paths: ["inside.txt"] },
    });

    assert.deepEqual(wrongPath, { kind: "nothing_to_commit" });
    assert.equal(git("log", "--format=%s"), "nested\ninitial\n");

    const committed = await vcs.commit({
      message: "inside only",
      files: { kind: "paths", paths: ["sub/inside.txt"] },
    });

    assert.equal(committed.kind, "committed");

    if (committed.kind !== "committed") throw new Error("unreachable");
    assert.equal(git("show", "--name-status", "--format=", "HEAD"), "M\tsub/inside.txt\n");
    assert.equal(git("ls-tree", "--name-only", "HEAD"), "sub\ntracked.txt\n");
    assert.equal(git("diff", "--cached", "--name-only"), "tracked.txt\n");
    await writeFile(join(sub, "inside.txt"), "after the commit\n");
    const shown = await vcs.diff({ scope: { kind: "commit", oid: committed.oid } });
    assert.deepEqual(
      shown.map((diff) => [diff.path, diff.status]),
      [["sub/inside.txt", "modified"]],
    );
    assert.match(patchText(shown[0]), /^-inside\n\+changed again\n/m);
    // About 25 git spawns: 1.6s alone, past the 5s default under full-suite load.
  }, 20_000);

  test("discard restores a tracked file and trashes an untracked one at its real path", async () => {
    const { root, sub } = await nestedRepository();
    await writeFile(join(sub, "inside.txt"), "changed\n");
    await writeFile(join(sub, "scratch.txt"), "scratch\n");
    const trash = trashRecorder();

    const result = await vcsAt(sub, trash).discard({
      paths: ["sub/inside.txt", "sub/scratch.txt"],
    });

    assert.deepEqual(result, {
      kind: "applied",
      paths: ["sub/inside.txt", "sub/scratch.txt"],
      skipped: [],
    });
    assert.equal(await readFile(join(sub, "inside.txt"), "utf8"), "inside\n");
    assert.deepEqual(trash.trashed, [join(await realpath(root), "sub", "scratch.txt")]);
    await assert.rejects(access(join(sub, "scratch.txt")));
    assert.deepEqual([...(await vcsAt(sub).repository()).unstaged], []);
  });

  test("the host's own trash keeps a discarded sibling under the repository bucket", async () => {
    const { root, sub, home } = await nestedRepository();
    await writeFile(join(root, "sibling-scratch.txt"), "recoverable\n");

    const result = await vcsAt(sub).discard({ paths: ["sibling-scratch.txt"] });

    assert.deepEqual(result, { kind: "applied", paths: ["sibling-scratch.txt"], skipped: [] });
    await assert.rejects(access(join(root, "sibling-scratch.txt")));

    const bucket = join(
      home,
      "snapshots",
      createHash("sha256")
        .update(await realpath(root))
        .digest("hex"),
      "trash",
    );

    const entries = await readdir(bucket);
    const [entry] = entries;
    assert.equal(entries.length, 1);
    assert.ok(entry !== undefined);
    assert.deepEqual(await readdir(join(bucket, entry)), ["sibling-scratch.txt"]);
    assert.equal(
      await readFile(join(bucket, entry, "sibling-scratch.txt"), "utf8"),
      "recoverable\n",
    );
  });
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
    assert.equal(
      execFileSync("git", ["branch", "-a"], {
        cwd: remote,
        encoding: "utf8",
        env: testEnv(remote),
      }),
      "",
    );
  });

  test("publishes the branch with setUpstream against the single remote", async () => {
    const root = await repository();
    const remote = await bareRemote();
    const git = gitIn(root);
    git("remote", "add", "origin", remote);

    const result = await vcsAt(root).push({ setUpstream: true });

    assert.deepEqual(result, { kind: "pushed", remote: "origin", branch: "main" });
    assert.equal(git("config", "--get", "branch.main.remote").trim(), "origin");
    const head = (await vcsAt(root).repository()).head;
    assert.equal(head.kind, "attached");
    if (head.kind !== "attached") throw new Error("unreachable");
    assert.equal(head.branch, "main");
    assert.deepEqual(head.upstream, { name: "origin/main", ahead: 0, behind: 0 });
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
    execFileSync("git", ["clone", remote, other], { env: testEnv(other) });
    const otherGit = gitIn(other);
    otherGit("config", "user.name", "Other");
    otherGit("config", "user.email", "other@example.com");
    await writeFile(join(other, "tracked.txt"), "theirs\n");
    otherGit("commit", "--all", "-m", "theirs");
    otherGit("push");

    await writeFile(join(root, "tracked.txt"), "mine\n");
    await vcsAt(root).commit({ message: "mine", files: { kind: "all" } });
    const result = await vcsAt(root).push({ setUpstream: false });

    assert.equal(result.kind, "rejected");
    assert.equal(
      execFileSync("git", ["log", "-1", "--format=%s", "main"], {
        cwd: remote,
        encoding: "utf8",
        env: testEnv(remote),
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
    assert.equal(
      execFileSync("git", ["branch"], {
        cwd: first,
        encoding: "utf8",
        env: testEnv(first),
      }),
      "",
    );
    assert.equal(
      execFileSync("git", ["branch"], {
        cwd: second,
        encoding: "utf8",
        env: testEnv(second),
      }),
      "",
    );
  });
});
