import { randomUUID } from "node:crypto";
import { copyFile, mkdir, realpath, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { SdkError } from "@nyte-ai/schema";
import type { WorkspaceTarget } from "@nyte-ai/schema";
import type { WorktreeProvider } from "@nyte-ai/core";
import { run } from "./command.ts";

const ENV: Readonly<Record<string, string>> = { GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };

/** The branch config key (`branch.<name>.nyte-session`) naming the session a worktree's branch was made for; `git branch -D` drops it with the branch. */
const SESSION_KEY = "nyte-session";

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "from",
  "by",
  "at",
  "into",
  "as",
  "is",
  "are",
  "be",
  "it",
  "its",
  "this",
  "that",
  "my",
  "our",
  "your",
]);

const TYPE_WORDS = new Set([
  "feat",
  "feature",
  "fix",
  "add",
  "chore",
  "refactor",
  "docs",
  "test",
  "perf",
  "build",
  "ci",
  "revert",
  "update",
]);

/** How many names `create` tries before giving up: `<words>`, then `<two words>-2` up to this. */
const MAX_ATTEMPTS = 100;

/** One checkout of a repository: its folder and the branch it has out, null when HEAD is detached. */
export interface ListedWorktree {
  readonly path: string;
  readonly branch: string | null;
}

type Git = (
  cwd: string,
  args: readonly string[],
  env?: Readonly<Record<string, string>>,
) => Promise<string>;

type Repository = { readonly root: string; readonly gitDir: string; readonly prefix: string };

function gitCommand(binary = "git"): Git {
  return async (cwd, args, env) => {
    const ran = await run(binary, ["-c", "core.quotepath=off", ...args], {
      cwd,
      env: { ...ENV, ...env },
    });

    if (ran.code !== 0)
      throw new SdkError("unavailable", ran.stderr.trim() || `git ${args[0] ?? ""} failed.`);

    return ran.stdout.toString("utf8");
  };
}

/** Lists every worktree of the repository holding `cwd` (`git worktree list --porcelain -z`), the main checkout first. */
export async function listWorktrees(
  cwd: string,
  options?: { readonly git?: string },
): Promise<readonly ListedWorktree[]> {
  const out = await gitCommand(options?.git)(cwd, ["worktree", "list", "--porcelain", "-z"]);

  return out.split("\0\0").flatMap((record) => {
    const fields = record.split("\0");
    const path = fields.find((field) => field.startsWith("worktree "))?.slice(9);
    const branch = fields.find((field) => field.startsWith("branch refs/heads/"))?.slice(18);

    return path === undefined ? [] : [{ path: resolve(path), branch: branch ?? null }];
  });
}

/** Checks `branch` out in a new worktree at `path` (`git worktree add`), creating the branch at `from` when given. */
export async function addWorktree(
  cwd: string,
  input: { readonly path: string; readonly branch: string; readonly from?: string },
  options?: { readonly git?: string },
): Promise<void> {
  await gitCommand(options?.git)(
    cwd,
    input.from === undefined
      ? ["worktree", "add", input.path, input.branch]
      : ["worktree", "add", "-b", input.branch, input.path, input.from],
  );
}

/** Whether `name` is a local branch of the repository holding `cwd`. */
export async function hasBranch(
  cwd: string,
  name: string,
  options?: { readonly git?: string },
): Promise<boolean> {
  return gitCommand(options?.git)(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${name}`])
    .then(() => true)
    .catch(() => false);
}

/**
 * Returns git worktrees for local workspaces (`git`, default `git` on the
 * PATH), each under `<home>/.nyte/worktrees/<repository>/<branch>` on a branch
 * named by `branchName`: at most three hyphenated words from the title.
 *
 * `create` refuses a folder outside a repository or one without a commit, then
 * answers the worktree on the branch whose `branch.<branch>.nyte-session`
 * config is `name`, or claims the first name with no folder or listed worktree
 * at its path by creating its branch at HEAD (git refuses an existing branch,
 * which also settles a race with a concurrent create: the loser tries the next
 * name), records `name` in that config, and adds a worktree for it; then it
 * copies the workspace's uncommitted changes in: the worktree's tracked and
 * untracked files, ignored ones aside, are written to a tree through a
 * temporary index seeded from the real one (which is never touched), and the
 * new checkout moves to that tree with its index left at HEAD, so the changes
 * show as uncommitted there too. A workspace below the repository's root gets
 * the same folder below the worktree's.
 *
 * `remove` keeps a worktree, folder and branch, while it holds uncommitted
 * changes or ignored files, since none were copied in and one may be a
 * `.env` or a local database (a wholly ignored folder such as `node_modules`
 * or a build's output aside); otherwise it removes the folder
 * (`git worktree remove`) and deletes the branch unless it moved past `base`.
 */
export function localWorktrees(options?: {
  readonly home?: string;
  readonly git?: string;
}): WorktreeProvider {
  const git = gitCommand(options?.git);
  const folders = join(options?.home ?? homedir(), ".nyte", "worktrees");

  const commitAt = (cwd: string, revision: string): Promise<string | null> =>
    git(cwd, ["rev-parse", "--verify", "--quiet", `${revision}^{commit}`]).then(
      (out) => out.trim(),
      () => null,
    );

  const workingTree = async (repo: Repository): Promise<string> => {
    const index = join(tmpdir(), `nyte-worktree-index-${randomUUID()}`);
    const indexEnv = { GIT_INDEX_FILE: index };

    try {
      await copyFile(join(repo.gitDir, "index"), index).catch(() => undefined);
      await git(repo.root, ["add", "-A", "--", "."], indexEnv);

      return (await git(repo.root, ["write-tree"], indexEnv)).trim();
    } finally {
      await rm(index, { force: true });
    }
  };

  const findClaimedBranch = async (root: string, name: string): Promise<string | null> => {
    const out = await git(root, [
      "config",
      "-z",
      "--get-regexp",
      `^branch\\..*\\.${SESSION_KEY}$`,
    ]).catch(() => "");

    for (const entry of out.split("\0")) {
      const newline = entry.indexOf("\n");
      const branch = entry.slice("branch.".length, newline - SESSION_KEY.length - 1);

      if (
        newline > 0 &&
        entry.slice(newline + 1) === name &&
        (await hasBranch(root, branch, options))
      )
        return branch;
    }

    return null;
  };

  const claimBranch = async (
    root: string,
    parent: string,
    listed: readonly ListedWorktree[],
    input: { readonly name: string; readonly title: string | null },
    head: string,
  ): Promise<string> => {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const branch = branchName(input.title, attempt);
      const folder = join(parent, branch);

      if (
        listed.some((worktree) => worktree.path === folder) ||
        (await stat(folder).catch(() => null)) !== null
      )
        continue;

      const [created] = await Promise.allSettled([
        git(root, ["branch", "--no-track", branch, head]),
      ]);

      if (created.status === "rejected") {
        if (await hasBranch(root, branch, options)) continue;
        throw created.reason;
      }

      await writeConfig(root, `branch.${branch}.${SESSION_KEY}`, input.name);

      return branch;
    }

    throw new SdkError(
      "unavailable",
      `Every worktree name for "${input.title ?? input.name}" is taken in ${root}.`,
    );
  };

  const writeConfig = async (root: string, key: string, value: string): Promise<void> => {
    for (let attempt = 1; ; attempt++) {
      const [written] = await Promise.allSettled([git(root, ["config", key, value])]);

      if (written.status === "fulfilled") return;

      if (attempt >= 20) throw written.reason;
      await new Promise((settle) => setTimeout(settle, 10 * attempt));
    }
  };

  return {
    async create(env, input) {
      const repo = await readRepository(git, env.cwd);

      if (repo === null)
        throw new SdkError(
          "unavailable",
          `${env.cwd} is not in a git repository, so it cannot have a worktree.`,
        );
      const head = await commitAt(repo.root, "HEAD");

      if (head === null)
        throw new SdkError(
          "unavailable",
          `${repo.root} has no commits yet, so a worktree has nothing to branch from.`,
        );

      const below = (root: string): WorkspaceTarget => ({
        kind: "local",
        path: resolve(root, repo.prefix),
      });

      const listed = await listWorktrees(repo.root, options);
      const claimed = await findClaimedBranch(repo.root, input.name);
      const open = listed.find((worktree) => claimed !== null && worktree.branch === claimed);

      if (claimed !== null && open !== undefined)
        return {
          target: below(open.path),
          branch: claimed,
          base: (await commitAt(repo.root, `refs/heads/${claimed}`)) ?? head,
        };

      const parent = join(folders, basename(repo.root));
      await mkdir(parent, { recursive: true });
      const realParent = await realpath(parent);
      const branch = claimed ?? (await claimBranch(repo.root, realParent, listed, input, head));

      const base =
        claimed === null ? head : ((await commitAt(repo.root, `refs/heads/${claimed}`)) ?? head);

      const folder = join(realParent, branch);
      const tree = await workingTree(repo);

      await addWorktree(repo.root, { path: folder, branch }, options);

      if (tree !== (await git(folder, ["rev-parse", "HEAD^{tree}"])).trim()) {
        await git(folder, ["read-tree", "-m", "-u", "HEAD", tree]);
        await git(folder, ["reset", "-q"]);
      }

      return { target: below(folder), branch, base };
    },
    async remove(worktree) {
      const path = "path" in worktree.target ? worktree.target.path : null;

      if (path === null || (await stat(path).catch(() => null)) === null)
        return { folder: "removed", branch: "kept" };
      const [root = path, common = ""] = (
        await git(path, [
          "rev-parse",
          "--show-toplevel",
          "--path-format=absolute",
          "--git-common-dir",
        ])
      ).split("\n");

      const status = await git(root, ["status", "--porcelain", "--ignored", "-z"]);

      if (
        status
          .split("\0")
          .some((entry) => entry !== "" && !(entry.startsWith("!! ") && entry.endsWith("/")))
      )
        return { folder: "kept", branch: "kept" };
      await git(common, ["worktree", "remove", root]);

      if ((await commitAt(common, `refs/heads/${worktree.branch}`)) !== worktree.base)
        return { folder: "removed", branch: "kept" };
      await git(common, ["branch", "-D", worktree.branch]);

      return { folder: "removed", branch: "deleted" };
    },
  };
}

async function readRepository(git: Git, cwd: string): Promise<Repository | null> {
  const out = await git(cwd, [
    "rev-parse",
    "--show-toplevel",
    "--absolute-git-dir",
    "--show-prefix",
  ]).catch(() => null);
  const [root, gitDir, prefix = ""] = out?.split("\n") ?? [];

  return root === undefined || gitDir === undefined || root === ""
    ? null
    : { root: resolve(root), gitDir: resolve(gitDir), prefix };
}

/**
 * Names a worktree's branch from its title: lowercase ASCII words, stopwords
 * dropped, and type words such as `fix` or `add` too while two words are left
 * without them; three words on the first attempt, then two and `-<attempt>`,
 * so a name never has more than three hyphenated parts. `worktree` stands in
 * for a title with no words.
 */
function branchName(title: string | null, attempt: number): string {
  const words = (title ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((word) => word !== "");

  const kept = words.filter((word) => !STOPWORDS.has(word));
  const content = kept.filter((word) => !TYPE_WORDS.has(word));
  const chosen = content.length >= 2 ? content : kept.length > 0 ? kept : words;
  const stem = chosen.length === 0 ? "worktree" : chosen.slice(0, attempt === 1 ? 3 : 2).join("-");

  return attempt === 1 ? stem : `${stem}-${attempt}`;
}
