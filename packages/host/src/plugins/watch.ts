/**
 * Watch plugin sources through their parent directories (editors that save by
 * rename replace the inode a direct file watch holds) filtered by basename, and
 * symlinked files at their resolved target too. Missing retryable targets are
 * polled until they can be armed. Based on opencode v2 `tui/src/plugin/watch.ts`.
 */
import { existsSync, watch, type FSWatcher } from "node:fs";
import { lstat, realpath, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

const sourceListeners = new Set<() => void>();

export function notifyPluginSources(): void {
  for (const listener of sourceListeners) listener();
}

export interface SourceWatcher {
  /** Watch an existing file or directory; a missing one is ignored. */
  readonly add: (target: string) => Promise<void>;
  /** Watch a file or directory, polling until it exists. */
  readonly wait: (target: string) => Promise<void>;
  dispose(): void;
}

export function createSourceWatcher(onChange: () => void): SourceWatcher {
  const watchers = new Map<string, ReturnType<typeof watch>>();
  const watched = new Map<string, Set<string> | null>();
  const missing = new Set<string>();
  const arming = new Map<string, Promise<void>>();
  const targets = new Set<string>();
  let disposed = false;
  let poll: ReturnType<typeof setInterval> | undefined;

  const notify = (): void => {
    if (!disposed) onChange();
  };

  const forget = (directory: string): void => {
    watchers.get(directory)?.close();
    watchers.delete(directory);
    watched.delete(directory);
    for (const target of targets) {
      if (target === directory || dirname(target) === directory) void arm(target, true);
    }
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
        watcher.unref();
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
    if (retry) targets.add(target);
    await arm(target, retry);
    await lstat(target)
      .then((info) =>
        info.isSymbolicLink()
          ? realpath(target).then((resolved) => arm(resolved, retry))
          : undefined,
      )
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
      targets.clear();
    },
  };
}

export interface WatchTarget {
  readonly path: string;
  /** Default true. A shallow watch sees the directory's own entries only. */
  readonly recursive?: boolean;
  /** Entry names that count; others under this target are ignored. Default all. */
  readonly names?: readonly string[];
}

export interface WatchOptions {
  directories: readonly WatchTarget[];
  /** Called after a quiet period following any change under the directories. */
  onChange: () => void | Promise<void>;
  debounceMs?: number;
  /** Change handler failures land here instead of being lost. */
  onError?: (error: Error) => void;
  /**
   * Taken on the first raw event of a burst and released once `onChange` has
   * run with nothing further pending, so work gated on it sees the reload.
   */
  hold?: () => () => void;
}

/**
 * Watch plugin directories and call `onChange` once per burst of edits. A
 * directory that does not exist yet is retried on each burst from the others
 * and on a slow timer, so creating `.nyte/plugins` later is picked up. Returns
 * a stop function.
 */
function normalizeWatchTargets(targets: readonly WatchTarget[]): WatchTarget[] {
  const merged = new Map<string, WatchTarget>();
  for (const target of targets) {
    const path = resolve(target.path);
    const previous = merged.get(path);
    if (previous === undefined) {
      merged.set(path, { ...target, path });
      continue;
    }
    const names =
      previous.names === undefined || target.names === undefined
        ? undefined
        : [...new Set([...previous.names, ...target.names])];
    merged.set(path, {
      path,
      recursive: (previous.recursive ?? true) || (target.recursive ?? true),
      ...(names === undefined ? {} : { names }),
    });
  }
  return [...merged.values()];
}

export function watchPluginDirectories(options: WatchOptions): () => void {
  const directories = normalizeWatchTargets(options.directories);
  const watchers = new Map<string, FSWatcher>();
  const unavailable = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let pending = false;
  let stopped = false;
  let release: (() => void) | undefined;
  const report = options.onError ?? (() => undefined);

  const fire = async (): Promise<void> => {
    if (running) {
      pending = true;

      return;
    }

    running = true;

    try {
      await options.onChange();
    } catch (error) {
      report(error instanceof Error ? error : new Error(String(error)));
    } finally {
      running = false;

      if (pending && !stopped) {
        pending = false;
        schedule();
      } else {
        release?.();
        release = undefined;
      }
    }
  };

  const schedule = (): void => {
    if (stopped) return;
    release ??= options.hold?.();
    if (running) {
      pending = true;
      return;
    }

    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      ensureWatchers();
      void fire();
    }, options.debounceMs ?? 150);
  };

  const ensureWatchers = (): void => {
    for (const directory of directories) {
      if (watchers.has(directory.path)) continue;

      try {
        const names = directory.names === undefined ? undefined : new Set(directory.names);

        const watcher = watch(
          directory.path,
          { recursive: directory.recursive ?? true },
          (_event, filename) => {
            if (!existsSync(directory.path)) {
              watchers.delete(directory.path);
              watcher.close();
              unavailable.add(directory.path);
              schedule();
              return;
            }
            // A null filename is platform-dependent and always counts.
            if (names !== undefined && filename !== null && !names.has(filename.toString())) return;
            schedule();
          },
        );

        watcher.on("error", () => {
          watchers.delete(directory.path);
          watcher.close();
          // The native watcher may be unavailable (for example EMFILE). Rescan
          // once now; the existing slow retry will try to restore watching.
          unavailable.add(directory.path);
          schedule();
        });
        watchers.set(directory.path, watcher);
        if (unavailable.delete(directory.path)) schedule();
      } catch {
        unavailable.add(directory.path);
      }
    }
  };

  sourceListeners.add(schedule);
  ensureWatchers();
  const retry = setInterval(ensureWatchers, 5_000);
  retry.unref?.();

  return () => {
    stopped = true;
    sourceListeners.delete(schedule);
    clearInterval(retry);

    if (timer !== undefined) clearTimeout(timer);
    release?.();
    release = undefined;

    for (const watcher of watchers.values()) watcher.close();
    watchers.clear();
  };
}
