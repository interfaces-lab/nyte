/**
 * Watch plugin sources through their parent directories (editors that save by
 * rename replace the inode a direct file watch holds) filtered by basename, and
 * symlinked files at their resolved target too. Missing retryable targets are
 * polled until they can be armed. Based on opencode v2 `tui/src/plugin/watch.ts`.
 */
import { existsSync, watch } from "node:fs";
import { lstat, realpath, stat } from "node:fs/promises";
import { basename, dirname } from "node:path";

export interface SourceWatcher {
  /** Watch an existing file or directory; a missing one is ignored. */
  add(target: string): Promise<void>;
  /** Watch a file or directory, polling until it exists. */
  wait(target: string): Promise<void>;
  dispose(): void;
}

export function createSourceWatcher(onChange: () => void): SourceWatcher {
  const watchers = new Map<string, ReturnType<typeof watch>>();
  const watched = new Map<string, Set<string> | null>();
  const missing = new Set<string>();
  const arming = new Map<string, Promise<void>>();
  let disposed = false;
  let poll: ReturnType<typeof setInterval> | undefined;

  const notify = (): void => {
    if (!disposed) onChange();
  };

  const forget = (directory: string): void => {
    watchers.get(directory)?.close();
    watchers.delete(directory);
    watched.delete(directory);
  };

  const arm = (target: string, retry: boolean): Promise<void> => {
    const active = arming.get(target);

    if (active) return active;

    const result = stat(target)
      .then((info) => {
        if (disposed) return;
        const appeared = missing.delete(target);
        const directory = info.isDirectory() ? target : dirname(target);
        const name = info.isDirectory() ? null : basename(target);
        const existing = watched.get(directory);

        if (existing !== undefined) {
          if (name === null) watched.set(directory, null);
          else existing?.add(name);

          if (appeared) notify();

          return;
        }

        const watcher = watch(directory, (_event, filename) => {
          if (!existsSync(directory)) {
            forget(directory);
            notify();

            return;
          }

          const accept = watched.get(directory);

          if (filename && accept && !accept.has(filename.toString())) return;
          notify();
        });

        watched.set(directory, name === null ? null : new Set([name]));
        watcher.on("error", () => {
          forget(directory);
          notify();
        });
        watchers.set(directory, watcher);

        if (appeared) notify();
      })
      .catch(() => {
        if (!disposed && retry && !existsSync(target)) missing.add(target);
      })
      .finally(() => {
        arming.delete(target);

        if (disposed || missing.size === 0) {
          clearInterval(poll);
          poll = undefined;
        } else if (poll === undefined) {
          poll = setInterval(() => {
            for (const target of missing) void arm(target, true);
          }, 500);
          poll.unref();
        }
      });

    arming.set(target, result);

    return result;
  };

  const add = async (target: string, retry: boolean): Promise<void> => {
    await arm(target, retry);
    await lstat(target)
      .then((info) => (info.isSymbolicLink() ? realpath(target).then((resolved) => arm(resolved, retry)) : undefined))
      .catch(() => undefined);
  };

  return {
    add: (target) => add(target, false),
    wait: (target) => add(target, true),
    dispose: () => {
      disposed = true;
      clearInterval(poll);
      poll = undefined;

      for (const watcher of watchers.values()) watcher.close();
      watchers.clear();
      watched.clear();
      missing.clear();
    },
  };
}
