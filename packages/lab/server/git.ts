/**
 * Git for the review core: refs, commits, changed files, patches and file
 * contents of the repository the lab runs in, plus the worktrees Nyte codes in.
 * The only writes are `worktree add`, which creates a branch and checks it out
 * in a new directory; nothing here touches your checkout or its index. Every
 * call is one `git` process with an argument list, never a shell string, so a
 * ref or a path from the screen cannot become a command.
 */
import { execFile } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** One ref or object a reviewer may name: a branch, a tag, `origin/main`, or a hex id; never a `..` range. */
const REF = /^(?![-.])(?!.*\.\.)[\w./@^~-]{1,200}$/;

const FIELD = "\u001f";

const RECORD = "\u001e";

export interface CommitInfo {
  readonly oid: string;
  readonly short: string;
  readonly subject: string;
  readonly author: string;
  /** Epoch milliseconds. */
  readonly at: number;
  readonly parents: string[];
  /** The message past its subject line; empty for most commits. */
  readonly body: string;
}

type ChangeStatus = "added" | "modified" | "deleted" | "renamed";

interface FileChange {
  readonly path: string;
  readonly previousPath?: string;
  readonly status: ChangeStatus;
  readonly added: number;
  readonly removed: number;
  readonly binary: boolean;
  /** The file's blob before and after, `old..new`: names this exact change, and changes with it. */
  readonly blobs: string;
}

interface BranchInfo {
  readonly name: string;
  readonly oid: string;
  readonly subject: string;
  readonly at: number;
  /** Commits on the branch that the base lacks. */
  readonly ahead: number;
  /** Commits on the base that the branch lacks. */
  readonly behind: number;
}

interface Worktree {
  readonly path: string;
  readonly branch?: string;
}

class GitError extends Error {
  /** The process exit code, when git ran and failed. */
  readonly code: number | undefined;

  constructor(message: string, code: number | undefined) {
    super(message);
    this.code = code;
  }
}

/**
 * The repository the lab runs in. Every method is one `git` process at the
 * checkout's root.
 */
export class Repo {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  #git(
    args: readonly string[],
    options?: { readonly maxBuffer?: number; readonly quiet?: readonly number[] },
  ): Promise<string> {
    return run(this.root, args, options);
  }

  /** The commit a ref names, or undefined when it names none. */
  async resolve(ref: string): Promise<string | undefined> {
    if (!REF.test(ref)) return undefined;

    return this.#git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])
      .then((out) => out.trim() || undefined)
      .catch(() => undefined);
  }

  async mergeBase(left: string, right: string): Promise<string | undefined> {
    return this.#git(["merge-base", left, right])
      .then((out) => out.trim() || undefined)
      .catch(() => undefined);
  }

  /** Whether `descendant` contains `ancestor`. */
  descends(ancestor: string, descendant: string): Promise<boolean> {
    return this.#git(["merge-base", "--is-ancestor", ancestor, descendant]).then(
      () => true,
      () => false,
    );
  }

  /** Commits in `base..head`, newest first. */
  async log(base: string, head: string, limit = 500): Promise<readonly CommitInfo[]> {
    const out = await this.#git([
      "log",
      `--max-count=${limit}`,
      `--format=%H${FIELD}%h${FIELD}%s${FIELD}%an${FIELD}%at${FIELD}%P${FIELD}%b${RECORD}`,
      `${base}..${head}`,
    ]);

    return out
      .split(RECORD)
      .map((record) => record.trim())
      .filter((record) => record !== "")
      .flatMap((record) => {
        const [oid, short, subject, author, at, parents, body] = record.split(FIELD);

        if (oid === undefined || short === undefined || subject === undefined) return [];

        return [
          {
            oid,
            short,
            subject,
            author: author ?? "",
            at: Number(at ?? 0) * 1000,
            parents: (parents ?? "").split(" ").filter((parent) => parent !== ""),
            body: (body ?? "").trim(),
          },
        ];
      });
  }

  /**
   * Files changed between two commits, with rename detection and line counts.
   * `--numstat -z` prints a rename as an empty path followed by the old and
   * new paths as their own fields; `--raw -z` prints `:oldmode newmode oldblob
   * newblob status`, then the path, or both paths for a rename or copy.
   */
  async changes(base: string, head: string): Promise<readonly FileChange[]> {
    const [numstat, raw] = await Promise.all([
      this.#git(["diff", "--numstat", "-z", "-M", base, head]),
      this.#git(["diff", "--raw", "--no-abbrev", "-z", "-M", base, head]),
    ]);

    const counts = new Map<string, { readonly added: number; readonly removed: number }>();
    const binary = new Set<string>();
    const numbers = numstat.split("\0");

    for (let index = 0; index < numbers.length; index++) {
      const entry = numbers[index];

      if (entry === undefined || entry === "") continue;

      const [added, removed, path] = entry.split("\t");
      const target = path === "" ? numbers[(index += 2)] : path;

      if (target === undefined) continue;

      if (added === "-") binary.add(target);

      counts.set(target, { added: Number(added) || 0, removed: Number(removed) || 0 });
    }

    const fields = raw.split("\0");
    const found: FileChange[] = [];

    for (let index = 0; index < fields.length; index++) {
      const [, , before, after, code] = (fields[index] ?? "").slice(1).split(" ");

      if (before === undefined || after === undefined || code === undefined) continue;

      const renamed = code.startsWith("R") || code.startsWith("C");
      const previousPath = renamed ? fields[++index] : undefined;
      const path = fields[++index];

      if (path === undefined) continue;

      const count = counts.get(path) ?? { added: 0, removed: 0 };

      const kind: ChangeStatus = renamed
        ? "renamed"
        : code.startsWith("A")
          ? "added"
          : code.startsWith("D")
            ? "deleted"
            : "modified";

      const change: FileChange = {
        path,
        status: kind,
        added: count.added,
        removed: count.removed,
        binary: binary.has(path),
        blobs: `${before}..${after}`,
      };

      found.push(previousPath === undefined ? change : { ...change, previousPath });
    }

    return found;
  }

  /** One file's patch between two commits, or every file's when `paths` is empty. */
  patch(base: string, head: string, paths: readonly string[] = []): Promise<string> {
    return this.#git(["diff", "--no-color", "--no-ext-diff", "-M", base, head, "--", ...paths]);
  }

  /** A file at a commit, or undefined where it does not exist there. */
  show(revision: string, path: string): Promise<string | undefined> {
    return this.#git(["show", `${revision}:${path}`], { maxBuffer: 8 * 1024 * 1024 }).catch(
      () => undefined,
    );
  }

  /** `git grep` at a commit: `path:line:text`, at most `limit` lines. Exit 1 means no match. */
  async grep(
    revision: string,
    pattern: string,
    path: string | undefined,
    limit: number,
  ): Promise<readonly string[]> {
    const out = await this.#git(
      [
        "grep",
        "-n",
        "-I",
        "-E",
        `--max-count=${limit}`,
        "-e",
        pattern,
        revision,
        "--",
        ...(path === undefined ? [] : [path]),
      ],
      { quiet: [1] },
    );

    const prefix = `${revision}:`;

    return out
      .split("\n")
      .filter((line) => line !== "")
      .slice(0, limit)
      .map((line) => (line.startsWith(prefix) ? line.slice(prefix.length) : line));
  }

  /** Local branches with commits the base lacks, most recently committed first. */
  async branches(base: string): Promise<readonly BranchInfo[]> {
    const out = await this.#git([
      "for-each-ref",
      "--sort=-committerdate",
      `--format=%(refname:short)${FIELD}%(objectname)${FIELD}%(subject)${FIELD}%(committerdate:unix)`,
      "refs/heads",
    ]);

    const rows = out
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => line.split(FIELD));

    const listed = await Promise.all(
      rows.map(async ([name, oid, subject, at]) => {
        if (name === undefined || oid === undefined) return undefined;

        const counts = await this.#git(["rev-list", "--left-right", "--count", `${base}...${oid}`]);
        const [behind, ahead] = counts.trim().split(/\s+/).map(Number);

        return {
          name,
          oid,
          subject: subject ?? "",
          at: Number(at ?? 0) * 1000,
          ahead: ahead ?? 0,
          behind: behind ?? 0,
        };
      }),
    );

    return listed.filter((entry): entry is BranchInfo => entry !== undefined && entry.ahead > 0);
  }

  /** Whether `name` is a local branch. */
  hasBranch(name: string): Promise<boolean> {
    if (!REF.test(name)) return Promise.resolve(false);

    return this.#git(["show-ref", "--verify", "--quiet", `refs/heads/${name}`]).then(
      () => true,
      () => false,
    );
  }

  /** Every worktree of the repository, and the branch each has checked out. */
  async worktrees(): Promise<readonly Worktree[]> {
    const out = await this.#git(["worktree", "list", "--porcelain"]);

    return out
      .split("\n\n")
      .map((block) => block.split("\n"))
      .flatMap((lines) => {
        const path = lines.find((line) => line.startsWith("worktree "))?.slice(9);
        const branch = lines.find((line) => line.startsWith("branch refs/heads/"))?.slice(18);

        if (path === undefined) return [];

        return [branch === undefined ? { path } : { path, branch }];
      });
  }

  /** Check `branch` out at `path`, creating it at `from` when given. */
  async addWorktree(path: string, branch: string, from?: string): Promise<void> {
    if (!REF.test(branch)) throw new GitError(`${branch} is not a branch name`, undefined);

    await this.#git(
      from === undefined
        ? ["worktree", "add", path, branch]
        : ["worktree", "add", "-b", branch, path, from],
    );
  }

  /** The branch your checkout is on, if any. */
  current(): Promise<string | undefined> {
    return this.#git(["symbolic-ref", "--quiet", "--short", "HEAD"]).then(
      (out) => out.trim() || undefined,
      () => undefined,
    );
  }
}

/**
 * Some commands report "nothing found" with an exit code rather than empty
 * output; `quiet` lists the codes that resolve with stdout instead of failing.
 */
function run(
  cwd: string,
  args: readonly string[],
  options: { readonly maxBuffer?: number; readonly quiet?: readonly number[] } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", cwd, "-c", "core.quotepath=off", ...args],
      { maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error === null) return resolve(stdout);

        const code = Number(error.code);
        const exit = Number.isInteger(code) ? code : undefined;

        if (exit !== undefined && options.quiet?.includes(exit)) return resolve(stdout);

        reject(new GitError(stderr.trim() || error.message, exit));
      },
    );
  });
}

/** The repository that contains this file. */
export async function openRepo(): Promise<Repo> {
  const here = dirname(fileURLToPath(import.meta.url));

  return new Repo((await run(here, ["rev-parse", "--show-toplevel"])).trim());
}
