import { watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import { basename, dirname, join, sep } from "node:path";
import type { Disposer } from "@nyte-ai/schema";
import ignore from "ignore";

export type TreeEntry = {
  readonly path: string;
  readonly kind: "file" | "directory" | "symlink";
  readonly size: number | null;
};

export type WalkFrame =
  | { readonly kind: "entries"; readonly entries: readonly TreeEntry[] }
  | { readonly kind: "complete" }
  | { readonly kind: "incomplete"; readonly reason: "limit" | "permission" };

export type Ignores = {
  matches(path: string, directory: boolean): Promise<boolean>;
  ignored(path: string, directory: boolean): Promise<boolean>;
  forget(directory: string): void;
};

export const WALK_LIMIT = 50_000;

const WALK_PAGE = 500;

type Matcher = ReturnType<typeof ignore>;

export function createIgnores(root: string): Ignores {
  const rules = new Map<string, Promise<Matcher | null>>();

  const loadRules = (directory: string): Promise<Matcher | null> => {
    const known = rules.get(directory);

    if (known !== undefined) return known;
    const sources = [join(root, directory, ".gitignore")];

    if (directory === "") sources.push(join(root, ".git", "info", "exclude"));

    const loaded = Promise.all(
      sources.map((source) => readFile(source, "utf8").catch(() => null)),
    ).then((texts) => {
      const found = texts.filter((text) => text !== null);

      return found.length === 0
        ? null
        : found.reduce((matcher: Matcher, text) => matcher.add(text), ignore());
    });

    rules.set(directory, loaded);

    return loaded;
  };

  const matches = async (path: string, directory: boolean): Promise<boolean> => {
    const segments = path.split("/");

    if (segments.includes(".git")) return true;
    let result = false;

    for (let depth = 0; depth < segments.length; depth += 1) {
      const matcher = await loadRules(segments.slice(0, depth).join("/"));

      if (matcher === null) continue;
      const relative = segments.slice(depth).join("/") + (directory ? "/" : "");

      if (!ignore.isPathValid(relative.replace(/\/$/, ""))) continue;
      const test = matcher.test(relative);

      if (test.ignored) result = true;
      else if (test.unignored) result = false;
    }

    return result;
  };

  return {
    matches,
    async ignored(path, directory) {
      const segments = path.split("/");

      for (let depth = 1; depth < segments.length; depth += 1)
        if (await matches(segments.slice(0, depth).join("/"), true)) return true;

      return matches(path, directory);
    },
    forget(directory) {
      rules.delete(directory);
    },
  };
}

export async function* walkTree(
  root: string,
  options: {
    readonly directory?: string;
    readonly ignored: "exclude" | "include";
    readonly ignores?: Ignores;
    readonly limit?: number;
    readonly page?: number;
  },
): AsyncGenerator<WalkFrame> {
  const ignores = options.ignores ?? createIgnores(root);
  const limit = options.limit ?? WALK_LIMIT;
  const size = options.page ?? WALK_PAGE;
  const queue = [trimSlashes(options.directory ?? "")];
  let page: TreeEntry[] = [];
  let count = 0;
  let denied = false;

  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const directory = next;

    const listed = await readdir(join(root, directory), { withFileTypes: true }).catch(
      (error: unknown) => {
        if (readErrorCode(error) === "EACCES" || readErrorCode(error) === "EPERM") denied = true;

        return null;
      },
    );

    if (listed === null) continue;
    listed.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));

    const entries = await Promise.all(
      listed.map(async (dirent): Promise<TreeEntry | null> => {
        const path = directory === "" ? dirent.name : `${directory}/${dirent.name}`;

        const kind = dirent.isSymbolicLink()
          ? "symlink"
          : dirent.isDirectory()
            ? "directory"
            : dirent.isFile()
              ? "file"
              : null;

        if (kind === null || dirent.name === ".git") return null;

        if (options.ignored === "exclude" && (await ignores.matches(path, kind === "directory")))
          return null;

        if (kind === "directory") return { path, kind, size: null };
        const stats = await lstat(join(root, path)).catch(() => null);

        return stats === null ? null : { path, kind, size: stats.size };
      }),
    );

    for (const entry of entries) {
      if (entry === null) continue;
      page.push(entry);
      count += 1;

      if (entry.kind === "directory") queue.push(entry.path);

      if (count >= limit) {
        yield { kind: "entries", entries: page };
        yield { kind: "incomplete", reason: "limit" };

        return;
      }

      if (page.length >= size) {
        yield { kind: "entries", entries: page };
        page = [];
      }
    }
  }

  if (page.length > 0) yield { kind: "entries", entries: page };
  yield denied ? { kind: "incomplete", reason: "permission" } : { kind: "complete" };
}

/** Calls `changed` with the paths below `root` that moved, coalesced over `delay`, from a recursive `fs.watch`; where that is unavailable it walks the tree every `poll` ms when one is given, and calls `unwatched` once either way. */
export function watchTree(
  root: string,
  options: {
    readonly delay: number;
    readonly poll: number | null;
    readonly unwatched?: () => void;
  },
  changed: (paths: ReadonlySet<string>) => void,
): Disposer {
  let pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let polling: ReturnType<typeof setTimeout> | null = null;
  let watcher: FSWatcher | null = null;
  let fellBack = false;
  let stopped = false;

  const flush = (): void => {
    timer = null;
    const paths = pending;
    pending = new Set();

    if (!stopped && paths.size > 0) changed(paths);
  };

  const note = (path: string): void => {
    pending.add(path);
    timer ??= setTimeout(flush, options.delay);
  };

  const poll = (every: number): void => {
    let known: Map<string, string> | null = null;

    const tick = async (): Promise<void> => {
      const seen = new Map<string, string>();

      for await (const frame of walkTree(root, { ignored: "include" }))
        if (frame.kind === "entries")
          for (const entry of frame.entries) {
            const stats = await lstat(join(root, entry.path)).catch(() => null);
            seen.set(entry.path, stats === null ? "" : `${stats.size}:${stats.mtimeMs}`);
          }

      if (known !== null) {
        for (const [path, stamp] of seen) if (known.get(path) !== stamp) note(path);

        for (const path of known.keys()) if (!seen.has(path)) note(path);
      }

      known = seen;
    };

    const again = (): void => {
      if (stopped) return;
      polling = setTimeout(() => {
        tick().then(again, again);
      }, every);
    };

    tick().then(again, again);
  };

  const fallback = (): void => {
    watcher?.close();
    watcher = null;

    if (stopped || fellBack) return;
    fellBack = true;
    options.unwatched?.();

    if (options.poll !== null) poll(options.poll);
  };

  try {
    watcher = watch(root, { recursive: true }, (_event, filename) =>
      note(filename === null ? "" : filename.split(sep).join("/")),
    );
    watcher.on("error", fallback);
  } catch {
    fallback();
  }

  return () => {
    stopped = true;
    watcher?.close();

    if (timer !== null) clearTimeout(timer);

    if (polling !== null) clearTimeout(polling);
  };
}

/**
 * Calls `changed` when what is at the absolute `target` moves, coalesced over
 * `delay`: with `""` for the target itself (created, removed, replaced or, for
 * a file, written) and the path below it for a change inside a directory,
 * which is watched recursively. A file is watched itself and re-watched when
 * it is replaced, a directory beside a watch on its parent for its own name;
 * while the target is missing, the nearest directory above it that exists is
 * watched for the next missing name, and the watch moves down as they appear.
 * Nothing polls.
 */
export function watchPath(
  target: string,
  options: { readonly delay: number },
  changed: (paths: ReadonlySet<string>) => void,
): Disposer {
  let pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let watchers: FSWatcher[] = [];
  let generation = 0;
  let moved = false;
  let stopped = false;

  const flush = (): void => {
    timer = null;
    const paths = pending;
    pending = new Set();

    if (stopped) return;

    if (moved) {
      moved = false;
      void arm();
    }

    if (paths.size > 0) changed(paths);
  };

  const note = (path: string, replaced: boolean): void => {
    pending.add(path);
    moved ||= replaced;
    timer ??= setTimeout(flush, options.delay);
  };

  const listen = (
    at: string,
    recursive: boolean,
    heard: (event: string, name: string | null) => void,
  ): void => {
    try {
      const watcher = watch(at, { recursive, persistent: false }, (event, name) =>
        heard(event, name === null ? null : name.split(sep).join("/")),
      );

      watcher.on("error", () => note("", true));
      watchers.push(watcher);
    } catch {}
  };

  const arm = async (): Promise<void> => {
    generation += 1;
    const armed = generation;

    for (const watcher of watchers) watcher.close();
    watchers = [];
    let existing = target;
    let missing: string | null = null;
    let stats = await lstat(existing).catch(() => null);

    while (stats === null) {
      const parent = dirname(existing);

      if (parent === existing) return;
      missing = basename(existing);
      existing = parent;
      stats = await lstat(existing).catch(() => null);
    }

    if (stopped || armed !== generation) return;

    if (missing !== null) {
      const awaited = missing;

      if (stats.isDirectory())
        listen(existing, false, (_event, name) => {
          if (name === null || name === awaited) note("", true);
        });

      return;
    }

    if (!stats.isDirectory()) {
      listen(target, false, (event) => note("", event === "rename"));

      return;
    }

    const own = basename(target);
    listen(target, true, (_event, name) => note(name ?? "", false));
    listen(dirname(target), false, (event, name) => {
      if (name === null || name === own) note("", event === "rename");
    });
  };

  void arm();

  return () => {
    stopped = true;
    generation += 1;

    for (const watcher of watchers) watcher.close();
    watchers = [];

    if (timer !== null) clearTimeout(timer);
  };
}

export function readErrorCode(error: unknown): string | null {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : null;
}

function trimSlashes(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/^\.?\/+|\/+$/g, "")
    .replace(/^\.$/, "");
}
