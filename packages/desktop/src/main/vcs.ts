import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readlink } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { createTwoFilesPatch } from "diff";
import { shell } from "electron";
import type { VcsBackend, VcsDiff, VcsStatus } from "@nyte-ai/core";
import type {
  DesktopGitSnapshot,
  DesktopVcsCommit,
  DesktopVcsCommitInput,
  DesktopVcsCommitResult,
  DesktopVcsContents,
  DesktopVcsContentsInput,
  DesktopVcsCreateBranch,
  DesktopVcsCreateBranchInput,
  DesktopVcsDiffInput,
  DesktopVcsHead,
  DesktopVcsLog,
  DesktopVcsLogInput,
  DesktopVcsPush,
  DesktopVcsPushInput,
  DesktopVcsRefs,
  DesktopVcsRevert,
  DesktopVcsRevertInput,
  DesktopVcsRevertSkip,
  DesktopVcsStage,
  DesktopVcsStageInput,
  DesktopVcsStageSkip,
} from "../shared/ipc.ts";
import { ensureShellEnvironment } from "./shell-environment.ts";

interface GitResult {
  readonly stdout: string;
  /** Blob reads need the bytes: NUL detection and the byte cap cannot run on decoded text. */
  readonly stdoutBytes: Buffer;
  readonly stderr: string;
  readonly code: number;
}

const MAX_UNTRACKED_PREVIEW_BYTES = 2_000_000;

class GitCommandError extends Error {
  readonly result: GitResult;

  constructor(args: readonly string[], result: GitResult) {
    super(result.stderr.trim() || `git ${args.join(" ")} exited ${String(result.code)}`);
    this.name = "GitCommandError";
    this.result = result;
  }
}

async function runGit(
  cwd: string,
  args: readonly string[],
  allowDifference = false,
): Promise<GitResult> {
  await ensureShellEnvironment();
  return new Promise((resolveResult, reject) => {
    const child = spawn("git", ["-c", "core.quotepath=false", ...args], {
      cwd,
      // A push that needs credentials must fail instead of waiting on a terminal nobody sees.
      env: { ...process.env, LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const stdoutBytes = Buffer.concat(stdout);
      const result = {
        stdout: stdoutBytes.toString("utf8"),
        stdoutBytes,
        stderr: Buffer.concat(stderr).toString("utf8"),
        code: code ?? -1,
      };
      if (result.code === 0 || (allowDifference && result.code === 1)) resolveResult(result);
      else reject(new GitCommandError(args, result));
    });
  });
}

interface StatusRead {
  readonly status: VcsStatus;
  readonly staged: VcsStatus["files"];
  readonly unstaged: VcsStatus["files"];
  readonly head: BranchHeader;
  readonly raw: string | undefined;
}

/** The `## ` record of a porcelain status: everything about HEAD but its oid. */
type BranchHeader = Omit<DesktopVcsHead, "oid">;

const DETACHED_HEAD: BranchHeader = { ahead: 0, behind: 0 };

async function readStatus(cwd: string): Promise<StatusRead> {
  try {
    const result = await runGit(cwd, [
      "status",
      "--short",
      "--branch",
      "--porcelain=v1",
      "--untracked-files=all",
      "-z",
    ]);
    return { ...parseGitStatus(result.stdout), raw: result.stdout };
  } catch (cause) {
    if (cause instanceof GitCommandError && cause.result.stderr.includes("not a git repository")) {
      return {
        status: { files: [] },
        staged: [],
        unstaged: [],
        head: DETACHED_HEAD,
        raw: undefined,
      };
    }
    throw cause;
  }
}

function branchHeader(record: string): BranchHeader {
  const raw = record
    .slice(3)
    .replace(/^No commits yet on /, "")
    .replace(/^Initial commit on /, "");
  const divergence = /\[([^\]]*)\]\s*$/.exec(raw);
  const counts = divergence?.[1] ?? "";
  const ahead = Number(/ahead (\d+)/.exec(counts)?.[1] ?? 0);
  const behind = Number(/behind (\d+)/.exec(counts)?.[1] ?? 0);
  const names = (divergence === null ? raw : raw.slice(0, divergence.index)).trim();
  if (names === "" || names === "HEAD (no branch)") return { ahead, behind };
  const [branch, upstream] = names.split("...");
  if (branch === undefined || branch === "") return { ahead, behind };
  return upstream === undefined || upstream === ""
    ? { branch, ahead, behind }
    : { branch, upstream, ahead, behind };
}

function statusKind(code: string): VcsStatus["files"][number]["kind"] {
  if (code === "??") return "untracked";
  if (code.includes("D")) return "deleted";
  if (code.includes("A")) return "added";
  return "modified";
}

/** The index column of a porcelain record, or undefined when the index is clean. */
function indexKind(code: string): VcsStatus["files"][number]["kind"] | undefined {
  if (code === "A") return "added";
  if (code === "D") return "deleted";
  if (code === "M" || code === "R" || code === "C" || code === "T") return "modified";
  return undefined;
}

/** The worktree column of a porcelain record, or undefined when it matches the index. */
function worktreeKind(code: string): VcsStatus["files"][number]["kind"] | undefined {
  if (code === "?") return "untracked";
  if (code === "A") return "added";
  if (code === "D") return "deleted";
  if (code === "M" || code === "T") return "modified";
  return undefined;
}

function parseGitStatus(output: string): Omit<StatusRead, "raw"> {
  const records = output.split("\0");
  const files: VcsStatus["files"][number][] = [];
  const staged: VcsStatus["files"][number][] = [];
  const unstaged: VcsStatus["files"][number][] = [];
  let head = DETACHED_HEAD;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record === undefined || record === "") continue;
    if (record.startsWith("## ")) {
      head = branchHeader(record);
      continue;
    }
    if (record.length < 4) continue;
    const code = record.slice(0, 2);
    const path = record.slice(3);
    files.push({ path, kind: statusKind(code) });
    const indexChange = indexKind(code.slice(0, 1));
    if (indexChange !== undefined) staged.push({ path, kind: indexChange });
    const worktreeChange = worktreeKind(code.slice(1, 2));
    if (worktreeChange !== undefined) unstaged.push({ path, kind: worktreeChange });
    // With -z, rename/copy records carry the old path as the next NUL field.
    if (code.includes("R") || code.includes("C")) index += 1;
  }
  const status = head.branch === undefined ? { files } : { branch: head.branch, files };
  return { status, staged, unstaged, head };
}

function safeWorkspacePath(cwd: string, path: string): string {
  const absolute = resolve(cwd, path);
  const within = relative(cwd, absolute);
  if (path === "" || isAbsolute(within) || within === ".." || within.startsWith("../")) {
    throw new Error(`Path is outside the workspace: ${path}`);
  }
  return absolute;
}

async function untrackedPatch(cwd: string, path: string): Promise<string> {
  const absolute = safeWorkspacePath(cwd, path);
  const metadata = await lstat(absolute);
  if (metadata.size > MAX_UNTRACKED_PREVIEW_BYTES)
    return `File is too large to preview: b/${path}\n`;
  const contents = metadata.isSymbolicLink()
    ? Buffer.from(await readlink(absolute), "utf8")
    : await readFile(absolute);
  if (contents.includes(0)) return `Binary file b/${path}\n`;
  return createTwoFilesPatch("/dev/null", `b/${path}`, "", contents.toString("utf8"), "", "");
}

async function trackedPatch(cwd: string, path: string, flags: readonly string[]): Promise<string> {
  try {
    return (
      await runGit(cwd, ["diff", "--no-ext-diff", "--no-color", ...flags, "HEAD", "--", path])
    ).stdout;
  } catch (error) {
    if (
      !(error instanceof GitCommandError) ||
      (!error.result.stderr.includes("unknown revision") &&
        !error.result.stderr.includes("bad revision") &&
        !error.result.stderr.includes("ambiguous argument 'HEAD'"))
    ) {
      throw error;
    }
    const [staged, unstaged] = await Promise.all([
      runGit(cwd, ["diff", "--cached", "--no-ext-diff", "--no-color", ...flags, "--", path]),
      runGit(cwd, ["diff", "--no-ext-diff", "--no-color", ...flags, "--", path]),
    ]);
    return `${staged.stdout}${unstaged.stdout}`;
  }
}

async function fileRevisionPart(cwd: string, path: string): Promise<string> {
  try {
    const metadata = await lstat(safeWorkspacePath(cwd, path), { bigint: true });
    return [
      path,
      metadata.dev,
      metadata.ino,
      metadata.mode,
      metadata.size,
      metadata.mtimeNs,
      metadata.ctimeNs,
    ].join(":");
  } catch {
    return `${path}:missing`;
  }
}

async function repositorySnapshot(cwd: string, read: StatusRead): Promise<DesktopGitSnapshot> {
  if (read.raw === undefined) {
    return {
      kind: "not_repository",
      repositoryId: cwd,
      revision: "not-repository",
      status: read.status,
      head: { oid: null, ahead: 0, behind: 0 },
      staged: read.staged,
      unstaged: read.unstaged,
    };
  }
  const [root, head, index, files] = await Promise.all([
    runGit(cwd, ["rev-parse", "--show-toplevel"]),
    runGit(cwd, ["rev-parse", "--verify", "HEAD"]).catch((): GitResult => ({
      stdout: "unborn",
      stdoutBytes: Buffer.from("unborn", "utf8"),
      stderr: "",
      code: 0,
    })),
    runGit(cwd, ["ls-files", "--stage", "-z"]),
    Promise.all(read.status.files.map((file) => fileRevisionPart(cwd, file.path))),
  ]);
  const repositoryId = root.stdout.trim() || cwd;
  const revision = createHash("sha256")
    .update(repositoryId)
    .update("\0")
    .update(cwd)
    .update("\0")
    .update(head.stdout)
    .update("\0")
    .update(index.stdout)
    .update("\0")
    .update(read.raw)
    .update("\0")
    .update(files.join("\0"))
    .digest("hex");
  const oid = head.stdout.trim();
  return {
    kind: "repository",
    repositoryId,
    revision,
    status: read.status,
    head: { oid: oid === "unborn" ? null : oid, ...read.head },
    staged: read.staged,
    unstaged: read.unstaged,
  };
}

interface SideBytes {
  readonly bytes: Buffer;
}

/**
 * A blob that is absent from the base revision is an ordinary answer for added
 * or untracked files, so only these known git phrasings become `null`.
 */
const MISSING_BLOB_MESSAGES = [
  "does not exist",
  "exists on disk, but not in",
  "unknown revision",
  "bad revision",
  "ambiguous argument",
  "Not a valid object name",
  "is in the index, but not at stage",
];

async function baseSide(
  cwd: string,
  path: string,
  base: DesktopVcsContentsInput["base"],
): Promise<SideBytes | null> {
  // Reject traversal before naming the path to git, even though git reads the object store.
  safeWorkspacePath(cwd, path);
  const revision = base === "head" ? `HEAD:${path}` : `:0:${path}`;
  try {
    return { bytes: (await runGit(cwd, ["show", revision])).stdoutBytes };
  } catch (error) {
    if (!(error instanceof GitCommandError)) throw error;
    const message = error.result.stderr;
    if (MISSING_BLOB_MESSAGES.some((phrase) => message.includes(phrase))) return null;
    throw error;
  }
}

async function workingTreeSide(cwd: string, path: string): Promise<SideBytes | null> {
  const absolute = safeWorkspacePath(cwd, path);
  try {
    const metadata = await lstat(absolute);
    if (metadata.isSymbolicLink()) return { bytes: Buffer.from(await readlink(absolute), "utf8") };
    if (!metadata.isFile()) return null;
    return { bytes: await readFile(absolute) };
  } catch {
    return null;
  }
}

async function fileContents(
  cwd: string,
  input: DesktopVcsContentsInput,
): Promise<DesktopVcsContents> {
  const [old, current] = await Promise.all([
    baseSide(cwd, input.path, input.base),
    workingTreeSide(cwd, input.path),
  ]);
  const sides = [old, current].filter((side): side is SideBytes => side !== null);
  const binary = sides.some((side) => side.bytes.includes(0));
  const truncated =
    !binary && sides.some((side) => side.bytes.byteLength > MAX_UNTRACKED_PREVIEW_BYTES);
  const read = (side: SideBytes | null) => {
    if (side === null) return null;
    if (binary) return { contents: "" };
    return { contents: side.bytes.subarray(0, MAX_UNTRACKED_PREVIEW_BYTES).toString("utf8") };
  };
  return { path: input.path, old: read(old), new: read(current), binary, truncated };
}

export interface DesktopGitVcs extends VcsBackend {
  readonly snapshot: () => Promise<DesktopGitSnapshot>;
  readonly contents: (input: DesktopVcsContentsInput) => Promise<DesktopVcsContents>;
  /** Named scopes beside the core backend's HEAD-only `diff`. */
  readonly scopedDiff: (input: DesktopVcsDiffInput) => Promise<readonly VcsDiff[]>;
  readonly log: (input: DesktopVcsLogInput) => Promise<DesktopVcsLog>;
  readonly refs: () => Promise<DesktopVcsRefs>;
  /** Discard working-tree state per path. The only mutating read of this backend. */
  readonly revert: (input: DesktopVcsRevertInput) => Promise<DesktopVcsRevert>;
  /** Add paths to the index or remove them from it, path by path. */
  readonly stage: (input: DesktopVcsStageInput) => Promise<DesktopVcsStage>;
  /** Commit the index, the named paths, or every tracked change. Never runs through a shell. */
  readonly commit: (input: DesktopVcsCommitInput) => Promise<DesktopVcsCommitResult>;
  readonly createBranch: (input: DesktopVcsCreateBranchInput) => Promise<DesktopVcsCreateBranch>;
  /** Push the current branch. Never forced and never from a detached HEAD. */
  readonly push: (input: DesktopVcsPushInput) => Promise<DesktopVcsPush>;
}

/** A revision the caller named. Git would read a leading `-` as an option. */
function checkedRevision(revision: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/^~@{}-]*$/.test(revision)) {
    throw new Error(`Not a usable revision: ${revision}`);
  }
  return revision;
}

async function changedPaths(cwd: string, args: readonly string[]): Promise<readonly string[]> {
  const result = await runGit(cwd, args);
  return result.stdout.split("\0").filter((path) => path !== "");
}

async function collectPatches(
  paths: readonly string[],
  patchOf: (path: string) => Promise<string>,
): Promise<readonly VcsDiff[]> {
  const diffs = await Promise.all(
    paths.map(async (path): Promise<VcsDiff | undefined> => {
      const patch = await patchOf(path);
      return patch === "" ? undefined : { path, patch };
    }),
  );
  return diffs.filter((diff): diff is VcsDiff => diff !== undefined);
}

/** Today's panel view: every change since the last commit, staged or not. */
async function worktreeDiff(
  cwd: string,
  read: StatusRead,
  input: DesktopVcsDiffInput,
  flags: readonly string[],
): Promise<readonly VcsDiff[]> {
  const byPath = new Map(read.status.files.map((file) => [file.path, file.kind]));
  const paths = input.paths ?? read.status.files.map((file) => file.path);
  return collectPatches(paths, async (path) => {
    const kind = byPath.get(path);
    if (kind === undefined) return "";
    return kind === "untracked"
      ? await untrackedPatch(cwd, path)
      : await trackedPatch(cwd, path, flags);
  });
}

async function scopedDiff(cwd: string, input: DesktopVcsDiffInput): Promise<readonly VcsDiff[]> {
  const flags = input.ignoreWhitespace === true ? ["-w"] : [];
  for (const path of input.paths ?? []) safeWorkspacePath(cwd, path);
  if (input.scope === "commit") {
    if (input.commit === undefined) throw new Error("The commit scope needs a commit.");
    const commit = checkedRevision(input.commit);
    const paths =
      input.paths ??
      (await changedPaths(cwd, [
        "diff-tree",
        "-r",
        "--root",
        "--no-commit-id",
        "--name-only",
        "-z",
        commit,
      ]));
    return collectPatches(paths, async (path) => {
      const shown = await runGit(cwd, [
        "show",
        "--format=",
        "--no-ext-diff",
        "--no-color",
        ...flags,
        commit,
        "--",
        path,
      ]);
      return shown.stdout;
    });
  }
  const read = await readStatus(cwd);
  if (input.scope === "worktree") return worktreeDiff(cwd, read, input, flags);
  const cached = input.scope === "staged" ? ["--cached"] : [];
  // Untracked files have no index entry, so `git diff` never reports them.
  const untracked = new Set(
    input.scope === "unstaged"
      ? read.unstaged.filter((file) => file.kind === "untracked").map((file) => file.path)
      : [],
  );
  const named =
    input.paths ?? (await changedPaths(cwd, ["diff", ...cached, "--name-only", "-z", ...flags]));
  const tracked = await collectPatches(
    named.filter((path) => !untracked.has(path)),
    async (path) =>
      (await runGit(cwd, ["diff", ...cached, "--no-ext-diff", "--no-color", ...flags, "--", path]))
        .stdout,
  );
  const synthesized = await collectPatches(
    [...untracked].filter((path) => input.paths === undefined || input.paths.includes(path)),
    (path) => untrackedPatch(cwd, path),
  );
  return [...tracked, ...synthesized];
}

/**
 * Unit separators between fields and a record separator between commits: a
 * subject can hold anything but these control characters.
 */
const LOG_FORMAT = "%H%x1f%h%x1f%an%x1f%ct%x1f%s%x1e";

function parseCommit(record: string): DesktopVcsCommit | undefined {
  const [oid, shortOid, author, committed, subject] = record.replace(/^\n/, "").split("\u001f");
  if (oid === undefined || shortOid === undefined || author === undefined) return undefined;
  if (committed === undefined || subject === undefined) return undefined;
  return { oid, shortOid, subject, author, committedAt: Number(committed) * 1000 };
}

async function readLog(cwd: string, input: DesktopVcsLogInput): Promise<DesktopVcsLog> {
  const limit = Math.max(1, Math.trunc(input.limit));
  const start = input.before === undefined ? "HEAD" : checkedRevision(input.before);
  // One extra commit answers `hasMore` without counting the whole history.
  const args = [
    "log",
    `--max-count=${String(limit + 1)}`,
    ...(input.before === undefined ? [] : ["--skip=1"]),
    `--format=${LOG_FORMAT}`,
    start,
  ];
  const result = await runGit(cwd, args).catch((error: unknown) => {
    // An unborn HEAD has no history to page through; anything else is a real failure.
    if (
      error instanceof GitCommandError &&
      (error.result.stderr.includes("does not have any commits") ||
        error.result.stderr.includes("unknown revision") ||
        error.result.stderr.includes("ambiguous argument 'HEAD'"))
    ) {
      return undefined;
    }
    throw error;
  });
  if (result === undefined) return { commits: [], hasMore: false };
  const commits = result.stdout
    .split("\u001e")
    .filter((record) => record.replace(/^\n/, "") !== "")
    .map(parseCommit)
    .filter((commit): commit is DesktopVcsCommit => commit !== undefined);
  return { commits: commits.slice(0, limit), hasMore: commits.length > limit };
}

function refNames(result: GitResult): readonly string[] {
  return result.stdout.split("\n").filter((name) => name !== "");
}

async function readRefs(cwd: string): Promise<DesktopVcsRefs> {
  const [current, local, remote] = await Promise.all([
    // A detached HEAD is not a symbolic ref, so this exits non-zero there.
    runGit(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"])
      .then((result) => result.stdout.trim())
      .catch(() => ""),
    runGit(cwd, ["for-each-ref", "--format=%(refname)", "refs/heads"]),
    runGit(cwd, ["for-each-ref", "--format=%(refname)", "refs/remotes"]),
  ]);
  const refs = {
    local: refNames(local).map((name) => name.replace("refs/heads/", "")),
    // `refs/remotes/<remote>/HEAD` is the remote's default-branch pointer, not a branch.
    remote: refNames(remote)
      .filter((name) => !name.endsWith("/HEAD"))
      .map((name) => name.replace("refs/remotes/", "")),
  };
  return current === "" ? refs : { current, ...refs };
}

/** Moving a file out of the way is the trash's job; a revert never unlinks one. */
type TrashItem = (absolutePath: string) => Promise<void>;

async function revertOne(
  cwd: string,
  path: string,
  kind: VcsStatus["files"][number]["kind"],
  trashItem: TrashItem,
): Promise<DesktopVcsRevertSkip | undefined> {
  const absolute = safeWorkspacePath(cwd, path);
  try {
    if (kind === "untracked") await trashItem(absolute);
    else await runGit(cwd, ["restore", "--source=HEAD", "--staged", "--worktree", "--", path]);
    return undefined;
  } catch (cause) {
    // A file git or the trash refuses leaves the rest of the batch alone.
    return { path, reason: failureReason(cause, "Revert failed.") };
  }
}

async function revertPaths(
  cwd: string,
  input: DesktopVcsRevertInput,
  trashItem: TrashItem,
): Promise<DesktopVcsRevert> {
  // Every path is checked before anything is touched, so traversal fails the whole call.
  for (const path of input.paths) safeWorkspacePath(cwd, path);
  const read = await readStatus(cwd);
  const kinds = new Map(read.status.files.map((file) => [file.path, file.kind]));
  const reverted: string[] = [];
  const skipped: DesktopVcsRevertSkip[] = [];
  // One path at a time: git's index lock is not shared, and a failure must name its own path.
  for (const path of input.paths) {
    const kind = kinds.get(path);
    if (kind === undefined) {
      skipped.push({ path, reason: "This file has no changes to revert." });
      continue;
    }
    const failure = await revertOne(cwd, path, kind, trashItem);
    if (failure === undefined) reverted.push(path);
    else skipped.push(failure);
  }
  return { reverted, skipped };
}

/** git's own first line, which is what the reader can act on. */
function failureReason(cause: unknown, fallback: string): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  const line = message.split("\n").find((candidate) => candidate.trim() !== "");
  return line === undefined ? fallback : line.trim();
}

/** A failed git command explains itself on stderr, and hooks often on stdout. */
function commandReason(result: GitResult, fallback: string): string {
  const line = [...result.stderr.split("\n"), ...result.stdout.split("\n")]
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate !== "");
  return line === undefined ? fallback : line;
}

async function succeeds(cwd: string, args: readonly string[]): Promise<boolean> {
  try {
    await runGit(cwd, args);
    return true;
  } catch (cause) {
    if (cause instanceof GitCommandError) return false;
    throw cause;
  }
}

function stageArgs(path: string, staged: boolean, born: boolean): readonly string[] {
  if (staged) return ["add", "--", path];
  // Before the first commit there is no committed side to restore an index entry from.
  if (born) return ["restore", "--staged", "--", path];
  return ["rm", "--cached", "--force", "--quiet", "--", path];
}

async function stagePaths(cwd: string, input: DesktopVcsStageInput): Promise<DesktopVcsStage> {
  // Every path is checked before anything is touched, so traversal fails the whole call.
  for (const path of input.paths) safeWorkspacePath(cwd, path);
  const born = input.staged ? true : await succeeds(cwd, ["rev-parse", "--verify", "HEAD"]);
  const staged: string[] = [];
  const skipped: DesktopVcsStageSkip[] = [];
  // One path at a time: git's index lock is not shared, and a failure must name its own path.
  for (const path of input.paths) {
    try {
      await runGit(cwd, stageArgs(path, input.staged, born));
      staged.push(path);
    } catch (cause) {
      skipped.push({ path, reason: failureReason(cause, "Git refused this path.") });
    }
  }
  return { staged, skipped };
}

/** git says this on stdout, and the caller sees an ordinary state rather than a failure. */
const NOTHING_TO_COMMIT = [
  "nothing to commit",
  "no changes added to commit",
  "nothing added to commit",
];

async function commitChanges(
  cwd: string,
  input: DesktopVcsCommitInput,
): Promise<DesktopVcsCommitResult> {
  if (input.message.trim() === "") {
    return { kind: "failed", reason: "Write a commit message first." };
  }
  for (const path of input.paths ?? []) safeWorkspacePath(cwd, path);
  // The message is one argument; no shell ever sees it.
  const args = [
    "commit",
    ...(input.all === true ? ["--all"] : []),
    "-m",
    input.message,
    ...(input.paths === undefined ? [] : ["--", ...input.paths]),
  ];
  try {
    await runGit(cwd, args);
  } catch (cause) {
    if (!(cause instanceof GitCommandError)) throw cause;
    const output = `${cause.result.stdout}\n${cause.result.stderr}`;
    if (NOTHING_TO_COMMIT.some((phrase) => output.includes(phrase))) {
      return { kind: "nothing_to_commit" };
    }
    // A rejected hook, a signing or identity problem, and a conflict all land here.
    return { kind: "failed", reason: commandReason(cause.result, "The commit failed.") };
  }
  const shown = await runGit(cwd, ["show", "--no-patch", "--format=%H%x1f%h%x1f%s", "HEAD"]);
  const [oid, shortOid, summary] = shown.stdout.trim().split("\u001f");
  if (oid === undefined || shortOid === undefined || summary === undefined) {
    return { kind: "failed", reason: "The commit was made but could not be read back." };
  }
  return { kind: "committed", oid, shortOid, summary };
}

async function createBranch(
  cwd: string,
  input: DesktopVcsCreateBranchInput,
): Promise<DesktopVcsCreateBranch> {
  const name = input.name;
  // A leading dash would read as an option; `check-ref-format` owns every other rule.
  if (name.startsWith("-")) {
    return { kind: "invalid_name", reason: "A branch name cannot start with a dash." };
  }
  if (!(await succeeds(cwd, ["check-ref-format", `refs/heads/${name}`]))) {
    return { kind: "invalid_name", reason: "Git does not accept this branch name." };
  }
  if (await succeeds(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${name}`])) {
    return { kind: "exists" };
  }
  try {
    await runGit(cwd, input.checkout ? ["checkout", "-b", name] : ["branch", name]);
    return { kind: "created" };
  } catch (cause) {
    if (!(cause instanceof GitCommandError)) throw cause;
    if (cause.result.stderr.includes("already exists")) return { kind: "exists" };
    return { kind: "failed", reason: commandReason(cause.result, "The branch was not created.") };
  }
}

async function gitValue(cwd: string, args: readonly string[]): Promise<string | undefined> {
  try {
    const value = (await runGit(cwd, args)).stdout.trim();
    return value === "" ? undefined : value;
  } catch (cause) {
    if (cause instanceof GitCommandError) return undefined;
    throw cause;
  }
}

const PUSH_REJECTED = ["[rejected]", "non-fast-forward", "fetch first", "Updates were rejected"];

function rejectionReason(result: GitResult): string {
  const line = [...result.stderr.split("\n"), ...result.stdout.split("\n")]
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.includes("[rejected]"));
  return line ?? "The remote rejected this push. Pull first, then push again.";
}

async function runPush(
  cwd: string,
  args: readonly string[],
  remote: string,
  branch: string,
): Promise<DesktopVcsPush> {
  try {
    const result = await runGit(cwd, args);
    const output = `${result.stdout}\n${result.stderr}`;
    return output.includes("Everything up-to-date")
      ? { kind: "up_to_date", remote, branch }
      : { kind: "pushed", remote, branch };
  } catch (cause) {
    if (!(cause instanceof GitCommandError)) throw cause;
    const output = `${cause.result.stdout}\n${cause.result.stderr}`;
    if (PUSH_REJECTED.some((phrase) => output.includes(phrase))) {
      return { kind: "rejected", branch, reason: rejectionReason(cause.result) };
    }
    return { kind: "failed", branch, reason: commandReason(cause.result, "The push failed.") };
  }
}

/** No force, ever: a rejected push is answered, never retried with a wider flag. */
async function pushCurrentBranch(cwd: string, input: DesktopVcsPushInput): Promise<DesktopVcsPush> {
  const branch = await gitValue(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (branch === undefined) {
    return {
      kind: "failed",
      reason: "HEAD is detached, so there is no branch to push. Check out a branch first.",
    };
  }
  const upstream = await gitValue(cwd, ["rev-parse", "--abbrev-ref", "@{upstream}"]);
  if (upstream !== undefined) {
    const remote = await gitValue(cwd, ["config", "--get", `branch.${branch}.remote`]);
    return runPush(cwd, ["push"], remote ?? upstream.split("/")[0] ?? "origin", branch);
  }
  if (input.setUpstream !== true) return { kind: "no_upstream", branch };
  const remotes =
    (await gitValue(cwd, ["remote"]))
      ?.split("\n")
      .map((name) => name.trim())
      .filter((name) => name !== "") ?? [];
  const only = remotes.length === 1 ? remotes[0] : undefined;
  // Publishing a branch must name one remote; guessing among several would push somewhere unasked.
  if (only === undefined) {
    return {
      kind: "failed",
      branch,
      reason:
        remotes.length === 0
          ? "This repository has no remote. Add one, then push."
          : `This repository has several remotes (${remotes.join(", ")}). Push to one of them from a terminal.`,
    };
  }
  return runPush(cwd, ["push", "--set-upstream", only, branch], only, branch);
}

export interface GitVcsOptions {
  /**
   * Electron owns the trash. Tests pass their own so no test can reach the
   * real one, and so a revert is provable without an Electron runtime.
   */
  readonly trashItem?: TrashItem;
}

/** Git-backed whole-tree truth for the core workspace.vcs projection. */
export function createGitVcs(cwd: string, options: GitVcsOptions = {}): DesktopGitVcs {
  const trashItem = options.trashItem ?? ((absolute: string) => shell.trashItem(absolute));
  const status = async (): Promise<VcsStatus> => {
    return (await readStatus(cwd)).status;
  };

  return {
    status,
    async snapshot() {
      const read = await readStatus(cwd);
      return repositorySnapshot(cwd, read);
    },
    async contents(input) {
      return fileContents(cwd, input);
    },
    async scopedDiff(input) {
      return scopedDiff(cwd, input);
    },
    async log(input) {
      return readLog(cwd, input);
    },
    async refs() {
      return readRefs(cwd);
    },
    async revert(input) {
      return revertPaths(cwd, input, trashItem);
    },
    async stage(input) {
      return stagePaths(cwd, input);
    },
    async commit(input) {
      return commitChanges(cwd, input);
    },
    async createBranch(input) {
      return createBranch(cwd, input);
    },
    async push(input) {
      return pushCurrentBranch(cwd, input);
    },
    async diff(input): Promise<readonly VcsDiff[]> {
      const read = await readStatus(cwd);
      return worktreeDiff(cwd, read, { scope: "worktree", paths: input?.paths }, []);
    },
  };
}
