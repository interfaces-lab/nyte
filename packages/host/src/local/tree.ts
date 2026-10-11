import { watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join, sep } from "node:path";
import type { Disposer } from "@nyte-ai/schema";
import ignore from "ignore";

/** Returns one walked entry: its path relative to the walk's root (`/`-separated), its kind, and a file's or symlink's size (null for a directory). */
export type TreeEntry = {
  readonly path: string;
  readonly kind: "file" | "directory" | "symlink";
  readonly size: number | null;
};

/** Returns one frame of a walk: a page of entries, then `complete`, or `incomplete` at the entry limit or after an unreadable directory. */
export type WalkFrame =
  | { readonly kind: "entries"; readonly entries: readonly TreeEntry[] }
  | { readonly kind: "complete" }
  | { readonly kind: "incomplete"; readonly reason: "limit" | "permission" };

/** Answers whether a path under a root is ignored the way git ignores it: `.git` always, then the rules of `.git/info/exclude` and of every `.gitignore` from the root down to the path's directory, a deeper rule overriding a shallower one. */
export type Ignores = {
  /** Whether the path matches, its ancestors assumed kept (what a walk asks). */
  matches(path: string, directory: boolean): Promise<boolean>;
  /** Whether the path or any of its ancestor directories is ignored (what a watcher asks). */
  ignored(path: string, directory: boolean): Promise<boolean>;
  /** Drops a directory's cached rules, after its `.gitignore` changed. */
  forget(directory: string): void;
};

/** The entry limit of a walk: past it the walk answers `incomplete { limit }`. */
export const WALK_LIMIT = 50_000;

/** The entries in one page of a walk. */
export const WALK_PAGE = 500;

type Matcher = ReturnType<typeof ignore>;

/** Returns a root's ignore rules, each directory's read once on first use. */
export function createIgnores(root: string): Ignores {
  const rules = new Map<string, Promise<Matcher | null>>();

  const rulesOf = (directory: string): Promise<Matcher | null> => {
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
      const matcher = await rulesOf(segments.slice(0, depth).join("/"));

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

/** Walks `directory` (relative to `root`, default the root) breadth-first in name order, without following symlinks or entering `.git`, yielding pages of `page` entries: everything when `ignored` is `include`, else what `ignores` keeps. Ends with `complete`, `incomplete { limit }` once `limit` entries were yielded, or `incomplete { permission }` when a directory could not be read (the rest is still walked). A missing directory yields `complete` alone. */
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
        if (codeOf(error) === "EACCES" || codeOf(error) === "EPERM") denied = true;

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

/** Watches a tree: calls `changed` with the `/`-separated relative paths that changed (an empty path when the platform did not say which), coalesced over `delay` ms. Uses a recursive `fs.watch` where the platform has one; where it has none or it fails, polls every `poll` ms comparing each walked entry's size and modification time, or, with `poll` null, reports nothing (the caller polls on its own). The disposer stops it. */
export function watchTree(
  root: string,
  options: { readonly delay: number; readonly poll: number | null },
  changed: (paths: ReadonlySet<string>) => void,
): Disposer {
  let pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let polling: ReturnType<typeof setTimeout> | null = null;
  let watcher: FSWatcher | null = null;
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

    if (options.poll !== null && !stopped && polling === null) poll(options.poll);
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

/** Returns an error's `code` (`ENOENT`, `EACCES`, …), or null. */
export function codeOf(error: unknown): string | null {
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
