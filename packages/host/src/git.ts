/**
 * Git as the SDK's version-control backend. Every operation runs `git` at the
 * directory the SDK resolved; a directory outside any repository answers
 * `none` and empty reads. Nothing here runs through a shell, nothing is ever
 * forced, and a discard never unlinks a file: untracked paths go to `discard`,
 * which the desktop points at the OS trash.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
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
  VcsIndexFile,
  VcsLog,
  VcsPathsOutcome,
  VcsPushOutcome,
  VcsRefs,
  VcsScope,
  VcsSnapshot,
  VcsWorktreeFile,
} from "@nyte-ai/protocol";
import { nyteHome } from "./paths.ts";
import { createTreeSnapshot, sanitizedGitEnv, withFileLeaseLock } from "./tree-snapshot.ts";

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

function runGit(
  cwd: string,
  args: readonly string[],
  options: {
    readonly env?: Readonly<Record<string, string>>;
    readonly input?: string;
  } = {},
): Promise<GitResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(
      "git",
      [
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
        ...args,
      ],
      {
        cwd,
        env: sanitizedGitEnv(options.env),
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdin.on("error", (cause) => {
      if (!isFileError(cause, new Set(["EPIPE"]))) reject(cause);
    });
    child.stdin.end(options.input ?? "");
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

function isFileError(cause: unknown, codes: ReadonlySet<string>): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    typeof cause.code === "string" &&
    codes.has(cause.code)
  );
}

const MISSING_PATH = new Set(["ENOENT", "ENOTDIR"]);

function safeWorkspacePath(cwd: string, path: string): string {
  if (path === "" || path.startsWith("-") || isAbsolute(path)) {
    throw new Error(`Path is outside the workspace: ${path}`);
  }
  const absolute = resolve(cwd, path);
  const within = relative(cwd, absolute);
  if (isAbsolute(within) || within === ".." || within.startsWith(`..${sep}`)) {
    throw new Error(`Path is outside the workspace: ${path}`);
  }
  return absolute;
}

async function validatedWorkspacePath(cwd: string, path: string): Promise<string> {
  const root = await realpath(cwd);
  const absolute = safeWorkspacePath(root, path);
  let current = root;
  for (const component of relative(root, absolute).split(sep)) {
    current = join(current, component);
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new Error(`Path contains a symbolic link: ${path}`);
      }
    } catch (cause) {
      if (isFileError(cause, MISSING_PATH)) continue;
      throw cause;
    }
  }
  return absolute;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

interface StatusRead {
  readonly head:
    | Exclude<VcsHead, { readonly kind: "attached" }>
    | Omit<Extract<VcsHead, { readonly kind: "attached" }>, "base">;
  readonly staged: readonly VcsIndexFile[];
  readonly unstaged: readonly VcsWorktreeFile[];
  readonly raw: string;
}

const CONFLICT_CODES = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

function indexKind(code: string): Exclude<VcsIndexFile["kind"], "conflicted"> | undefined {
  if (code === "A" || code === "C") return "added";
  if (code === "D") return "deleted";
  if (code === "R") return "renamed";
  if (code === "M" || code === "T") return "modified";
  return undefined;
}

function worktreeKind(
  code: string,
): Exclude<VcsWorktreeFile["kind"], "untracked" | "conflicted"> | undefined {
  if (code === "D") return "deleted";
  if (code === "M" || code === "T") return "modified";
  return undefined;
}

function parseStatus(output: string): Omit<StatusRead, "raw"> {
  const records = output.split("\0");
  const staged: VcsIndexFile[] = [];
  const unstaged: VcsWorktreeFile[] = [];
  let oid: string | null = null;
  let branch = "";
  let upstream: { readonly name: string; readonly ahead: number; readonly behind: number } | null =
    null;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record === undefined || record === "") continue;
    if (record.startsWith("# branch.oid ")) {
      const value = record.slice("# branch.oid ".length);
      oid = value === "(initial)" ? null : value;
      continue;
    }
    if (record.startsWith("# branch.head ")) {
      branch = record.slice("# branch.head ".length);
      continue;
    }
    if (record.startsWith("# branch.upstream ")) {
      upstream = { name: record.slice("# branch.upstream ".length), ahead: 0, behind: 0 };
      continue;
    }
    if (record.startsWith("# branch.ab ")) {
      const match = /^# branch\.ab \+(\d+) -(\d+)$/.exec(record);
      if (match !== null && upstream !== null) {
        upstream = {
          name: upstream.name,
          ahead: Number(match[1]),
          behind: Number(match[2]),
        };
      }
      continue;
    }
    if (record.startsWith("? ")) {
      unstaged.push({ path: record.slice(2), kind: "untracked" });
      continue;
    }
    const recordKind = record.slice(0, 1);
    if (recordKind !== "1" && recordKind !== "2" && recordKind !== "u") continue;
    const fields = record.split(" ");
    const code = fields[1] ?? "";
    const pathIndex = recordKind === "1" ? 8 : recordKind === "2" ? 9 : 10;
    const path = fields.slice(pathIndex).join(" ");
    if (path === "") continue;
    if (recordKind === "u" || CONFLICT_CODES.has(code)) {
      staged.push({ path, kind: "conflicted" });
      unstaged.push({ path, kind: "conflicted" });
      continue;
    }
    const from = recordKind === "2" ? (records[index + 1] ?? "") : "";
    if (recordKind === "2" && from !== "") index += 1;
    const indexChange = indexKind(code.slice(0, 1));
    if (indexChange !== undefined) {
      staged.push(
        indexChange === "renamed" ? { path, kind: indexChange, from } : { path, kind: indexChange },
      );
    }
    const worktreeChange = worktreeKind(code.slice(1, 2));
    if (worktreeChange !== undefined) unstaged.push({ path, kind: worktreeChange });
  }
  const head: StatusRead["head"] =
    oid === null
      ? { kind: "unborn", branch }
      : branch === "(detached)" || branch === ""
        ? { kind: "detached", oid }
        : { kind: "attached", oid, branch, upstream };
  return { head, staged, unstaged };
}

async function readStatus(cwd: string): Promise<StatusRead | undefined> {
  try {
    const result = await runGit(cwd, [
      "status",
      "--branch",
      "--porcelain=v2",
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
    const metadata = await lstat(safeWorkspacePath(cwd, `./${path}`), { bigint: true });
    return [
      path,
      metadata.dev,
      metadata.ino,
      metadata.mode,
      metadata.size,
      metadata.mtimeNs,
      metadata.ctimeNs,
    ].join(":");
  } catch (cause) {
    if (isFileError(cause, MISSING_PATH)) return `${path}:missing`;
    throw cause;
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
  head: Omit<Extract<VcsHead, { readonly kind: "attached" }>, "base">,
): Promise<Extract<VcsHead, { readonly kind: "attached" }>["base"]> {
  const origin = await createdFrom(cwd, head.branch);
  if (origin !== undefined) {
    const forkPoint = await gitValue(cwd, [
      "merge-base",
      "--fork-point",
      checkedRevision(origin),
      "HEAD",
    ]);
    return forkPoint === undefined ? null : { name: forkPoint, source: "reflog" };
  }
  const remoteHead = await gitValue(cwd, [
    "symbolic-ref",
    "--quiet",
    "--short",
    "refs/remotes/origin/HEAD",
  ]);
  if (remoteHead === undefined || remoteHead.split("/").slice(1).join("/") === head.branch)
    return null;
  return { name: remoteHead, source: "default" };
}

async function snapshot(cwd: string): Promise<VcsSnapshot> {
  const read = await readStatus(cwd);
  if (read === undefined) return { kind: "none" };
  const changed = worktreeFiles(read);
  const [root, index, files, base] = await Promise.all([
    runGit(cwd, ["rev-parse", "--show-toplevel"]),
    runGit(cwd, ["ls-files", "--stage", "-z"]),
    Promise.all(changed.map((file) => fileRevisionPart(cwd, file.path))),
    read.head.kind === "attached" ? reviewBase(cwd, read.head) : Promise.resolve(null),
  ]);
  const revision = createHash("sha256")
    .update(root.stdout)
    .update("\0")
    .update(cwd)
    .update("\0")
    .update(read.head.kind === "unborn" ? "unborn" : read.head.oid)
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
    head: read.head.kind === "attached" ? { ...read.head, base } : read.head,
    staged: read.staged,
    unstaged: read.unstaged,
  };
}

// ---------------------------------------------------------------------------
// Diffs
// ---------------------------------------------------------------------------

async function untrackedPatch(cwd: string, path: string): Promise<string> {
  const absolute = await validatedWorkspacePath(cwd, path);
  const metadata = await lstat(absolute);
  if (!metadata.isFile()) throw new Error(`Diff paths must be files: ${path}`);
  if (metadata.size > MAX_PREVIEW_BYTES) return `File is too large to preview: b/${path}\n`;
  let numstat: GitResult;
  try {
    numstat = await runGit(cwd, [
      "diff",
      "--no-index",
      "--numstat",
      "--no-ext-diff",
      "--no-textconv",
      "--",
      devNull,
      absolute,
    ]);
  } catch (cause) {
    if (!(cause instanceof GitCommandError) || cause.result.code !== 1) throw cause;
    numstat = cause.result;
  }
  if (numstat.stdout.startsWith("-\t-\t")) return `Binary file b/${path}\n`;
  const contents = await readFile(absolute);
  return createTwoFilesPatch("/dev/null", `b/${path}`, "", contents.toString("utf8"), "", "");
}

const DIFF_FLAGS = ["--no-ext-diff", "--no-textconv", "--no-color", "--find-renames"];

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
    (
      await runGit(cwd, [
        ...args,
        "--name-status",
        "--find-renames",
        "--no-ext-diff",
        "--no-textconv",
        "-z",
      ])
    ).stdout,
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
    readonly ignoreWhitespace: boolean;
  },
): Promise<readonly VcsDiff[]> {
  for (const path of input.paths ?? []) await validatedWorkspacePath(cwd, path);
  const read = await scopeRead(cwd, input.scope, input.ignoreWhitespace ? ["-w"] : []);
  const wanted = input.paths === undefined ? undefined : new Set(input.paths);
  const files = read.files.filter((file) => wanted === undefined || wanted.has(file.path));
  const diffs = await Promise.all(
    files.map(async (file): Promise<VcsDiff | undefined> => {
      const patch = await read.patch(file);
      if (patch === "") return undefined;
      const facts = parsePatchFacts(patch);
      return facts === undefined || /^(?:Binary files .* differ|GIT binary patch)$/m.test(patch)
        ? { path: file.path, status: file.kind, kind: "binary", patch }
        : {
            path: file.path,
            status: file.kind,
            kind: "text",
            added: facts.added,
            removed: facts.removed,
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
  safeWorkspacePath(cwd, path);
  if (side.kind === "worktree") {
    const absolute = await validatedWorkspacePath(cwd, path);
    try {
      const metadata = await lstat(absolute);
      return metadata.isFile() ? readFile(absolute) : null;
    } catch (cause) {
      if (isFileError(cause, MISSING_PATH)) return null;
      throw cause;
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

function contentSides(scope: VcsScope): readonly [Side, Side] {
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
    case "branch":
      return [{ kind: "revision", spec: checkedRevision(scope.base) }, worktree];
    default: {
      const _exhaustive: never = scope;
      return _exhaustive;
    }
  }
}

async function binaryForScope(cwd: string, path: string, scope: VcsScope): Promise<boolean> {
  const args = (() => {
    switch (scope.kind) {
      case "worktree":
        return ["diff", "--numstat", "--no-ext-diff", "--no-textconv", "HEAD", "--", path];
      case "staged":
        return ["diff", "--cached", "--numstat", "--no-ext-diff", "--no-textconv", "--", path];
      case "unstaged":
        return ["diff", "--numstat", "--no-ext-diff", "--no-textconv", "--", path];
      case "commit": {
        const oid = checkedRevision(scope.oid);
        return ["diff", "--numstat", "--no-ext-diff", "--no-textconv", `${oid}^`, oid, "--", path];
      }
      case "branch":
        return [
          "diff",
          "--numstat",
          "--no-ext-diff",
          "--no-textconv",
          checkedRevision(scope.base),
          "--",
          path,
        ];
      default: {
        const _exhaustive: never = scope;
        return _exhaustive;
      }
    }
  })();
  try {
    const output = (await runGit(cwd, args)).stdout;
    if (output.startsWith("-\t-\t")) return true;
    if (output !== "" || (scope.kind !== "worktree" && scope.kind !== "unstaged")) return false;
    const absolute = await validatedWorkspacePath(cwd, path);
    try {
      return (
        await runGit(cwd, [
          "diff",
          "--no-index",
          "--numstat",
          "--no-ext-diff",
          "--no-textconv",
          "--",
          devNull,
          absolute,
        ])
      ).stdout.startsWith("-\t-\t");
    } catch (cause) {
      if (cause instanceof GitCommandError && cause.result.code === 1) {
        return cause.result.stdout.startsWith("-\t-\t");
      }
      throw cause;
    }
  } catch (cause) {
    if (!isMissingHead(cause)) throw cause;
    return false;
  }
}

async function contents(
  cwd: string,
  input: { readonly scope: VcsScope; readonly path: string },
): Promise<VcsContents> {
  await validatedWorkspacePath(cwd, input.path);
  const scope =
    input.scope.kind === "branch"
      ? {
          kind: "branch" as const,
          base: (
            await runGit(cwd, ["merge-base", checkedRevision(input.scope.base), "HEAD"])
          ).stdout.trim(),
        }
      : input.scope;
  const [oldSide, newSide] = contentSides(scope);
  const [old, current, gitBinary] = await Promise.all([
    readSide(cwd, input.path, oldSide),
    readSide(cwd, input.path, newSide),
    binaryForScope(cwd, input.path, scope),
  ]);
  const side = (contents: Buffer | null) => {
    if (contents === null) return { kind: "absent" } as const;
    if (gitBinary || contents.includes(0)) return { kind: "binary" } as const;
    const head = contents.subarray(0, MAX_PREVIEW_BYTES).toString("utf8");
    return contents.byteLength > MAX_PREVIEW_BYTES
      ? ({ kind: "truncated", head } as const)
      : ({ kind: "text", text: head } as const);
  };
  return { path: input.path, old: side(old), new: side(current) };
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

async function stale(cwd: string, revision: string): Promise<boolean> {
  const current = await snapshot(cwd);
  return current.kind !== "repository" || current.revision !== revision;
}

async function withMutationLock<Result>(
  cwd: string,
  revision: string,
  operation: () => Promise<Result>,
): Promise<Result | { readonly kind: "stale" }> {
  const topLevel = await gitValue(cwd, ["rev-parse", "--show-toplevel"]);
  const root = await realpath(topLevel ?? cwd);
  const shadow = join(nyteHome(), "snapshots", createHash("sha256").update(root).digest("hex"));
  await mkdir(shadow, { recursive: true, mode: 0o700 });
  return withFileLeaseLock(join(shadow, "mutate.lock"), async () => {
    if (await stale(cwd, revision)) return { kind: "stale" };
    return operation();
  });
}

async function checkPaths(
  cwd: string,
  paths: readonly string[],
): Promise<{ readonly kind: "failed"; readonly reason: string } | undefined> {
  try {
    for (const path of paths) await validatedWorkspacePath(cwd, path);
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

async function stage(
  cwd: string,
  input: {
    readonly paths: readonly string[];
    readonly staged: boolean;
    readonly expect: { readonly revision: string };
  },
): Promise<VcsPathsOutcome | { readonly kind: "stale" }> {
  const refused = await checkPaths(cwd, input.paths);
  if (refused !== undefined) return refused;
  return withMutationLock(cwd, input.expect.revision, async () => {
    const born = input.staged ? true : await succeeds(cwd, ["rev-parse", "--verify", "HEAD"]);
    return eachPath(input.paths, (path) =>
      runGit(
        cwd,
        input.staged
          ? ["add", "--", path]
          : born
            ? ["restore", "--staged", "--", path]
            : ["rm", "--cached", "--force", "--quiet", "--", path],
      ).then(
        () => undefined,
        (cause: unknown) => failureReason(cause, "Git refused this path."),
      ),
    );
  });
}

type Discard = (absolutePath: string) => Promise<void>;

async function discard(
  cwd: string,
  input: {
    readonly paths: readonly string[];
    readonly expect: { readonly revision: string };
  },
  trash: Discard,
): Promise<VcsPathsOutcome | { readonly kind: "stale" }> {
  const refused = await checkPaths(cwd, input.paths);
  if (refused !== undefined) return refused;
  return withMutationLock(cwd, input.expect.revision, async () => {
    const status = await readStatus(cwd);
    const files = new Map(
      (status === undefined ? [] : worktreeFiles(status)).map((file) => [file.path, file]),
    );
    const trashPath = async (path: string) => {
      const absolute = await validatedWorkspacePath(cwd, path);
      try {
        const metadata = await lstat(absolute);
        if (metadata.isDirectory()) throw new Error(`Discard paths must be files: ${path}`);
        await trash(absolute);
      } catch (cause) {
        if (!isFileError(cause, MISSING_PATH)) throw cause;
      }
    };
    return eachPath(input.paths, async (path) => {
      const file = files.get(path);
      if (file === undefined) return "This file has no changes to discard.";
      try {
        const inHead = await succeeds(cwd, ["cat-file", "-e", `HEAD:${path}`]);
        if (file.kind === "renamed") {
          await trashPath(file.path);
          await runGit(cwd, ["rm", "--cached", "--force", "--quiet", "--", file.path]);
          await runGit(cwd, [
            "restore",
            "--source=HEAD",
            "--staged",
            "--worktree",
            "--",
            file.from,
          ]);
        } else if (file.kind === "untracked" || !inHead) {
          await trashPath(path);
          if (file.kind !== "untracked") {
            await runGit(cwd, ["rm", "--cached", "--force", "--quiet", "--", path]);
          }
        } else {
          await runGit(cwd, ["restore", "--source=HEAD", "--staged", "--worktree", "--", path]);
        }
        return undefined;
      } catch (cause) {
        return failureReason(cause, "Discard failed.");
      }
    });
  });
}

/** git says this on stdout, and the caller sees an ordinary state rather than a failure. */
const NOTHING_TO_COMMIT = [
  "nothing to commit",
  "no changes added to commit",
  "nothing added to commit",
];

async function commitPaths(
  cwd: string,
  message: string,
  paths: readonly string[],
): Promise<"committed" | "nothing_to_commit"> {
  const directory = await mkdtemp(join(tmpdir(), "nyte-index-"));
  const index = join(directory, "index");
  const env = { GIT_INDEX_FILE: index };
  try {
    const selected = new Set(paths);
    const staged = await nameStatus(cwd, ["diff", "--cached"]);
    for (const file of staged) {
      if (file.kind === "renamed" && (selected.has(file.path) || selected.has(file.from))) {
        selected.add(file.path);
        selected.add(file.from);
      }
    }
    const expandedPaths = [...selected];
    const head = await gitValue(cwd, ["rev-parse", "--verify", "HEAD"]);
    const emptyTree =
      head === undefined ? (await runGit(cwd, ["mktree"], { input: "" })).stdout.trim() : "";
    await runGit(cwd, ["read-tree", head ?? emptyTree], { env });
    const entries = await runGit(cwd, ["ls-files", "--stage", "-z", "--", ...expandedPaths]);
    if (entries.stdout !== "") {
      await runGit(cwd, ["update-index", "-z", "--index-info"], {
        env,
        input: entries.stdout,
      });
    }
    const listed = new Set(
      entries.stdout.split("\0").flatMap((entry) => {
        const separator = entry.indexOf("\t");
        return separator < 0 ? [] : [entry.slice(separator + 1)];
      }),
    );
    for (const path of expandedPaths) {
      if (!listed.has(path))
        await runGit(cwd, ["update-index", "--force-remove", "--", path], { env });
    }
    const tree = (await runGit(cwd, ["write-tree"], { env })).stdout.trim();
    const baseTree =
      head === undefined
        ? emptyTree
        : (await runGit(cwd, ["rev-parse", `${head}^{tree}`])).stdout.trim();
    if (tree === baseTree) return "nothing_to_commit";
    const created = await runGit(
      cwd,
      ["commit-tree", tree, ...(head === undefined ? [] : ["-p", head]), "-F", "-"],
      { input: message },
    );
    await runGit(cwd, [
      "update-ref",
      "HEAD",
      created.stdout.trim(),
      ...(head === undefined ? [] : [head]),
    ]);
    return "committed";
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function commit(
  cwd: string,
  input: {
    readonly message: string;
    readonly expect: { readonly revision: string };
    readonly files:
      | { readonly kind: "staged" }
      | { readonly kind: "all" }
      | { readonly kind: "paths"; readonly paths: readonly [string, ...string[]] };
  },
): Promise<VcsCommitOutcome | { readonly kind: "stale" }> {
  if (input.message.trim() === "")
    return { kind: "failed", reason: "Write a commit message first." };
  const target = input.files;
  const refused = await checkPaths(cwd, target.kind === "paths" ? target.paths : []);
  if (refused !== undefined) return refused;
  return withMutationLock(cwd, input.expect.revision, async () => {
    try {
      if (target.kind === "paths") {
        const outcome = await commitPaths(cwd, input.message, target.paths);
        if (outcome === "nothing_to_commit") return { kind: "nothing_to_commit" };
      } else {
        await runGit(cwd, [
          "commit",
          ...(target.kind === "all" ? ["--all"] : []),
          "-m",
          input.message,
        ]);
      }
    } catch (cause) {
      if (!(cause instanceof GitCommandError)) throw cause;
      const output = `${cause.result.stdout}\n${cause.result.stderr}`;
      if (NOTHING_TO_COMMIT.some((phrase) => output.includes(phrase)))
        return { kind: "nothing_to_commit" };
      return { kind: "failed", reason: commandReason(cause.result, "The commit failed.") };
    }
    const shown = await runGit(cwd, ["show", "--no-patch", "--format=%H%x1f%s", "HEAD"]);
    const [oid, summary] = shown.stdout.trim().split("\u001f");
    if (oid === undefined || summary === undefined) {
      return { kind: "failed", reason: "The commit was made but could not be read back." };
    }
    return { kind: "committed", oid, summary };
  });
}

async function createBranch(
  cwd: string,
  input: {
    readonly name: string;
    readonly checkout: boolean;
    readonly expect: { readonly revision: string };
  },
): Promise<VcsBranchOutcome | { readonly kind: "stale" }> {
  return withMutationLock(cwd, input.expect.revision, async () => {
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
  });
}

const PUSH_REJECTED = ["[rejected]", "non-fast-forward", "fetch first", "Updates were rejected"];

function rejectionReason(result: GitResult): string {
  const line = [...result.stderr.split("\n"), ...result.stdout.split("\n")]
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.includes("[rejected]"));
  return line ?? "The remote rejected this push. Pull first, then push again.";
}

async function validPushName(cwd: string, remote: string, branch: string): Promise<boolean> {
  return (
    (await succeeds(cwd, ["check-ref-format", `refs/remotes/${remote}/placeholder`])) &&
    (await succeeds(cwd, ["check-ref-format", `refs/heads/${branch}`]))
  );
}

async function runPush(
  cwd: string,
  remote: string,
  branch: string,
  setUpstream: boolean,
): Promise<VcsPushOutcome> {
  if (!(await validPushName(cwd, remote, branch))) {
    return { kind: "failed", reason: "Git does not accept the remote or branch name." };
  }
  try {
    const result = await runGit(cwd, [
      "push",
      ...(setUpstream ? ["--set-upstream"] : []),
      "--",
      remote,
      branch,
    ]);
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
  input: {
    readonly setUpstream: boolean;
    readonly expect: { readonly revision: string };
  },
): Promise<VcsPushOutcome | { readonly kind: "stale" }> {
  return withMutationLock(cwd, input.expect.revision, async () => {
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
      return runPush(cwd, remote ?? upstream.split("/")[0] ?? "origin", branch, false);
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
    return runPush(cwd, only, branch, true);
  });
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
  safeWorkspacePath(cwd, ".");
  const snapshots = createTreeSnapshot(options);
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
    discard: (input) =>
      discard(input.cwd, input, (absolutePath) =>
        snapshots.discard({ cwd: input.cwd, absolutePath }),
      ),
    commit: (input) => commit(input.cwd, input),
    createBranch: (input) => createBranch(input.cwd, input),
    push: (input) => push(input.cwd, input),
  };
}
