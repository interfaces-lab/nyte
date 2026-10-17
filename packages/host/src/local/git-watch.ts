import { isAbsolute, relative, sep } from "node:path";
import type { Disposer, GitStatus } from "@nyte-ai/schema";
import type { FeedSink } from "./feed.ts";
import { createIgnores, watchTree } from "./tree.ts";

/** Where `localGit` found the repository holding its workspace: the worktree root, its git directory, the common directory linked worktrees share (the git directory otherwise), and the workspace's path below the root (`""` or ending in `/`). */
export type Repository = {
  readonly root: string;
  readonly gitDir: string;
  readonly commonDir: string;
  readonly prefix: string;
};

/** One status watch shared by `localGit`'s feeds. */
export type GitWatcher = {
  subscribe(listener: (status: GitStatus) => void, fail: FeedSink<GitStatus>["fail"]): Disposer;
};

const WATCH_DELAY_MS = 250;

const POLL_MS = 2_000;

/** The entries of a git directory whose change can move the status; objects, logs, hooks and Nyte's own snapshot refs cannot. */
const GIT_STATE = new Set([
  "HEAD",
  "index",
  "packed-refs",
  "config",
  "MERGE_HEAD",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
  "rebase-merge",
  "rebase-apply",
]);

/** Returns the status watch `localGit` shares among its watchers: the first subscriber starts it and the last one stops it, and each gets the status at once, then again whenever a change could move it. A recursive `fs.watch` on the workspace hears worktree paths that `.gitignore` and `.git/info/exclude` do not ignore, and, in the git directory and the common directory, only HEAD, the index, branch and remote refs, `packed-refs`, `config` and the merge, cherry-pick, revert and rebase state, so object writes, logs and Nyte's snapshot refs read nothing; the `.git` entry itself appearing or going drops the remembered repository and starts over. Only where `fs.watch` is unavailable does it poll, every 2 s. */
export function createWatcher(
  cwd: string,
  read: () => Promise<GitStatus>,
  repository: () => Promise<Repository | null>,
  forget: () => void,
): GitWatcher {
  const listeners = new Set<(status: GitStatus) => void>();
  let stop: Disposer | null = null;
  let checking = false;
  let again = false;

  const check = async (): Promise<void> => {
    if (checking) {
      again = true;

      return;
    }

    checking = true;

    do {
      again = false;
      const current = await read().catch(() => null);

      if (current !== null) for (const listener of listeners) listener(current);
    } while (again && listeners.size > 0);

    checking = false;
  };

  const restart = (): void => {
    forget();
    stop?.();
    stop = start();
    void check();
  };

  const start = (): Disposer => {
    const disposers: Disposer[] = [];
    let polling: ReturnType<typeof setInterval> | null = null;
    let stopped = false;

    const unwatched = (): void => {
      polling ??= setInterval(() => void check(), POLL_MS);
    };

    const watchGitDir = (dir: string): void => {
      disposers.push(
        watchTree(dir, { delay: WATCH_DELAY_MS, poll: null, unwatched }, (paths) => {
          if ([...paths].some(movesStatus)) void check();
        }),
      );
    };

    void repository().then((repo) => {
      if (stopped) return;
      const insideGitDir = repo === null ? null : pathInside(cwd, repo.gitDir);
      const ignores = repo === null ? null : createIgnores(repo.root);

      const moved = async (
        paths: ReadonlySet<string>,
      ): Promise<"none" | "status" | "repository"> => {
        let found: "none" | "status" = "none";

        for (const path of paths) {
          if (path === ".git") return "repository";

          if (repo === null || ignores === null) continue;

          if (
            insideGitDir !== null &&
            (path === insideGitDir || path.startsWith(`${insideGitDir}/`))
          ) {
            if (movesStatus(path.slice(insideGitDir.length + 1))) found = "status";

            continue;
          }

          if (path.endsWith(".gitignore"))
            ignores.forget(`${repo.prefix}${path}`.split("/").slice(0, -1).join("/"));

          if (found === "none" && !(await ignores.ignored(`${repo.prefix}${path}`, false)))
            found = "status";
        }

        return found;
      };

      disposers.push(
        watchTree(cwd, { delay: WATCH_DELAY_MS, poll: null, unwatched }, (paths) => {
          void moved(paths).then((outcome) => {
            if (stopped) return;

            if (outcome === "repository") restart();
            else if (outcome === "status") void check();
          });
        }),
      );

      if (repo === null) return;

      if (insideGitDir === null) watchGitDir(repo.gitDir);

      if (repo.commonDir !== repo.gitDir && pathInside(cwd, repo.commonDir) === null)
        watchGitDir(repo.commonDir);
    });

    return () => {
      stopped = true;

      if (polling !== null) clearInterval(polling);

      for (const dispose of disposers) dispose();
    };
  };

  return {
    subscribe(listener, fail) {
      listeners.add(listener);
      stop ??= start();
      void read().then(listener, fail);

      return () => {
        listeners.delete(listener);

        if (listeners.size === 0) {
          stop?.();
          stop = null;
        }
      };
    },
  };
}

/** Whether a change at `path` inside a git directory can move the status. */
function movesStatus(path: string): boolean {
  const [top = ""] = path.split("/");

  return (
    path === "" ||
    GIT_STATE.has(top) ||
    path === "refs" ||
    path.startsWith("refs/heads/") ||
    path.startsWith("refs/remotes/")
  );
}

/** Returns `dir` relative to `cwd` when it lies inside it, else null. */
function pathInside(cwd: string, dir: string): string | null {
  const inside = relative(cwd, dir);

  return inside.startsWith("..") || isAbsolute(inside) ? null : inside.split(sep).join("/");
}
