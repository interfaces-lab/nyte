import { lstat, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { asId, SdkError } from "@nyte-ai/schema";
import type {
  BlameView,
  ChangeSet,
  Cursor,
  FileChange,
  FileStatus,
  GitCommitView,
  GitFileSide,
  GitOutcome,
  GitRevision,
  GitScope,
  GitStatus,
  LineStat,
  PatchEntry,
  PatchSet,
} from "@nyte-ai/schema";
import { dev } from "@nyte-ai/core";
import type { ExecutionEnv, GitApi } from "@nyte-ai/core";
import { sha256 } from "../hash.ts";
import { run } from "./command.ts";
import type { Ran } from "./command.ts";
import { feed } from "./feed.ts";
import {
  PATCH_LIMIT,
  lineStat,
  parseNameStatus,
  parseNumstat,
  readPatches,
  textEntry,
} from "./patch.ts";
import type { Changed } from "./patch.ts";
import { createWatcher } from "./git-watch.ts";
import type { Repository } from "./git-watch.ts";
import { decodeText } from "./text.ts";

type Repo = Extract<GitStatus, { readonly kind: "repository" }>;

const PATCH_BATCH = 32;

const LOG_DEFAULT = 50;

const ENV: Readonly<Record<string, string>> = {
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
  GIT_LITERAL_PATHSPECS: "1",
  LC_ALL: "C",
};

const CONFIG = ["-c", "core.quotepath=off", "-c", "color.ui=false", "-c", "diff.noprefix=false"];

const DIFF = [
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
  "--src-prefix=a/",
  "--dst-prefix=b/",
  "-M",
];

/** Returns git over the CLI (`git`, default `git` on the PATH) for the repository holding `env.cwd`; every path it takes and answers is relative to the workspace (`env.cwd`), as `FilesApi`'s and the snapshots' are (§41j): the commands run at the repository root, and where the workspace is a subdirectory of the repository its prefix is added to every path going into git (`stage`, `unstage`, `discard` and `commit` files, `patches`, `contents` and `blame` paths) and stripped from every path coming out (`status`, `changes`, `patches`), the listings limited to it by pathspec (a rename source outside it reads `../…`); `root` stays the repository root, and `log`, `refs`, `branch`, `push` and `commit` of `staged` or `all` are repository-wide. `status` reads `git status --porcelain=v2 --branch -z --untracked-files=all` (`none` outside a repository, `head` null when unborn) with the staged and unstaged line stats (`git diff --numstat`), its `revision` the SHA-256 of those outputs with HEAD and each dirty worktree file's size and modification time, so an edit to an already-modified file moves it; `watch` yields the status whenever that revision moves, re-reading only on fs events that can move it (`createWatcher`: worktree paths git does not ignore and the git directory's HEAD, index and refs, coalesced over 250 ms; a 2 s poll only where `fs.watch` is unavailable). The repository (`git rev-parse`) is looked up once and kept while its git directory holds a HEAD. `changes(scope)` reads statuses with `git diff --name-status -z -M` and line stats with `--numstat` (`--ignore-all-space` under `ignoreWhitespace`, for the stats and patches only, so a whitespace-only change stays listed; `worktree` HEAD to the worktree, `staged` HEAD to the index, `unstaged` the index to the worktree, `commit` its parent (or the empty tree) to it, `branch` the merge base with HEAD to HEAD; HEAD of an unborn repository is the empty tree), untracked files joining `worktree` and `unstaged` with status `untracked` and their line count as added; its `revision` the status revision; `watchChanges` re-reads it as that revision moves. `patches` reads `git diff -U3` for the requested paths the scope reports (paths it does not report are left out), at most 32 per command, one `PatchEntry` per path, a text one carrying the path's section of the unified text as its `patch` (`binary`; `empty` when the scope reports the path but the diff shows no text, as under `ignoreWhitespace`; `too-large` past 1 MiB; `failed` alone when one path's read fails), `digest` the SHA-256 of the path's section; an untracked file is diffed against nothing on the host (its digest that of its patch), `failed` when it is gone or cannot be read. It yields one full `PatchSet` per revision as it moves. `contents` reads both sides (`git cat-file blob <rev>:<path>`, the index, the worktree file, or absent; a rename's old side at its old path; text, `truncated { head }` past 1 MiB, or binary). `log` pages `git log` with the cursor holding the next skip (default 50 a page); `refs` reads `git symbolic-ref`, `git for-each-ref refs/heads` and `git remote`; `blame` reads `git blame --porcelain` of the worktree file. Every write answers `busy { runs: [] }` while `index.lock` exists for the writes that take it (all but `push` and `branch` without checkout; the run-based busy is core's), then compares `expect` with the current status revision (`stale { revision }`): `stage` (`git add -A`), `unstage` (`git restore --staged`, `git rm --cached` when unborn), `discard` (`git restore --worktree`, untracked paths removed with `git clean -f`), `commit` (`staged`, `all` as `-a`, or the listed paths added and committed alone), `branch` (`git switch -c` when `checkout`, else `git branch`), `push` (`--porcelain`, `--set-upstream origin <branch>` when asked; a detached HEAD cannot set one); each answers `applied { revision }`, `unchanged` (`stage`, `unstage`, `discard` and `commit` when the revision did not move or git had nothing to commit, `push` when every ref was already up to date; `branch` always applies), or `rejected { reason }` with git's message. Reads outside a repository throw `SdkError("unavailable")`. */
export function localGit(env: ExecutionEnv, options?: { readonly git?: string }): GitApi {
  const binary = options?.git ?? "git";
  let emptyTree: Promise<string> | null = null;

  const git = (
    cwd: string,
    args: readonly string[],
    extra?: { readonly input?: string; readonly limit?: number },
  ): Promise<Ran> => {
    const started = Date.now();

    return run(binary, [...CONFIG, ...args], { cwd, env: ENV, ...extra }).then((ran) => {
      dev("git", "run", {
        command: args[0],
        args: args.length,
        code: ran.code,
        ms: Date.now() - started,
      });

      return ran;
    });
  };

  let located: Promise<Repository | null> | null = null;

  const lookUp = async (): Promise<Repository | null> => {
    const ran = await git(env.cwd, [
      "rev-parse",
      "--show-toplevel",
      "--absolute-git-dir",
      "--show-prefix",
      "--path-format=absolute",
      "--git-common-dir",
    ]);

    if (ran.code !== 0) return null;
    const [root, gitDir, prefix = "", commonDir] = ran.stdout.toString("utf8").split("\n");

    return root === undefined || gitDir === undefined
      ? null
      : { root, gitDir, commonDir: commonDir || gitDir, prefix };
  };

  const repository = async (): Promise<Repository | null> => {
    const pending = located;
    const known = pending === null ? null : await pending;

    if (known !== null && located === pending && (await exists(join(known.gitDir, "HEAD"))))
      return known;

    if (located === pending || located === null) located = lookUp();

    return located;
  };

  const forget = (): void => {
    located = null;
  };

  const required = async (): Promise<Repository> => {
    const found = await repository();

    if (found === null) throw new SdkError("unavailable", `${env.cwd} is not in a git repository.`);

    return found;
  };

  const readRepository = async (repo: Repository): Promise<Repo> => {
    const [porcelain, staged, unstaged] = await Promise.all([
      git(repo.root, [
        "status",
        "--porcelain=v2",
        "--branch",
        "-z",
        "--untracked-files=all",
        ...within(repo),
      ]),
      git(repo.root, ["diff", "--cached", "--numstat", "-z", "-M", ...within(repo)]),
      git(repo.root, ["diff", "--numstat", "-z", ...within(repo)]),
    ]);

    if (porcelain.code !== 0) throw new SdkError("unavailable", porcelain.stderr.trim());

    return readStatus(repo, porcelain.stdout.toString("utf8"), {
      staged: staged.stdout.toString("utf8"),
      unstaged: unstaged.stdout.toString("utf8"),
    });
  };

  const status = async (): Promise<GitStatus> => {
    const repo = await repository();

    return repo === null ? { kind: "none" } : readRepository(repo);
  };

  const empty = (root: string): Promise<string> => {
    emptyTree ??= git(root, ["hash-object", "-t", "tree", "--stdin"], { input: "" }).then((ran) =>
      ran.stdout.toString("utf8").trim(),
    );

    return emptyTree;
  };

  const resolves = async (root: string, rev: string): Promise<string | null> => {
    const ran = await git(root, ["rev-parse", "--verify", "-q", `${rev}^{commit}`]);

    return ran.code === 0 ? ran.stdout.toString("utf8").trim() : null;
  };

  const resolveRange = async (
    root: string,
    scope: GitScope,
  ): Promise<{ readonly args: readonly string[]; readonly untracked: boolean }> => {
    const head = async () => (await resolves(root, "HEAD")) ?? (await empty(root));

    switch (scope.kind) {
      case "worktree":
        return { args: [await head()], untracked: true };
      case "staged":
        return { args: ["--cached", await head()], untracked: false };
      case "unstaged":
        return { args: [], untracked: true };
      case "commit": {
        const commit = await resolves(root, scope.commit);

        if (commit === null) throw new SdkError("unknown", `No commit ${scope.commit}.`);

        return {
          args: [(await resolves(root, `${commit}^`)) ?? (await empty(root)), commit],
          untracked: false,
        };
      }

      case "branch": {
        const base = await git(root, ["merge-base", scope.base, "HEAD"]);

        if (base.code !== 0)
          throw new SdkError("unknown", `No merge base between ${scope.base} and HEAD.`);

        return { args: [base.stdout.toString("utf8").trim(), "HEAD"], untracked: false };
      }
    }
  };

  const whitespace = (ignore: boolean | undefined): readonly string[] =>
    ignore === true ? ["--ignore-all-space"] : [];

  const listChanged = async (
    repo: Repository,
    scope: GitScope,
    current: Repo,
  ): Promise<readonly Changed[]> => {
    const range = await resolveRange(repo.root, scope);

    const ran = await git(repo.root, [
      "diff",
      "--name-status",
      "-z",
      "-M",
      ...range.args,
      ...within(repo),
    ]);

    if (ran.code !== 0) throw new SdkError("unavailable", ran.stderr.trim());

    const tracked = parseNameStatus(ran.stdout.toString("utf8")).map((file) =>
      withPaths(file, (path) => relativeToPrefix(repo, path)),
    );

    return range.untracked
      ? [...tracked, ...current.untracked.map((path): Changed => ({ path, status: "untracked" }))]
      : tracked;
  };

  const changesAt = async (
    repo: Repository,
    scope: GitScope,
    current: Repo,
    ignoreWhitespace: boolean | undefined,
  ): Promise<ChangeSet> => {
    const range = await resolveRange(repo.root, scope);

    const [changed, numstat] = await Promise.all([
      listChanged(repo, scope, current),
      git(repo.root, [
        "diff",
        "--numstat",
        "-z",
        "-M",
        ...whitespace(ignoreWhitespace),
        ...range.args,
        ...within(repo),
      ]),
    ]);

    const stats = parseNumstat(numstat.stdout.toString("utf8"));

    const files = await Promise.all(
      changed.map(async (file) => ({
        ...file,
        stat:
          file.status === "untracked"
            ? await untrackedStat(join(repo.root, into(repo, file.path)))
            : (stats.get(into(repo, file.path)) ?? { kind: "unknown" as const }),
      })),
    );

    return { revision: current.revision, files };
  };

  const patchesAt = async (
    repo: Repository,
    scope: GitScope,
    paths: readonly string[],
    current: Repo,
    ignoreWhitespace: boolean | undefined,
  ): Promise<PatchSet> => {
    const { root } = repo;

    const changed = new Map(
      (await listChanged(repo, scope, current)).map((file) => [file.path, file]),
    );

    const wanted = [...new Set(paths)].flatMap((path) => {
      const file = changed.get(path);

      return file === undefined ? [] : [file];
    });

    const range = await resolveRange(root, scope);
    const entries = new Map<string, PatchEntry & { readonly fresh: boolean }>();

    const read = async (files: readonly Changed[], limit: number): Promise<Ran> =>
      git(
        root,
        [
          "diff",
          ...DIFF,
          "-U3",
          ...whitespace(ignoreWhitespace),
          ...range.args,
          "--",
          ...files.flatMap((file) =>
            file.from === undefined ? [file.path] : [file.from, file.path],
          ),
        ],
        { limit },
      );

    for (let start = 0; start < wanted.length; start += PATCH_BATCH) {
      const batch = wanted.slice(start, start + PATCH_BATCH);

      const tracked = batch.flatMap((file) =>
        file.status === "untracked" ? [] : [withPaths(file, (path) => into(repo, path))],
      );

      for (const file of batch)
        if (file.status === "untracked")
          entries.set(file.path, {
            ...(await untrackedEntry(join(root, into(repo, file.path)), file.path)),
            fresh: true,
          });

      if (tracked.length === 0) continue;

      for (const entry of await readPatches(tracked, read, (file) =>
        sha256(`${file.path}\u0000`),
      )) {
        const path = relativeToPrefix(repo, entry.path);
        entries.set(path, { ...entry, path, fresh: true });
      }
    }

    return { revision: current.revision, entries };
  };

  const blob = async (root: string, spec: string): Promise<GitFileSide> => {
    const ran = await git(root, ["cat-file", "blob", spec], { limit: PATCH_LIMIT });

    if (ran.code !== 0 && !ran.truncated) return { kind: "absent" };

    return decodeSide(ran.stdout, ran.truncated);
  };

  const worktree = async (root: string, path: string): Promise<GitFileSide> => {
    const target = join(root, path);
    const stats = await stat(target).catch(() => null);

    if (stats === null || !stats.isFile()) return { kind: "absent" };
    const bytes = await readFile(target).catch(() => null);

    if (bytes === null) return { kind: "absent" };

    return decodeSide(bytes.subarray(0, PATCH_LIMIT), bytes.byteLength > PATCH_LIMIT);
  };

  const write = async (
    takesIndex: boolean,
    expect: GitRevision | undefined,
    operation: (
      repo: Repository,
      before: Repo,
    ) => Promise<Ran | "unchanged" | { readonly rejected: string }>,
    moves: "revision" | "always" = "revision",
  ): Promise<GitOutcome> => {
    const repo = await required();

    if (takesIndex && (await exists(join(repo.gitDir, "index.lock"))))
      return { kind: "busy", runs: [] };
    const before = await readRepository(repo);

    if (expect !== undefined && expect !== before.revision)
      return { kind: "stale", revision: before.revision };
    const ran = await operation(repo, before);

    if (ran === "unchanged") return { kind: "unchanged" };

    if ("rejected" in ran) return { kind: "rejected", reason: ran.rejected };

    if (ran.code !== 0) {
      const output = `${ran.stdout.toString("utf8")}\n${ran.stderr}`;

      if (/nothing to commit|no changes added to commit|nothing added to commit/.test(output))
        return { kind: "unchanged" };

      return {
        kind: "rejected",
        reason:
          ran.stderr.trim() || ran.stdout.toString("utf8").trim() || `git exited with ${ran.code}`,
      };
    }

    const after = await readRepository(repo);

    return moves === "revision" && after.revision === before.revision
      ? { kind: "unchanged" }
      : { kind: "applied", revision: after.revision };
  };

  const watcher = createWatcher(env.cwd, status, repository, forget);

  const follow = <T>(read: (current: GitStatus) => Promise<T>): AsyncIterable<T> =>
    feed<T>((sink) => {
      let seen: string | null = null;
      let pending: GitStatus | null = null;
      let reading = false;
      let closed = false;

      const drain = async (): Promise<void> => {
        if (reading) return;
        reading = true;

        while (pending !== null && !closed) {
          const next: GitStatus = pending;
          pending = null;

          try {
            sink.push(await read(next));
          } catch (error) {
            closed = true;
            sink.fail(error);
          }
        }

        reading = false;
      };

      const unsubscribe = watcher.subscribe(
        (current) => {
          const key = current.kind === "none" ? "none" : current.revision;

          if (key === seen) return;
          seen = key;
          pending = current;
          void drain();
        },
        (error) => sink.fail(error),
      );

      return () => {
        closed = true;
        unsubscribe();
      };
    });

  const inRepo =
    <T>(read: (repo: Repository, current: Repo) => Promise<T>) =>
    async (current: GitStatus): Promise<T> => {
      if (current.kind === "none")
        throw new SdkError("unavailable", `${env.cwd} is not in a git repository.`);

      return read(await required(), current);
    };

  return {
    status,
    watch: () => follow(async (current) => current),
    async changes(scope, diff) {
      const repo = await required();

      return changesAt(repo, scope, await readRepository(repo), diff?.ignoreWhitespace);
    },
    watchChanges: (scope, diff) =>
      follow(inRepo((repo, current) => changesAt(repo, scope, current, diff?.ignoreWhitespace))),
    patches: (scope, paths, diff) =>
      follow(
        inRepo((repo, current) => patchesAt(repo, scope, paths, current, diff?.ignoreWhitespace)),
      ),
    async contents(path, scope) {
      const repo = await required();
      const current = await readRepository(repo);
      const root = repo.root;

      const from = into(
        repo,
        (await listChanged(repo, scope, current)).find((file) => file.path === path)?.from ?? path,
      );

      const at = into(repo, path);
      const head = current.head === null ? null : "HEAD";

      switch (scope.kind) {
        case "worktree":
          return {
            path,
            old: head === null ? { kind: "absent" } : await blob(root, `${head}:${from}`),
            new: await worktree(root, at),
          };
        case "staged":
          return {
            path,
            old: head === null ? { kind: "absent" } : await blob(root, `${head}:${from}`),
            new: await blob(root, `:${at}`),
          };
        case "unstaged":
          return { path, old: await blob(root, `:${from}`), new: await worktree(root, at) };
        case "commit": {
          const parent = await resolves(root, `${scope.commit}^`);

          return {
            path,
            old: parent === null ? { kind: "absent" } : await blob(root, `${parent}:${from}`),
            new: await blob(root, `${scope.commit}:${at}`),
          };
        }

        case "branch": {
          const base = (await git(root, ["merge-base", scope.base, "HEAD"])).stdout
            .toString("utf8")
            .trim();

          return {
            path,
            old: base === "" ? { kind: "absent" } : await blob(root, `${base}:${from}`),
            new: await blob(root, `HEAD:${at}`),
          };
        }
      }
    },
    async log(input) {
      const repo = await required();
      const skip = input?.cursor === undefined ? 0 : Number(input.cursor) || 0;
      const limit = Math.max(1, input?.limit ?? LOG_DEFAULT);

      const ran = await git(repo.root, [
        "log",
        "-z",
        `--skip=${skip}`,
        `-n${limit + 1}`,
        "--format=%H%x1f%P%x1f%an%x1f%ct%x1f%s",
      ]);

      if (ran.code !== 0) return { items: [], next: null };

      const records = ran.stdout
        .toString("utf8")
        .split("\u0000")
        .filter((record) => record !== "");

      const items = records.slice(0, limit).map((record): GitCommitView => {
        const [id = "", parents = "", author = "", time = "0", subject = ""] =
          record.split("\u001f");

        return {
          id: asId<"git-commit">(id),
          subject,
          author,
          committedAt: Number(time) * 1000,
          parents:
            parents === "" ? [] : parents.split(" ").map((parent) => asId<"git-commit">(parent)),
        };
      });

      const next: Cursor | null =
        records.length > limit ? asId<"cursor">(String(skip + limit)) : null;

      return { items, next };
    },
    async refs() {
      const repo = await required();

      const [current, branches, remotes] = await Promise.all([
        git(repo.root, ["symbolic-ref", "--short", "-q", "HEAD"]),
        git(repo.root, [
          "for-each-ref",
          "--format=%(refname:short)%00%(objectname)%00%(upstream:short)",
          "refs/heads",
        ]),
        git(repo.root, ["remote"]),
      ]);

      return {
        current: current.code === 0 ? current.stdout.toString("utf8").trim() : null,
        branches: lines(branches.stdout).map((line) => {
          const [name = "", commit = "", upstream = ""] = line.split("\u0000");

          return {
            name,
            commit: asId<"git-commit">(commit),
            upstream: upstream === "" ? null : upstream,
          };
        }),
        remotes: lines(remotes.stdout),
      };
    },
    async blame(path) {
      const repo = await required();
      const ran = await git(repo.root, ["blame", "--porcelain", "--", into(repo, path)]);

      if (ran.code !== 0)
        throw new SdkError("unknown", ran.stderr.trim() || `Cannot blame ${path}.`);

      return parseBlame(path, ran.stdout.toString("utf8"));
    },
    stage: (paths, guard) =>
      write(true, guard?.expect, (repo) =>
        git(repo.root, ["add", "-A", "--", ...paths.map((path) => into(repo, path))]),
      ),
    unstage: (paths, guard) =>
      write(true, guard?.expect, (repo, before) => {
        const inside = paths.map((path) => into(repo, path));

        return git(
          repo.root,
          before.head === null
            ? ["rm", "--cached", "-r", "-q", "--", ...inside]
            : ["restore", "--staged", "--", ...inside],
        );
      }),
    discard: (paths, guard) =>
      write(true, guard?.expect, async (repo, before) => {
        const untracked = new Set(before.untracked);

        const tracked = paths
          .filter((path) => !untracked.has(path))
          .map((path) => into(repo, path));

        const loose = paths.filter((path) => untracked.has(path)).map((path) => into(repo, path));

        const restored =
          tracked.length === 0
            ? null
            : await git(repo.root, ["restore", "--worktree", "--", ...tracked]);

        if (restored !== null && restored.code !== 0) return restored;

        return loose.length === 0
          ? (restored ?? "unchanged")
          : git(repo.root, ["clean", "-f", "-q", "--", ...loose]);
      }),
    commit: (input, guard) =>
      write(true, guard?.expect, async (repo) => {
        if (input.files === "staged") return git(repo.root, ["commit", "-q", "-m", input.message]);

        if (input.files === "all")
          return git(repo.root, ["commit", "-q", "-a", "-m", input.message]);
        const files = input.files.map((path) => into(repo, path));
        const added = await git(repo.root, ["add", "-A", "--", ...files]);

        if (added.code !== 0) return added;

        return git(repo.root, ["commit", "-q", "-m", input.message, "--", ...files]);
      }),
    branch: (input, guard) =>
      write(
        input.checkout,
        guard?.expect,
        (repo) =>
          git(
            repo.root,
            input.checkout ? ["switch", "-q", "-c", input.name] : ["branch", input.name],
          ),
        "always",
      ),
    push: (input, guard) =>
      write(
        false,
        guard?.expect,
        async (repo, before) => {
          if (input?.setUpstream === true && before.branch === null)
            return { rejected: "HEAD is detached; there is no branch to push." };

          const ran = await git(
            repo.root,
            input?.setUpstream === true && before.branch !== null
              ? ["push", "--porcelain", "--set-upstream", "origin", before.branch]
              : ["push", "--porcelain"],
          );

          const flags = lines(ran.stdout).flatMap((line) =>
            /^[ +\-*!=]\t/.test(line) ? [line[0]] : [],
          );

          return ran.code === 0 && flags.length > 0 && flags.every((flag) => flag === "=")
            ? "unchanged"
            : ran;
        },
        "always",
      ),
  };
}

async function readStatus(
  repo: Repository,
  porcelain: string,
  numstat: { readonly staged: string; readonly unstaged: string },
): Promise<Repo> {
  const tokens = porcelain.split("\u0000");
  const stagedStats = parseNumstat(numstat.staged);
  const unstagedStats = parseNumstat(numstat.unstaged);
  const staged: FileChange[] = [];
  const unstaged: FileChange[] = [];
  const untracked: string[] = [];
  const conflicts: string[] = [];
  let head: string | null = null;
  let branch: string | null = null;
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;

  const change = (
    path: string,
    code: string,
    stats: ReadonlyMap<string, LineStat>,
    from: string | undefined,
  ): FileChange => {
    const stat = stats.get(path);

    const counts =
      stat?.kind === "text"
        ? { added: stat.added, removed: stat.removed }
        : { added: 0, removed: 0 };

    const status: FileStatus =
      code === "A"
        ? "added"
        : code === "D"
          ? "deleted"
          : code === "R" || code === "C"
            ? "renamed"
            : "modified";

    return from === undefined || status !== "renamed"
      ? { path, status, ...counts }
      : { path, status, ...counts, from };
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";

    if (token.startsWith("# branch.oid ")) {
      const oid = token.slice("# branch.oid ".length);
      head = oid === "(initial)" ? null : oid;
    } else if (token.startsWith("# branch.head ")) {
      const name = token.slice("# branch.head ".length);
      branch = name === "(detached)" ? null : name;
    } else if (token.startsWith("# branch.upstream "))
      upstream = token.slice("# branch.upstream ".length);
    else if (token.startsWith("# branch.ab ")) {
      const [plus = "+0", minus = "-0"] = token.slice("# branch.ab ".length).split(" ");
      ahead = Number(plus.slice(1)) || 0;
      behind = Number(minus.slice(1)) || 0;
    } else if (token.startsWith("1 ") || token.startsWith("2 ")) {
      const renamed = token.startsWith("2 ");
      const fields = splitFields(token, renamed ? 9 : 8);
      const codes = fields.fields[1] ?? "..";
      const from = renamed ? tokens[index + 1] : undefined;

      if (renamed) index += 1;
      const x = codes[0] ?? ".";
      const y = codes[1] ?? ".";

      if (x !== ".") staged.push(change(fields.rest, x, stagedStats, from));

      if (y !== ".") unstaged.push(change(fields.rest, y, unstagedStats, undefined));
    } else if (token.startsWith("u ")) conflicts.push(splitFields(token, 10).rest);
    else if (token.startsWith("? ")) untracked.push(token.slice(2));
  }

  const stamps = await Promise.all(
    [...unstaged.map((file) => file.path), ...untracked].map(async (path) => {
      const found = await lstat(join(repo.root, path)).catch(() => null);

      return `${path}:${found === null ? "-" : `${found.size}:${found.mtimeMs}`}`;
    }),
  );

  return {
    kind: "repository",
    root: repo.root,
    head: head === null ? null : asId<"git-commit">(head),
    branch,
    upstream: upstream === null ? null : { name: upstream, ahead, behind },
    revision: asId<"git-revision">(
      sha256([porcelain, head ?? "", numstat.staged, numstat.unstaged, ...stamps].join("\u0000")),
    ),
    staged: staged.map((file) => withPaths(file, (path) => relativeToPrefix(repo, path))),
    unstaged: unstaged.map((file) => withPaths(file, (path) => relativeToPrefix(repo, path))),
    untracked: untracked.map((path) => relativeToPrefix(repo, path)),
    conflicts: conflicts.map((path) => relativeToPrefix(repo, path)),
  };
}

function into(repo: Repository, path: string): string {
  return `${repo.prefix}${path}`;
}

function relativeToPrefix(repo: Repository, path: string): string {
  return path.startsWith(repo.prefix)
    ? path.slice(repo.prefix.length)
    : `${"../".repeat(repo.prefix.split("/").length - 1)}${path}`;
}

function within(repo: Repository): readonly string[] {
  return repo.prefix === "" ? [] : ["--", repo.prefix];
}

function withPaths<T extends { readonly path: string; readonly from?: string }>(
  file: T,
  map: (path: string) => string,
): T {
  return file.from === undefined
    ? { ...file, path: map(file.path) }
    : { ...file, path: map(file.path), from: map(file.from) };
}

function splitFields(
  token: string,
  count: number,
): { readonly fields: readonly string[]; readonly rest: string } {
  const parts = token.split(" ");
  const fields = parts.slice(0, Math.min(count, parts.length - 1));

  return { fields, rest: parts.slice(fields.length).join(" ") };
}

function parseBlame(path: string, output: string): BlameView {
  const authors = new Map<string, { author: string; at: number }>();
  const rows: BlameView["lines"][number][] = [];
  let commit = "";
  let line = 0;

  for (const text of output.split("\n")) {
    const header = /^([0-9a-f]{40,64}) \d+ (\d+)(?: \d+)?$/.exec(text);

    if (header !== null) {
      commit = header[1] ?? "";
      line = Number(header[2]);

      if (!authors.has(commit)) authors.set(commit, { author: "", at: 0 });
      continue;
    }

    const known = authors.get(commit);

    if (text.startsWith("author ") && known !== undefined) known.author = text.slice(7);
    else if (text.startsWith("author-time ") && known !== undefined)
      known.at = Number(text.slice(12)) * 1000;
    else if (text.startsWith("\t"))
      rows.push({
        line,
        commit: asId<"git-commit">(commit),
        author: known?.author ?? "",
        at: known?.at ?? 0,
      });
  }

  return { path, lines: rows };
}

async function untrackedStat(path: string): Promise<LineStat> {
  const stats = await stat(path).catch(() => null);

  if (stats === null || !stats.isFile() || stats.size > PATCH_LIMIT) return { kind: "unknown" };
  const bytes = await readFile(path).catch(() => null);
  const text = bytes === null ? null : decodeText(bytes);

  return text === null ? { kind: "binary" } : lineStat("", text);
}

async function untrackedEntry(target: string, path: string): Promise<PatchEntry> {
  const stats = await stat(target).catch(() => null);

  if (stats === null || !stats.isFile())
    return {
      path,
      status: "untracked",
      digest: "",
      kind: "failed",
      reason: `${path} is not a file.`,
    };

  const bytes = await readFile(target).catch((error: unknown) =>
    error instanceof Error ? error.message : String(error),
  );

  if (typeof bytes === "string")
    return { path, status: "untracked", digest: "", kind: "failed", reason: bytes };
  const digest = sha256(bytes);

  if (bytes.byteLength > PATCH_LIMIT)
    return { path, status: "untracked", digest, kind: "too-large", limit: PATCH_LIMIT };
  const text = decodeText(bytes);

  return text === null
    ? { path, status: "untracked", digest, kind: "binary" }
    : textEntry(path, "untracked", null, text);
}

function decodeSide(bytes: Uint8Array, truncated: boolean): GitFileSide {
  if (bytes.includes(0)) return { kind: "binary" };

  if (truncated) return { kind: "truncated", head: new TextDecoder().decode(bytes) };
  const text = decodeText(bytes);

  return text === null ? { kind: "binary" } : { kind: "text", text };
}

function lines(output: Buffer): readonly string[] {
  return output
    .toString("utf8")
    .split("\n")
    .filter((line) => line !== "");
}

async function exists(path: string): Promise<boolean> {
  return lstat(path).then(
    () => true,
    () => false,
  );
}
