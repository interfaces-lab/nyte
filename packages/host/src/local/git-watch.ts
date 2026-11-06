import { lstat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import type { Disposer, GitStatus } from "@nyte-ai/schema";
import type { FeedSink } from "./feed.ts";
import { createIgnores, watchTree } from "./tree.ts";

export type Repository = {
  readonly root: string;
  readonly gitDir: string;
  readonly commonDir: string;
  readonly prefix: string;
};

export type GitWatcher = {
  subscribe(listener: (status: GitStatus) => void, fail: FeedSink<GitStatus>["fail"]): Disposer;
};

const WATCH_DELAY_MS = 250;

const POLL_MS = 2_000;

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

    const gitEntry = async (): Promise<boolean> =>
      (await lstat(join(cwd, ".git")).catch(() => null)) !== null;

    void Promise.all([repository(), gitEntry()]).then(([repo, hadGit]) => {
      if (stopped) return;
      const insideGitDir = repo === null ? null : pathInside(cwd, repo.gitDir);
      const ignores = repo === null ? null : createIgnores(repo.root);

      const moved = async (
        paths: ReadonlySet<string>,
      ): Promise<"none" | "status" | "repository"> => {
        let found: "none" | "status" = "none";

        for (const path of paths) {
          if (path === ".git") {
            if ((await gitEntry()) !== hadGit) return "repository";

            continue;
          }

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

          if (found !== "none") continue;
          const directory = (await lstat(join(cwd, path)).catch(() => null))?.isDirectory();

          if (!(await ignores.ignored(`${repo.prefix}${path}`, directory === true)))
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

function movesStatus(path: string): boolean {
  const [top = ""] = path.split("/");

  return (
    path === "" ||
    GIT_STATE.has(top) ||
    path.startsWith("refs/heads/") ||
    path.startsWith("refs/remotes/")
  );
}

function pathInside(cwd: string, dir: string): string | null {
  const inside = relative(cwd, dir);

  return inside.startsWith("..") || isAbsolute(inside) ? null : inside.split(sep).join("/");
}
