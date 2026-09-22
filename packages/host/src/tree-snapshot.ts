import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { access, mkdir, open, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { devNull } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import type { VcsBackend } from "@nyte-ai/core";
import { treeId } from "@nyte-ai/protocol";
import type { FileDiff, FileDiffKind, TreeId, TreeOutcome } from "@nyte-ai/protocol";
import { entryAt, isFileError, nyteHome } from "./paths.ts";

export type TreeSnapshot = Pick<VcsBackend, "tree" | "diffTrees" | "restoreTree"> & {
  readonly discard: (input: {
    readonly cwd: string;
    readonly absolutePath: string;
  }) => Promise<void>;
};

export interface TreeSnapshotOptions {
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

const GIT_FLAGS = [
  "--literal-pathspecs",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "diff.external=",
  "-c",
  "core.pager=cat",
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.quotepath=false",
] as const;

export function sanitizedGitEnv(intended: Readonly<Record<string, string>> = {}) {
  const clean: Record<string, string> = {};

  for (const [name, value] of Object.entries(process.env)) {
    if (name.startsWith("GIT_") || value === undefined) continue;
    clean[name] = value;
  }

  return {
    ...clean,
    LC_ALL: "C",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: devNull,
    GIT_TERMINAL_PROMPT: "0",
    ...intended,
  };
}

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
    const child = spawn(
      "git",
      [...GIT_FLAGS, "-c", "core.autocrlf=false", "-c", "core.safecrlf=false", ...args],
      {
        cwd: env.workspace,
        env: sanitizedGitEnv({ GIT_DIR: env.shadow, GIT_WORK_TREE: env.workspace }),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

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

function parseDiffKind(status: string): FileDiffKind {
  const letter = status[0];

  if (letter !== "A" && letter !== "D" && letter !== "M" && letter !== "R") {
    throw new Error(`Unexpected git diff status: ${status}`);
  }

  switch (letter) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "M":
      return "modified";
    case "R":
      return "renamed";
    default: {
      const _exhaustive: never = letter;

      return _exhaustive;
    }
  }
}

type NamedDiff =
  | { readonly path: string; readonly kind: Exclude<FileDiffKind, "renamed"> }
  | { readonly path: string; readonly from: string; readonly kind: "renamed" };

function parseNameStatus(output: string): readonly NamedDiff[] {
  const fields = output.split("\0");
  const entries: NamedDiff[] = [];
  let index = 0;

  while (index < fields.length) {
    const status = fields[index];

    if (status === undefined || status === "") break;
    const kind = parseDiffKind(status);

    if (kind === "renamed") {
      const from = fields[index + 1];
      const path = fields[index + 2];

      if (from === undefined || path === undefined) break;
      entries.push({ path, from, kind });
      index += 3;
      continue;
    }

    const path = fields[index + 1];

    if (path === undefined) break;
    entries.push({ path, kind });
    index += 2;
  }

  return entries;
}

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

function splitPatches(output: string): readonly string[] {
  if (output === "") return [];

  return output
    .split(/^(?=diff --git )/mu)
    .filter((patch) => patch !== "")
    .map((patch) => (patch.endsWith("\n") ? patch : `${patch}\n`));
}

interface ShadowEnvironment {
  readonly shadow: string;
  readonly workspace: string;
}

async function prepare(workspace: string): Promise<ShadowEnvironment> {
  const root = await realpath(workspace);
  const shadow = join(nyteHome(), "snapshots", createHash("sha256").update(root).digest("hex"));
  const env = { shadow, workspace: root };
  await mkdir(shadow, { recursive: true, mode: 0o700 });
  await withShadowLock(env, async () => {
    try {
      await access(join(shadow, "HEAD"));
    } catch {
      await runGit(env, ["init", "--quiet"]);
    }

    await mkdir(join(shadow, "info"), { recursive: true, mode: 0o700 });
    await writeFile(
      join(shadow, "info", "attributes"),
      "* !text !eol !working-tree-encoding !filter\n",
      { mode: 0o600 },
    );
  });

  return env;
}

export interface FileLeaseLockOptions {
  readonly leaseMs: number;
  readonly refreshMs: number;
  readonly retryMs: number;
}

const DEFAULT_FILE_LEASE_LOCK_OPTIONS = {
  leaseMs: 30_000,
  refreshMs: 10_000,
  retryMs: 10,
} satisfies FileLeaseLockOptions;

export async function withFileLeaseLock<Result>(
  path: string,
  operation: () => Promise<Result>,
  options: FileLeaseLockOptions = DEFAULT_FILE_LEASE_LOCK_OPTIONS,
): Promise<Result> {
  const token = randomUUID();
  let handle: FileHandle;

  for (;;) {
    try {
      const created = await open(path, "wx", 0o600);

      try {
        await created.writeFile(token, "utf8");
      } catch (cause) {
        await created.close();
        await rm(path, { force: true });
        throw cause;
      }

      handle = created;
      break;
    } catch (cause) {
      if (!isFileError(cause, ["EEXIST"])) throw cause;
      const holder = statSync(path, { throwIfNoEntry: false });

      if (holder !== undefined && Date.now() - holder.mtimeMs > options.leaseMs) {
        const stalePath = `${path}.stale-${token}`;

        try {
          await rename(path, stalePath);
        } catch (renameCause) {
          // Another contender cleared the stale lock first.
          if (!isFileError(renameCause, ["ENOENT"])) throw renameCause;
          continue;
        }

        await rm(stalePath, { force: true });
        continue;
      }

      await new Promise<void>((resolveWait) => setTimeout(resolveWait, options.retryMs));
    }
  }

  const refresh = setInterval(() => {
    const now = new Date();
    void handle.utimes(now, now).catch(() => {});
  }, options.refreshMs);

  refresh.unref();

  try {
    return await operation();
  } finally {
    clearInterval(refresh);
    await handle.close();
    const owner = await readFile(path, "utf8").catch(() => "");

    if (owner === token) await rm(path, { force: true });
  }
}

function withShadowLock<Result>(
  env: ShadowEnvironment,
  operation: () => Promise<Result>,
): Promise<Result> {
  return withFileLeaseLock(join(env.shadow, "lock"), operation);
}

async function treeBlob(
  env: ShadowEnvironment,
  tree: TreeId,
  path: string,
): Promise<string | null> {
  const result = await runGit(env, ["ls-tree", "-z", tree, "--", path]);
  const record = result.stdout.split("\0").find((field) => field.endsWith(`\t${path}`));

  if (record === undefined) return null;
  const metadata = record.split("\t", 1)[0]?.split(" ");

  return metadata?.[2] ?? null;
}

async function currentBlob(env: ShadowEnvironment, path: string): Promise<string | null> {
  const absolute = resolve(env.workspace, path);
  const metadata = entryAt(absolute);

  if (metadata === undefined) return null;

  if (!metadata.isFile()) throw new Error(`Restore paths must be files: ${path}`);

  return (await runGit(env, ["hash-object", "--no-filters", "--", absolute])).stdout.trim();
}

export function createTreeSnapshot(options: TreeSnapshotOptions = {}): TreeSnapshot {
  const prepared = new Map<string, Promise<ShadowEnvironment>>();

  const ready = (cwd: string) => {
    let pending = prepared.get(cwd);

    if (pending !== undefined) return pending;
    pending = prepare(cwd).catch((cause: unknown) => {
      prepared.delete(cwd);
      throw cause;
    });
    prepared.set(cwd, pending);

    return pending;
  };

  const discard = async (input: { readonly cwd: string; readonly absolutePath: string }) => {
    if (options.discard !== undefined) {
      await options.discard(input.absolutePath);

      return;
    }

    const env = await ready(input.cwd);
    const relativePath = relative(env.workspace, input.absolutePath);
    const target = join(env.shadow, "trash", `${String(Date.now())}-${randomUUID()}`, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await rename(input.absolutePath, target);
  };

  const tree = async (input: { readonly cwd: string }): Promise<TreeOutcome> => {
    try {
      const env = await ready(input.cwd);

      return await withShadowLock(env, async () => {
        await runGit(env, ["add", "-A", "--", "."]);
        const written = await runGit(env, ["write-tree"]);

        return { kind: "tree", id: treeId(written.stdout.trim()) };
      });
    } catch (cause) {
      return { kind: "unavailable", reason: firstLine(cause, "git is unavailable") };
    }
  };

  const diffTrees = async (input: {
    readonly cwd: string;
    readonly from: TreeId;
    readonly to: TreeId;
    readonly paths?: readonly string[];
  }): Promise<readonly FileDiff[]> => {
    const env = await ready(input.cwd);

    const pathspec = input.paths === undefined ? [] : ["--", ...input.paths];
    const range = ["--find-renames", input.from, input.to];

    const [status, numstat, patch] = await Promise.all([
      runGit(env, ["diff", "--name-status", "-z", ...range, ...pathspec]),
      runGit(env, ["diff", "--numstat", "-z", ...range, ...pathspec]),
      runGit(env, ["diff", "--no-color", "--no-ext-diff", "--no-textconv", ...range, ...pathspec]),
    ]);

    const counts = parseNumstat(numstat.stdout);
    const patches = splitPatches(patch.stdout);

    return parseNameStatus(status.stdout).map((entry, index) => {
      const shared = {
        path: entry.path,
        added: counts[index]?.added ?? 0,
        removed: counts[index]?.removed ?? 0,
        patch: patches[index] ?? "",
      };

      return entry.kind === "renamed"
        ? { ...shared, kind: entry.kind, from: entry.from }
        : { ...shared, kind: entry.kind };
    });
  };

  const restoreTree = async (input: {
    readonly cwd: string;
    readonly from: TreeId;
    readonly expect: TreeId;
    readonly paths: readonly FileDiff[];
  }): Promise<
    | { readonly kind: "restored"; readonly files: readonly string[] }
    | { readonly kind: "conflict"; readonly paths: readonly string[] }
    | { readonly kind: "failed"; readonly reason: string }
  > => {
    try {
      const env = await ready(input.cwd);

      return await withShadowLock(env, async () => {
        const conflicts: string[] = [];

        for (const file of input.paths) {
          if (
            (await currentBlob(env, file.path)) !== (await treeBlob(env, input.expect, file.path))
          ) {
            conflicts.push(file.path);
          }

          if (
            file.kind === "renamed" &&
            (await currentBlob(env, file.from)) !== (await treeBlob(env, input.expect, file.from))
          ) {
            conflicts.push(file.from);
          }
        }

        if (conflicts.length > 0) return { kind: "conflict", paths: conflicts };

        if (input.paths.length === 0) return { kind: "restored", files: [] };
        const restore = new Set<string>();
        const remove = new Set<string>();

        for (const file of input.paths) {
          const target = file.kind === "renamed" ? file.from : file.path;

          if ((await treeBlob(env, input.from, target)) === null) remove.add(target);
          else restore.add(target);

          if (file.kind === "renamed") remove.add(file.path);
        }

        for (const path of remove) {
          const absolute = resolve(env.workspace, path);
          const metadata = entryAt(absolute);

          if (metadata === undefined) continue;

          if (metadata.isDirectory()) throw new Error(`Restore paths must be files: ${path}`);
          await discard({ cwd: input.cwd, absolutePath: absolute });
        }

        if (restore.size > 0) {
          await runGit(env, ["restore", `--source=${input.from}`, "--worktree", "--", ...restore]);
        }

        return { kind: "restored", files: input.paths.map((file) => file.path) };
      });
    } catch (cause) {
      return { kind: "failed", reason: firstLine(cause, "The restore failed.") };
    }
  };

  return { tree, diffTrees, restoreTree, discard };
}
