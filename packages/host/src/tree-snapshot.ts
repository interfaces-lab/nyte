/**
 * Workspace tree ids for run provenance, from a shadow git repository the
 * host owns. The user's `.git` is never read or written: objects put there
 * would be unreachable and pruned by their `git gc`, and a workspace need not
 * be a repository at all. Every git call runs with `GIT_DIR` at the shadow and
 * `GIT_WORK_TREE` at the workspace, so `.gitignore` applies and `.git` itself
 * is never added.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, realpath, rename } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { VcsBackend } from "@nyte-ai/core";
import { treeId } from "@nyte-ai/protocol";
import type { FileDiff, FileDiffKind, TreeId, TreeOutcome } from "@nyte-ai/protocol";
import { nyteHome } from "./paths.ts";

export type TreeSnapshot = Pick<VcsBackend, "tree" | "diffTrees" | "restoreTree"> & {
  /** Where a file leaving the tree goes: the caller's `discard`, else the shadow trash. */
  readonly discard: (absolutePath: string) => Promise<void>;
};

export interface TreeSnapshotOptions {
  /**
   * Where a file the tree does not have goes on restore. The desktop hands
   * this to the OS trash; without one the file moves under the shadow
   * repository's `trash/<timestamp>/<path>`.
   */
  readonly discard?: (absolutePath: string) => Promise<void>;
}

interface GitResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

class GitCommandError extends Error {
  readonly result: GitResult;

  constructor(args: readonly string[], result: GitResult) {
    super(result.stderr.trim() || `git ${args.join(" ")} exited ${String(result.code)}`);
    this.name = "GitCommandError";
    this.result = result;
  }
}

/** git's own first line, which is what the reader can act on. */
function firstLine(cause: unknown, fallback: string): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  const line = message.split("\n").find((candidate) => candidate.trim() !== "");
  return line === undefined ? fallback : line.trim();
}

function runGit(
  env: { readonly shadow: string; readonly workspace: string },
  args: readonly string[],
): Promise<GitResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn("git", ["-c", "core.quotepath=off", ...args], {
      cwd: env.workspace,
      env: {
        ...process.env,
        LC_ALL: "C",
        GIT_TERMINAL_PROMPT: "0",
        GIT_DIR: env.shadow,
        GIT_WORK_TREE: env.workspace,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const result = {
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        code: code ?? -1,
      };
      if (result.code === 0) resolveResult(result);
      else reject(new GitCommandError(args, result));
    });
  });
}

function safeWorkspacePath(workspace: string, path: string): string {
  const absolute = resolve(workspace, path);
  const within = relative(workspace, absolute);
  if (path === "" || isAbsolute(within) || within === ".." || within.startsWith("../")) {
    throw new Error(`Path is outside the workspace: ${path}`);
  }
  return absolute;
}

function diffKind(status: string): FileDiffKind {
  switch (status[0]) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    default:
      return "modified";
  }
}

/** `--name-status -z` records: `<status>\0<path>\0`, or `R<n>\0<old>\0<new>\0` for a rename. */
function parseNameStatus(output: string): readonly { path: string; kind: FileDiffKind }[] {
  const fields = output.split("\0");
  const entries: { path: string; kind: FileDiffKind }[] = [];
  let index = 0;
  while (index < fields.length) {
    const status = fields[index];
    if (status === undefined || status === "") break;
    const kind = diffKind(status);
    const path = fields[kind === "renamed" ? index + 2 : index + 1];
    if (path === undefined) break;
    entries.push({ path, kind });
    index += kind === "renamed" ? 3 : 2;
  }
  return entries;
}

/** `--numstat -z` records: `<added>\t<removed>\t<path>\0`, or `<added>\t<removed>\t\0<old>\0<new>\0`. */
function parseNumstat(output: string): readonly { added: number; removed: number }[] {
  const fields = output.split("\0");
  const counts: { added: number; removed: number }[] = [];
  let index = 0;
  while (index < fields.length) {
    const record = fields[index];
    if (record === undefined || record === "") break;
    const [added = "-", removed = "-", path = ""] = record.split("\t");
    counts.push({
      added: added === "-" ? 0 : Number(added),
      removed: removed === "-" ? 0 : Number(removed),
    });
    index += path === "" ? 3 : 1;
  }
  return counts;
}

/** One patch per `diff --git` header, in git's order, which the status and count listings share. */
function splitPatches(output: string): readonly string[] {
  if (output === "") return [];
  return output
    .split(/^(?=diff --git )/mu)
    .filter((patch) => patch !== "")
    .map((patch) => (patch.endsWith("\n") ? patch : `${patch}\n`));
}

export function createTreeSnapshot(
  workspace: string,
  options: TreeSnapshotOptions = {},
): TreeSnapshot {
  let prepared: Promise<{ readonly shadow: string; readonly workspace: string }> | undefined;
  /** The shadow index is one file: tree reads and restores take turns on it. */
  let turn: Promise<unknown> = Promise.resolve();

  const prepare = async () => {
    const root = await realpath(workspace);
    const shadow = join(nyteHome(), "snapshots", createHash("sha256").update(root).digest("hex"));
    const env = { shadow, workspace: root };
    try {
      await access(join(shadow, "HEAD"));
    } catch {
      await mkdir(shadow, { recursive: true, mode: 0o700 });
      await runGit(env, ["init", "--quiet"]);
    }
    return env;
  };

  const ready = () => {
    prepared ??= prepare().catch((cause: unknown) => {
      prepared = undefined;
      throw cause;
    });
    return prepared;
  };

  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = turn.then(work, work);
    turn = next.catch(() => undefined);
    return next;
  };

  const discard =
    options.discard ??
    (async (absolute: string) => {
      const env = await ready();
      const target = join(
        env.shadow,
        "trash",
        String(Date.now()),
        relative(env.workspace, absolute),
      );
      await mkdir(dirname(target), { recursive: true });
      await rename(absolute, target);
    });

  const tree = (): Promise<TreeOutcome> =>
    serial(async () => {
      try {
        const env = await ready();
        await runGit(env, ["add", "-A", "."]);
        const written = await runGit(env, ["write-tree"]);
        return { kind: "tree", id: treeId(written.stdout.trim()) };
      } catch (cause) {
        return { kind: "unavailable", reason: firstLine(cause, "git is unavailable") };
      }
    });

  const diffTrees = async (input: {
    readonly from: TreeId;
    readonly to: TreeId;
    readonly paths?: readonly string[];
  }): Promise<readonly FileDiff[]> => {
    const env = await ready();
    for (const path of input.paths ?? []) safeWorkspacePath(env.workspace, path);
    const pathspec = input.paths === undefined ? [] : ["--", ...input.paths];
    const range = ["--find-renames", input.from, input.to];
    const [status, numstat, patch] = await Promise.all([
      runGit(env, ["diff", "--name-status", "-z", ...range, ...pathspec]),
      runGit(env, ["diff", "--numstat", "-z", ...range, ...pathspec]),
      runGit(env, ["diff", "--no-color", "--no-ext-diff", ...range, ...pathspec]),
    ]);
    const counts = parseNumstat(numstat.stdout);
    const patches = splitPatches(patch.stdout);
    return parseNameStatus(status.stdout).map((entry, index) => ({
      path: entry.path,
      kind: entry.kind,
      added: counts[index]?.added ?? 0,
      removed: counts[index]?.removed ?? 0,
      patch: patches[index] ?? "",
    }));
  };

  const restoreTree = (input: { readonly tree: TreeId; readonly paths: readonly string[] }) =>
    serial(
      async (): Promise<
        | { readonly kind: "restored"; readonly files: readonly string[] }
        | { readonly kind: "failed"; readonly reason: string }
      > => {
        try {
          const env = await ready();
          for (const path of input.paths) safeWorkspacePath(env.workspace, path);
          if (input.paths.length === 0) return { kind: "restored", files: [] };
          // `git restore` deletes an indexed path its source lacks; those go to the trash instead.
          const listed = await runGit(env, [
            "ls-tree",
            "-r",
            "-z",
            "--name-only",
            input.tree,
            "--",
            ...input.paths,
          ]);
          const present = new Set(listed.stdout.split("\0").filter((path) => path !== ""));
          const kept = input.paths.filter((path) => present.has(path));
          if (kept.length > 0) {
            await runGit(env, ["restore", `--source=${input.tree}`, "--worktree", "--", ...kept]);
          }
          for (const path of input.paths) {
            if (present.has(path)) continue;
            const absolute = safeWorkspacePath(env.workspace, path);
            // A created file the user already removed needs no trashing.
            if (
              await access(absolute).then(
                () => true,
                () => false,
              )
            )
              await discard(absolute);
          }
          return { kind: "restored", files: [...input.paths] };
        } catch (cause) {
          return { kind: "failed", reason: firstLine(cause, "The restore failed.") };
        }
      },
    );

  return { tree, diffTrees, restoreTree, discard };
}
