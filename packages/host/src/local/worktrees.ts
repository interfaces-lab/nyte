import { randomUUID } from "node:crypto";
import { copyFile, mkdir, realpath, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { SdkError } from "@nyte-ai/schema";
import type { WorkspaceTarget } from "@nyte-ai/schema";
import type { WorktreeProvider } from "@nyte-ai/core";
import { sha256 } from "../hash.ts";
import { run } from "./command.ts";

const ENV: Readonly<Record<string, string>> = { GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };

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

    return path === undefined ? [] : [{ path, branch: branch ?? null }];
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
 * PATH), each under `<home>/.nyte/worktrees/<repository>/<slug>` on the branch
 * `nyte/<slug>`, the slug the title's words and a hash of the name.
 *
 * `create` refuses a folder outside a repository or one without a commit, then
 * answers the worktree already on that branch, or adds one from HEAD and
 * copies the workspace's uncommitted changes in: the worktree's tracked and
 * untracked files, ignored ones aside, are written to a tree through a
 * temporary index seeded from the real one (which is never touched), and the
 * new checkout moves to that tree with its index left at HEAD, so the changes
 * show as uncommitted there too. A workspace below the repository's root gets
 * the same folder below the worktree's.
 *
 * `remove` keeps a worktree with uncommitted changes, folder and branch;
 * otherwise it removes the folder (`git worktree remove`) and deletes the
 * branch unless it moved past `base`.
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

      const slug = worktreeSlug(input.name, input.title);
      const branch = `nyte/${slug}`;
      const below = (root: string): WorkspaceTarget => ({
        kind: "local",
        path: repo.prefix === "" ? root : join(root, repo.prefix).replace(/\/+$/u, ""),
      });

      const listed = (await listWorktrees(repo.root, options)).find(
        (worktree) => worktree.branch === branch,
      );

      if (listed !== undefined)
        return {
          target: below(listed.path),
          branch,
          base: (await commitAt(repo.root, `refs/heads/${branch}`)) ?? head,
        };

      const folder = join(folders, basename(repo.root), slug);
      const branched = await hasBranch(repo.root, branch, options);
      const base = branched ? ((await commitAt(repo.root, `refs/heads/${branch}`)) ?? head) : head;
      const tree = await workingTree(repo);

      await mkdir(dirname(folder), { recursive: true });
      await addWorktree(
        repo.root,
        branched ? { path: folder, branch } : { path: folder, branch, from: head },
        options,
      );

      if (tree !== (await git(folder, ["rev-parse", "HEAD^{tree}"])).trim()) {
        await git(folder, ["read-tree", "-m", "-u", "HEAD", tree]);
        await git(folder, ["reset", "-q"]);
      }

      return { target: below(await realpath(folder)), branch, base };
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

      if ((await git(root, ["status", "--porcelain"])).trim() !== "")
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
    : { root, gitDir, prefix };
}

function worktreeSlug(name: string, title: string | null): string {
  const words = (title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .slice(0, 40)
    .replace(/^-+|-+$/gu, "");
  const key = sha256(name).slice(0, 8);

  return words === "" ? key : `${words}-${key}`;
}
