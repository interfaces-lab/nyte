/**
 * Git as the SDK's version-control backend. Every operation runs `git` at the
 * directory the SDK resolved; a directory outside any repository answers
 * `none` and empty reads. Nothing here runs through a shell, nothing is ever
 * forced, and a discard never unlinks a file: untracked paths go to `discard`,
 * which the desktop points at the OS trash.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readlink } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { createTwoFilesPatch } from "diff";
import { parsePatchFacts, worktreeFiles } from "@nyte-ai/client";
import type { VcsBackend } from "@nyte-ai/core";
import type {
  VcsBranchOutcome,
  VcsCommitInfo,
  VcsCommitOutcome,
  VcsContents,
  VcsDiff,
  VcsFile,
  VcsFileKind,
  VcsHead,
  VcsLog,
  VcsPathsOutcome,
  VcsPushOutcome,
  VcsRefs,
  VcsScope,
  VcsSnapshot,
} from "@nyte-ai/protocol";
import { createTreeSnapshot } from "./tree-snapshot.ts";

interface GitResult {
  readonly stdout: string;
  /** Blob reads need the bytes: NUL detection and the byte cap cannot run on decoded text. */
  readonly stdoutBytes: Buffer;
  readonly stderr: string;
  readonly code: number;
}

const MAX_PREVIEW_BYTES = 2_000_000;

class GitCommandError extends Error {
  readonly result: GitResult;

  constructor(args: readonly string[], result: GitResult) {
    super(result.stderr.trim() || `git ${args.join(" ")} exited ${String(result.code)}`);
    this.name = "GitCommandError";
    this.result = result;
  }
}

function runGit(cwd: string, args: readonly string[]): Promise<GitResult> {
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
      if (result.code === 0) resolveResult(result);
      else reject(new GitCommandError(args, result));
    });
  });
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

async function succeeds(cwd: string, args: readonly string[]): Promise<boolean> {
  try {
    await runGit(cwd, args);
    return true;
  } catch (cause) {
    if (cause instanceof GitCommandError) return false;
    throw cause;
  }
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

/** A revision the caller named. Git would read a leading `-` as an option. */
function checkedRevision(revision: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/^~@{}-]*$/.test(revision)) {
    throw new Error(`Not a usable revision: ${revision}`);
  }
  return revision;
}

function safeWorkspacePath(cwd: string, path: string): string {
  const absolute = resolve(cwd, path);
  const within = relative(cwd, absolute);
  if (path === "" || isAbsolute(within) || within === ".." || within.startsWith("../")) {
    throw new Error(`Path is outside the workspace: ${path}`);
  }
  return absolute;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

interface StatusRead {
  readonly head: Omit<VcsHead, "oid" | "base">;
  readonly staged: readonly VcsFile[];
  readonly unstaged: readonly VcsFile[];
  readonly raw: string;
}

function branchHeader(record: string): StatusRead["head"] {
  const raw = record
    .slice(3)
    .replace(/^No commits yet on /, "")
    .replace(/^Initial commit on /, "");
  const divergence = /\[([^\]]*)\]\s*$/.exec(raw);
  const counts = divergence?.[1] ?? "";
  const ahead = Number(/ahead (\d+)/.exec(counts)?.[1] ?? 0);
  const behind = Number(/behind (\d+)/.exec(counts)?.[1] ?? 0);
  const names = (divergence === null ? raw : raw.slice(0, divergence.index)).trim();
  if (names === "" || names === "HEAD (no branch)") return { branch: { kind: "detached" } };
  const [name, upstream] = names.split("...");
  if (name === undefined || name === "") return { branch: { kind: "detached" } };
  return {
    branch: {
      kind: "named",
      name,
      upstream:
        upstream === undefined || upstream === "" ? null : { name: upstream, ahead, behind },
    },
  };
}

const CONFLICT_CODES = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

/** The index column of a porcelain record, or undefined when the index is clean. */
function indexKind(code: string): Exclude<VcsFileKind, "untracked" | "conflicted"> | undefined {
  if (code === "A") return "added";
  if (code === "D") return "deleted";
  if (code === "R") return "renamed";
  if (code === "M" || code === "C" || code === "T") return "modified";
  return undefined;
}

/** The worktree column of a porcelain record, or undefined when it matches the index. */
function worktreeKind(code: string): Exclude<VcsFileKind, "conflicted"> | undefined {
  if (code === "?") return "untracked";
  if (code === "A") return "added";
  if (code === "D") return "deleted";
  if (code === "R") return "renamed";
  if (code === "M" || code === "T") return "modified";
  return undefined;
}

function fileOf(path: string, kind: Exclude<VcsFileKind, "conflicted">, from: string): VcsFile {
  return kind === "renamed" ? { path, kind, from } : { path, kind };
}

function parseStatus(output: string): Omit<StatusRead, "raw"> {
  const records = output.split("\0");
  const staged: VcsFile[] = [];
  const unstaged: VcsFile[] = [];
  let head: StatusRead["head"] = { branch: { kind: "detached" } };
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
    // With -z, rename/copy records carry the old path as the next NUL field.
    const from = code.includes("R") || code.includes("C") ? (records[index + 1] ?? "") : "";
    if (from !== "") index += 1;
    if (CONFLICT_CODES.has(code)) {
      unstaged.push({ path, kind: "conflicted" });
      continue;
    }
    const indexChange = indexKind(code.slice(0, 1));
    if (indexChange !== undefined) staged.push(fileOf(path, indexChange, from));
    const worktreeChange = worktreeKind(code.slice(1, 2));
    if (worktreeChange !== undefined) unstaged.push(fileOf(path, worktreeChange, from));
  }
  return { head, staged, unstaged };
}

async function readStatus(cwd: string): Promise<StatusRead | undefined> {
  try {
    const result = await runGit(cwd, [
      "status",
      "--short",
      "--branch",
      "--porcelain=v1",
      "--untracked-files=all",
      "-z",
    ]);
    return { ...parseStatus(result.stdout), raw: result.stdout };
  } catch (cause) {
    if (cause instanceof GitCommandError && cause.result.stderr.includes("not a git repository")) {
      return undefined;
    }
    throw cause;
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

/**
 * The branch this one was created from. `checkout -b` records "Created from
 * HEAD" on the branch, so HEAD's own reflog names what HEAD was at the time.
 * Reflogs list newest first; the last match is the creation.
 */
async function createdFrom(cwd: string, branch: string): Promise<string | undefined> {
  const own = await gitValue(cwd, ["reflog", "show", "--format=%gs", `refs/heads/${branch}`]);
  const created = /^branch: Created from (.+)$/.exec(own?.split("\n").at(-1) ?? "")?.[1];
  if (created === undefined) return undefined;
  if (created !== "HEAD") return created === branch ? undefined : created;
  const head = await gitValue(cwd, ["reflog", "show", "--format=%gs", "HEAD"]);
  const moved = (head ?? "")
    .split("\n")
    .map((line) => /^checkout: moving from (.+) to (.+)$/.exec(line))
    .findLast((match) => match !== null && match[2] === branch)?.[1];
  return moved === undefined || moved === branch ? undefined : moved;
}

/**
 * Where a review of this branch starts: the branch its reflog says it was
 * created from, else the remote's default branch. The default branch is no
 * base for itself.
 */
async function reviewBase(
  cwd: string,
  branch: StatusRead["head"]["branch"],
): Promise<VcsHead["base"]> {
  if (branch.kind === "detached") return null;
  const origin = await createdFrom(cwd, branch.name);
  if (origin !== undefined) return { name: origin, source: "reflog" };
  const remoteHead = await gitValue(cwd, [
    "symbolic-ref",
    "--quiet",
    "--short",
    "refs/remotes/origin/HEAD",
  ]);
  if (remoteHead === undefined || remoteHead.split("/").slice(1).join("/") === branch.name)
    return null;
  return { name: remoteHead, source: "default" };
}

async function snapshot(cwd: string): Promise<VcsSnapshot> {
  const read = await readStatus(cwd);
  if (read === undefined) return { kind: "none" };
  const changed = worktreeFiles(read);
  const [root, oid, index, files, base] = await Promise.all([
    runGit(cwd, ["rev-parse", "--show-toplevel"]),
    gitValue(cwd, ["rev-parse", "--verify", "HEAD"]),
    runGit(cwd, ["ls-files", "--stage", "-z"]),
    Promise.all(changed.map((file) => fileRevisionPart(cwd, file.path))),
    reviewBase(cwd, read.head.branch),
  ]);
  const revision = createHash("sha256")
    .update(root.stdout)
    .update("\0")
    .update(cwd)
    .update("\0")
    .update(oid ?? "unborn")
    .update("\0")
    .update(index.stdout)
    .update("\0")
    .update(read.raw)
    .update("\0")
    .update(files.join("\0"))
    .digest("hex");
  return {
    kind: "repository",
    root: root.stdout.trim() || cwd,
    revision,
    head: { oid: oid ?? null, branch: read.head.branch, base },
    staged: read.staged,
    unstaged: read.unstaged,
  };
}

// ---------------------------------------------------------------------------
// Diffs
// ---------------------------------------------------------------------------

async function untrackedPatch(cwd: string, path: string): Promise<string> {
  const absolute = safeWorkspacePath(cwd, path);
  const metadata = await lstat(absolute);
  if (metadata.size > MAX_PREVIEW_BYTES) return `File is too large to preview: b/${path}\n`;
  const contents = metadata.isSymbolicLink()
    ? Buffer.from(await readlink(absolute), "utf8")
    : await readFile(absolute);
  if (contents.includes(0)) return `Binary file b/${path}\n`;
  return createTwoFilesPatch("/dev/null", `b/${path}`, "", contents.toString("utf8"), "", "");
}

const DIFF_FLAGS = ["--no-ext-diff", "--no-color", "--find-renames"];

const MISSING_HEAD = ["unknown revision", "bad revision", "ambiguous argument 'HEAD'"];

function isMissingHead(cause: unknown): boolean {
  return (
    cause instanceof GitCommandError &&
    MISSING_HEAD.some((phrase) => cause.result.stderr.includes(phrase))
  );
}

/** Before the first commit there is no HEAD to diff against; both sides of the index stand in. */
async function worktreePatch(cwd: string, flags: readonly string[], paths: readonly string[]) {
  try {
    return (await runGit(cwd, ["diff", ...DIFF_FLAGS, ...flags, "HEAD", "--", ...paths])).stdout;
  } catch (cause) {
    if (!isMissingHead(cause)) throw cause;
    const [staged, unstaged] = await Promise.all([
      runGit(cwd, ["diff", "--cached", ...DIFF_FLAGS, ...flags, "--", ...paths]),
      runGit(cwd, ["diff", ...DIFF_FLAGS, ...flags, "--", ...paths]),
    ]);
    return `${staged.stdout}${unstaged.stdout}`;
  }
}

/** `--name-status -z` records: a status letter, the path, and for renames the old path first. */
function parseNameStatus(output: string): readonly VcsFile[] {
  const fields = output.split("\0");
  const files: VcsFile[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const code = fields[index];
    const first = fields[index + 1];
    if (code === undefined || code === "" || first === undefined) continue;
    const letter = code.slice(0, 1);
    if (letter === "R" || letter === "C") {
      const second = fields[index + 2];
      if (second === undefined) break;
      files.push(
        letter === "R"
          ? { path: second, kind: "renamed", from: first }
          : { path: second, kind: "added" },
      );
      index += 2;
      continue;
    }
    const kind: VcsFileKind =
      letter === "A"
        ? "added"
        : letter === "D"
          ? "deleted"
          : letter === "U"
            ? "conflicted"
            : "modified";
    files.push({ path: first, kind });
    index += 1;
  }
  return files;
}

async function nameStatus(cwd: string, args: readonly string[]): Promise<readonly VcsFile[]> {
  return parseNameStatus(
    (await runGit(cwd, [...args, "--name-status", "--find-renames", "-z"])).stdout,
  );
}

/** Which files a scope reports and how one of them is patched. */
interface ScopeRead {
  readonly files: readonly VcsFile[];
  readonly patch: (file: VcsFile) => Promise<string>;
}

async function scopeRead(
  cwd: string,
  scope: VcsScope,
  flags: readonly string[],
): Promise<ScopeRead> {
  const pathArgs = (file: VcsFile) =>
    file.kind === "renamed" ? [file.from, file.path] : [file.path];
  const tracked = (base: readonly string[]) => async (file: VcsFile) =>
    file.kind === "untracked"
      ? untrackedPatch(cwd, file.path)
      : (await runGit(cwd, ["diff", ...base, ...DIFF_FLAGS, ...flags, "--", ...pathArgs(file)]))
          .stdout;
  switch (scope.kind) {
    case "commit": {
      const oid = checkedRevision(scope.oid);
      return {
        files: await nameStatus(cwd, ["diff-tree", "-r", "--root", "--no-commit-id", oid]),
        patch: async (file) =>
          (
            await runGit(cwd, [
              "show",
              "--format=",
              ...DIFF_FLAGS,
              ...flags,
              oid,
              "--",
              ...pathArgs(file),
            ])
          ).stdout,
      };
    }
    case "branch": {
      const base = (
        await runGit(cwd, ["merge-base", checkedRevision(scope.base), "HEAD"])
      ).stdout.trim();
      const status = await readStatus(cwd);
      const untracked = (status?.unstaged ?? []).filter((file) => file.kind === "untracked");
      return {
        files: [...(await nameStatus(cwd, ["diff", base])), ...untracked],
        patch: tracked([base]),
      };
    }
    case "staged":
      return { files: await nameStatus(cwd, ["diff", "--cached"]), patch: tracked(["--cached"]) };
    case "unstaged": {
      const status = await readStatus(cwd);
      return { files: status?.unstaged ?? [], patch: tracked([]) };
    }
    case "worktree": {
      const status = await readStatus(cwd);
      return {
        files: status === undefined ? [] : worktreeFiles(status),
        patch: async (file) =>
          file.kind === "untracked"
            ? untrackedPatch(cwd, file.path)
            : worktreePatch(cwd, flags, pathArgs(file)),
      };
    }
    default: {
      const _exhaustive: never = scope;
      return _exhaustive;
    }
  }
}

async function diff(
  cwd: string,
  input: {
    readonly scope: VcsScope;
    readonly paths?: readonly string[];
    readonly ignoreWhitespace?: boolean;
  },
): Promise<readonly VcsDiff[]> {
  for (const path of input.paths ?? []) safeWorkspacePath(cwd, path);
  const read = await scopeRead(cwd, input.scope, input.ignoreWhitespace === true ? ["-w"] : []);
  const wanted = input.paths === undefined ? undefined : new Set(input.paths);
  const files = read.files.filter((file) => wanted === undefined || wanted.has(file.path));
  const diffs = await Promise.all(
    files.map(async (file): Promise<VcsDiff | undefined> => {
      const patch = await read.patch(file);
      if (patch === "") return undefined;
      const facts = parsePatchFacts(patch);
      return {
        path: file.path,
        kind: file.kind,
        added: facts?.added ?? 0,
        removed: facts?.removed ?? 0,
        patch,
      };
    }),
  );
  return diffs.filter((item) => item !== undefined);
}

// ---------------------------------------------------------------------------
// Contents
// ---------------------------------------------------------------------------

/**
 * A blob that is absent from a revision is an ordinary answer for added or
 * untracked files, so only these known git phrasings become `null`.
 */
const MISSING_BLOB = [
  "does not exist",
  "exists on disk, but not in",
  "unknown revision",
  "bad revision",
  "ambiguous argument",
  "Not a valid object name",
  "is in the index, but not at stage",
];

type Side = { readonly kind: "revision"; readonly spec: string } | { readonly kind: "worktree" };

async function readSide(cwd: string, path: string, side: Side): Promise<Buffer | null> {
  const absolute = safeWorkspacePath(cwd, path);
  if (side.kind === "worktree") {
    try {
      const metadata = await lstat(absolute);
      if (metadata.isSymbolicLink()) return Buffer.from(await readlink(absolute), "utf8");
      return metadata.isFile() ? readFile(absolute) : null;
    } catch {
      return null;
    }
  }
  try {
    return (await runGit(cwd, ["show", `${side.spec}:${path}`])).stdoutBytes;
  } catch (cause) {
    if (
      cause instanceof GitCommandError &&
      MISSING_BLOB.some((phrase) => cause.result.stderr.includes(phrase))
    )
      return null;
    throw cause;
  }
}

async function contentSides(cwd: string, scope: VcsScope): Promise<readonly [Side, Side]> {
  const head: Side = { kind: "revision", spec: "HEAD" };
  const index: Side = { kind: "revision", spec: ":0" };
  const worktree: Side = { kind: "worktree" };
  switch (scope.kind) {
    case "worktree":
      return [head, worktree];
    case "staged":
      return [head, index];
    case "unstaged":
      return [index, worktree];
    case "commit": {
      const oid = checkedRevision(scope.oid);
      return [
        { kind: "revision", spec: `${oid}^` },
        { kind: "revision", spec: oid },
      ];
    }
    case "branch": {
      const base = (
        await runGit(cwd, ["merge-base", checkedRevision(scope.base), "HEAD"])
      ).stdout.trim();
      return [{ kind: "revision", spec: base }, worktree];
    }
    default: {
      const _exhaustive: never = scope;
      return _exhaustive;
    }
  }
}

async function contents(
  cwd: string,
  input: { readonly scope: VcsScope; readonly path: string },
): Promise<VcsContents> {
  const [oldSide, newSide] = await contentSides(cwd, input.scope);
  const [old, current] = await Promise.all([
    readSide(cwd, input.path, oldSide),
    readSide(cwd, input.path, newSide),
  ]);
  const sides = [old, current].filter((side) => side !== null);
  const binary = sides.some((side) => side.includes(0));
  const truncated = !binary && sides.some((side) => side.byteLength > MAX_PREVIEW_BYTES);
  const text = (side: Buffer | null) =>
    side === null ? null : binary ? "" : side.subarray(0, MAX_PREVIEW_BYTES).toString("utf8");
  return { path: input.path, old: text(old), new: text(current), binary, truncated };
}

// ---------------------------------------------------------------------------
// History and refs
// ---------------------------------------------------------------------------

/**
 * Unit separators between fields and a record separator between commits: a
 * subject can hold anything but these control characters.
 */
const LOG_FORMAT = "%H%x1f%an%x1f%ct%x1f%s%x1e";

function parseCommit(record: string): VcsCommitInfo | undefined {
  const [oid, author, committed, subject] = record.replace(/^\n/, "").split("\u001f");
  if (oid === undefined || author === undefined || committed === undefined || subject === undefined)
    return undefined;
  return { oid, subject, author, committedAt: Number(committed) * 1000 };
}

async function log(
  cwd: string,
  input: { readonly limit: number; readonly before?: string },
): Promise<VcsLog> {
  const limit = Math.max(1, Math.trunc(input.limit));
  const start = input.before === undefined ? "HEAD" : checkedRevision(input.before);
  // One extra commit answers `hasMore` without counting the whole history.
  const result = await runGit(cwd, [
    "log",
    `--max-count=${String(limit + 1)}`,
    ...(input.before === undefined ? [] : ["--skip=1"]),
    `--format=${LOG_FORMAT}`,
    start,
  ]).catch((cause: unknown) => {
    // An unborn HEAD has no history to page through; anything else is a real failure.
    if (
      isMissingHead(cause) ||
      (cause instanceof GitCommandError &&
        cause.result.stderr.includes("does not have any commits"))
    )
      return undefined;
    throw cause;
  });
  if (result === undefined) return { commits: [], hasMore: false };
  const commits = result.stdout
    .split("\u001e")
    .map(parseCommit)
    .filter((commit) => commit !== undefined);
  return { commits: commits.slice(0, limit), hasMore: commits.length > limit };
}

async function refNames(cwd: string, prefix: string): Promise<readonly string[]> {
  const result = await runGit(cwd, ["for-each-ref", "--format=%(refname)", prefix]);
  return result.stdout
    .split("\n")
    .filter((name) => name !== "")
    .map((name) => name.slice(prefix.length + 1));
}

async function refs(cwd: string): Promise<VcsRefs> {
  const [local, remote] = await Promise.all([
    refNames(cwd, "refs/heads"),
    refNames(cwd, "refs/remotes"),
  ]);
  // `refs/remotes/<remote>/HEAD` is the remote's default-branch pointer, not a branch.
  return { local, remote: remote.filter((name) => !name.endsWith("/HEAD")) };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Every path is checked before anything is touched, so traversal fails the whole call. */
function checkPaths(
  cwd: string,
  paths: readonly string[],
): { readonly kind: "failed"; readonly reason: string } | undefined {
  try {
    for (const path of paths) safeWorkspacePath(cwd, path);
    return undefined;
  } catch (cause) {
    return { kind: "failed", reason: failureReason(cause, "A path is outside the workspace.") };
  }
}

/** One path at a time: git's index lock is not shared, and a failure must name its own path. */
async function eachPath(
  paths: readonly string[],
  apply: (path: string) => Promise<string | undefined>,
): Promise<VcsPathsOutcome> {
  const applied: string[] = [];
  const skipped: { path: string; reason: string }[] = [];
  for (const path of paths) {
    const reason = await apply(path);
    if (reason === undefined) applied.push(path);
    else skipped.push({ path, reason });
  }
  return { kind: "applied", paths: applied, skipped };
}

function stageArgs(path: string, staged: boolean, born: boolean): readonly string[] {
  if (staged) return ["add", "--", path];
  // Before the first commit there is no committed side to restore an index entry from.
  if (born) return ["restore", "--staged", "--", path];
  return ["rm", "--cached", "--force", "--quiet", "--", path];
}

async function stage(
  cwd: string,
  input: { readonly paths: readonly string[]; readonly staged: boolean },
): Promise<VcsPathsOutcome> {
  const refused = checkPaths(cwd, input.paths);
  if (refused !== undefined) return refused;
  const born = input.staged ? true : await succeeds(cwd, ["rev-parse", "--verify", "HEAD"]);
  return eachPath(input.paths, (path) =>
    runGit(cwd, stageArgs(path, input.staged, born)).then(
      () => undefined,
      (cause: unknown) => failureReason(cause, "Git refused this path."),
    ),
  );
}

type Discard = (absolutePath: string) => Promise<void>;

async function discard(
  cwd: string,
  input: { readonly paths: readonly string[] },
  trash: Discard,
): Promise<VcsPathsOutcome> {
  const refused = checkPaths(cwd, input.paths);
  if (refused !== undefined) return refused;
  const status = await readStatus(cwd);
  const kinds = new Map(
    (status === undefined ? [] : worktreeFiles(status)).map((file) => [file.path, file.kind]),
  );
  return eachPath(input.paths, async (path) => {
    const kind = kinds.get(path);
    if (kind === undefined) return "This file has no changes to discard.";
    try {
      if (kind === "untracked") await trash(safeWorkspacePath(cwd, path));
      else await runGit(cwd, ["restore", "--source=HEAD", "--staged", "--worktree", "--", path]);
      return undefined;
    } catch (cause) {
      // A file git or the trash refuses leaves the rest of the batch alone.
      return failureReason(cause, "Discard failed.");
    }
  });
}

/** git says this on stdout, and the caller sees an ordinary state rather than a failure. */
const NOTHING_TO_COMMIT = [
  "nothing to commit",
  "no changes added to commit",
  "nothing added to commit",
];

async function commit(
  cwd: string,
  input: {
    readonly message: string;
    readonly target:
      | { readonly kind: "staged" }
      | { readonly kind: "all" }
      | { readonly kind: "paths"; readonly paths: readonly string[] };
  },
): Promise<VcsCommitOutcome> {
  if (input.message.trim() === "")
    return { kind: "failed", reason: "Write a commit message first." };
  const target = input.target;
  const refused = checkPaths(cwd, target.kind === "paths" ? target.paths : []);
  if (refused !== undefined) return refused;
  // The message is one argument; no shell ever sees it.
  const args = [
    "commit",
    ...(target.kind === "all" ? ["--all"] : []),
    "-m",
    input.message,
    ...(target.kind === "paths" ? ["--", ...target.paths] : []),
  ];
  try {
    await runGit(cwd, args);
  } catch (cause) {
    if (!(cause instanceof GitCommandError)) throw cause;
    const output = `${cause.result.stdout}\n${cause.result.stderr}`;
    if (NOTHING_TO_COMMIT.some((phrase) => output.includes(phrase)))
      return { kind: "nothing_to_commit" };
    // A rejected hook, a signing or identity problem, and a conflict all land here.
    return { kind: "failed", reason: commandReason(cause.result, "The commit failed.") };
  }
  const shown = await runGit(cwd, ["show", "--no-patch", "--format=%H%x1f%s", "HEAD"]);
  const [oid, summary] = shown.stdout.trim().split("\u001f");
  if (oid === undefined || summary === undefined) {
    return { kind: "failed", reason: "The commit was made but could not be read back." };
  }
  return { kind: "committed", oid, summary };
}

async function createBranch(
  cwd: string,
  input: { readonly name: string; readonly checkout: boolean },
): Promise<VcsBranchOutcome> {
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
): Promise<VcsPushOutcome> {
  try {
    const result = await runGit(cwd, args);
    const output = `${result.stdout}\n${result.stderr}`;
    return output.includes("Everything up-to-date")
      ? { kind: "up_to_date" }
      : { kind: "pushed", remote, branch };
  } catch (cause) {
    if (!(cause instanceof GitCommandError)) throw cause;
    const output = `${cause.result.stdout}\n${cause.result.stderr}`;
    if (PUSH_REJECTED.some((phrase) => output.includes(phrase))) {
      return { kind: "rejected", reason: rejectionReason(cause.result) };
    }
    return { kind: "failed", reason: commandReason(cause.result, "The push failed.") };
  }
}

/** No force, ever: a rejected push is answered, never retried with a wider flag. */
async function push(
  cwd: string,
  input: { readonly setUpstream: boolean },
): Promise<VcsPushOutcome> {
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
  if (!input.setUpstream) return { kind: "no_upstream", branch };
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
   * Where a discarded untracked file goes. The desktop hands this to the OS
   * trash; without one the file moves under the shadow repository's trash, as
   * a tree restore does.
   */
  readonly discard?: Discard;
}

/**
 * Git for the SDK's `workspace.vcs`. `cwd` is the workspace whose run
 * provenance the tree snapshot records; every other operation runs at the
 * directory it is called with.
 */
export function createGitVcs(cwd: string, options: GitVcsOptions = {}): VcsBackend {
  // Run provenance lives in a shadow repository the host owns, never in this `.git`.
  const snapshots = createTreeSnapshot(cwd, options);
  return {
    tree: snapshots.tree,
    diffTrees: snapshots.diffTrees,
    restoreTree: snapshots.restoreTree,
    snapshot: (input) => snapshot(input.cwd),
    diff: (input) => diff(input.cwd, input),
    contents: (input) => contents(input.cwd, input),
    log: (input) => log(input.cwd, input),
    refs: (input) => refs(input.cwd),
    stage: (input) => stage(input.cwd, input),
    discard: (input) => discard(input.cwd, input, snapshots.discard),
    commit: (input) => commit(input.cwd, input),
    createBranch: (input) => createBranch(input.cwd, input),
    push: (input) => push(input.cwd, input),
  };
}
