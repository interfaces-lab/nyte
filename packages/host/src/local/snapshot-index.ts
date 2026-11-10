import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { copyFile, lstat, mkdir, readdir, rm, stat } from "node:fs/promises";
import { homedir, hostname, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { SdkError } from "@nyte-ai/schema";
import { dev } from "@nyte-ai/core";
import { sha256 } from "../hash.ts";
import type { Ran } from "./command.ts";
import { readErrorCode } from "./tree.ts";

export type Repository = {
  readonly root: string;
  readonly gitDir: string;
  readonly commonDir: string;
  readonly prefix: string;
};

type Git = (
  cwd: string,
  args: readonly string[],
  extra?: { readonly env?: Readonly<Record<string, string>> },
) => Promise<Ran>;

export type SnapshotIndex = {
  readonly write: (repo: Repository) => Promise<Ran>;
  readonly writeEmpty: (repo: Repository) => Promise<Ran>;
};

type Change = "add" | "remove";

type KeptIndex = {
  readonly watched: readonly string[];
  readonly stamp: string;
  readonly touched: ReadonlyMap<string, Change>;
};

const INDEX_IDLE_MS = 5 * 60_000;

const SEED_TRIES = 3;

const HOST = sha256(hostname()).slice(0, 8);

const INDEX_NAME = /^([0-9a-f]{8})-(\d+)-[0-9a-f-]{36}(?:\.lock)?$/;

const VERBOSE_LINE = /^(add|remove) '(.*?)\/?'$/;

const RULE_FILES = new Set([".gitignore", ".gitattributes", ".gitmodules"]);

/** Returns the index `localSnapshots` writes a repository's snapshots into, kept between snapshots so `git add -A` only does work for what moved since the last one, and always the tree a fresh copy of the real index would give. `write(repo)` answers `git write-tree` (`--prefix` below the root) after `git add -A --verbose -- .` in `cwd` against the kept index `<store>/indexes/<host>-<pid>-<uuid>`, one per instance. It reuses that index only while (a) none of the files that change what `add` sees or how it hashes moved (device, inode, mode, size, mtime and ctime in nanoseconds, or appearing or vanishing) since the previous snapshot: the real index and HEAD, the repository's and the worktree's config, the global, XDG and system config and every file `git config --list --show-origin` read, `info/exclude`, `info/attributes` and `info/sparse-checkout` in the git and common directories, `core.excludesFile` and `core.attributesFile` (default the XDG `git/ignore` and `git/attributes`), and `.gitignore`, `.gitattributes` and `.gitmodules` in every directory from the root to `cwd`, nor the `GIT_*`, `HOME` and `XDG_CONFIG_HOME` variables; (b) every path its `add`s added or removed since it was seeded is spelled on disk as git spelled it, with no sibling that differs only in case or Unicode normalisation, no removed path is back, no directory on its way but the root holds a `.git`, and an added path that is now a directory still holds one (an entry only one of the kept and the real index has would otherwise meet ignore rules, case folding or a repository boundary differently); and (c) its `add` reports no `.gitignore`, `.gitattributes` or `.gitmodules` added, changed or removed, else the snapshot is taken again from a fresh seed. Any other outcome, and any failure, seeds it again: the watched files stamped, a fresh copy of the real index, its `add` output the paths to check from then on. A `write` while another is in flight, a seed that fails, and `writeEmpty` use a temporary index of their own, as before the index was kept. The index is deleted after five idle minutes, and the first seed deletes the ones this machine's dead processes left. */
export function snapshotIndex(cwd: string, store: string, git: Git): SnapshotIndex {
  const indexDirectory = resolve(store, "indexes");
  const indexPath = join(indexDirectory, `${HOST}-${process.pid}-${randomUUID()}`);
  let keptIndex: KeptIndex | null = null;
  let indexBusy = false;
  let idle: NodeJS.Timeout | undefined;
  let sweeping: Promise<void> | undefined;
  let watched: readonly string[] = [];

  const writeTree = (repo: Repository, index: string): Promise<Ran> =>
    git(
      repo.root,
      repo.prefix === "" ? ["write-tree"] : ["write-tree", `--prefix=${repo.prefix}`],
      { env: { GIT_INDEX_FILE: index } },
    );

  const addAll = (index: string): Promise<Ran> =>
    git(cwd, ["add", "-A", "--verbose", "--", "."], { env: { GIT_INDEX_FILE: index } });

  const temporaryWrite = async (repo: Repository, seeded: boolean): Promise<Ran> => {
    const index = join(tmpdir(), `nyte-index-${randomUUID()}`);

    try {
      if (seeded) await copyFile(join(repo.gitDir, "index"), index).catch(() => undefined);
      const added = await git(cwd, ["add", "-A", "--", "."], { env: { GIT_INDEX_FILE: index } });

      if (added.code !== 0) throw new SdkError("unavailable", added.stderr.trim() || "git failed");

      return await writeTree(repo, index);
    } finally {
      await rm(index, { force: true });
    }
  };

  const keptWrite = async (repo: Repository): Promise<Ran> => {
    indexBusy = true;
    clearTimeout(idle);

    try {
      const known = keptIndex;
      keptIndex = null;
      const reused = known === null ? null : await reuseIndex(repo, known).catch(() => null);

      return (
        reused ?? (await seedIndex(repo).catch(() => null)) ?? (await temporaryWrite(repo, true))
      );
    } finally {
      indexBusy = false;
      idle = setTimeout(() => void dropIndex(), INDEX_IDLE_MS);
      idle.unref();
    }
  };

  const reuseIndex = async (repo: Repository, known: KeptIndex): Promise<Ran | null> => {
    if ((await stampFiles(known.watched)) !== known.stamp) return null;

    if (!(await matchesDisk(repo.root, known.touched))) return null;
    const added = await addAll(indexPath);
    const changes = added.code === 0 ? parseVerbose(added.stdout) : null;

    if (
      changes === null ||
      [...changes.keys()].some((path) => RULE_FILES.has(basename(path).toLowerCase()))
    )
      return null;
    const written = await writeTree(repo, indexPath);

    if (written.code !== 0) return null;
    keptIndex = { ...known, touched: new Map([...known.touched, ...changes]) };

    return written;
  };

  const seedIndex = async (repo: Repository): Promise<Ran | null> => {
    sweeping ??= sweepIndexes(indexDirectory);
    await sweeping;
    const watching = await watchConfig(repo);
    await mkdir(indexDirectory, { recursive: true });
    await rm(indexPath, { force: true });
    await rm(`${indexPath}.lock`, { force: true });
    await copyFile(join(repo.gitDir, "index"), indexPath).catch(() => undefined);
    const added = await addAll(indexPath);

    if (added.code !== 0) return null;
    const changes = parseVerbose(added.stdout);
    const written = await writeTree(repo, indexPath);

    if (written.code === 0 && changes !== null && watching !== null)
      keptIndex = { watched: watching.watched, stamp: watching.stamp, touched: changes };

    return written;
  };

  const watchConfig = async (
    repo: Repository,
  ): Promise<{ readonly watched: readonly string[]; readonly stamp: string } | null> => {
    for (let tries = 0; tries < SEED_TRIES; tries += 1) {
      const stamp = await stampFiles(watched);
      const listed = await git(repo.root, ["config", "-z", "--list", "--show-origin"]);

      if (listed.code !== 0) return null;
      const next = watchedFiles(repo, cwd, listed.stdout.toString("utf8"));

      if (next.join("\0") === watched.join("\0")) return { watched, stamp };
      watched = next;
    }

    return null;
  };

  const dropIndex = async (): Promise<void> => {
    if (indexBusy) return;
    indexBusy = true;
    keptIndex = null;

    try {
      await rm(indexPath, { force: true });
      await rm(`${indexPath}.lock`, { force: true });
    } catch (error) {
      dev("snapshots", "drop failed", { error: String(error) });
    } finally {
      indexBusy = false;
    }
  };

  return {
    write: (repo) => (indexBusy ? temporaryWrite(repo, true) : keptWrite(repo)),
    writeEmpty: (repo) => temporaryWrite(repo, false),
  };
}

function watchedFiles(repo: Repository, cwd: string, listing: string): readonly string[] {
  const home = process.env.HOME ?? homedir();
  const xdg = process.env.XDG_CONFIG_HOME;
  const config = xdg === undefined || xdg === "" ? join(home, ".config") : xdg;
  const fields = listing.split("\0");

  const origins = fields.flatMap((field, index) =>
    index % 2 === 0 && field.startsWith("file:")
      ? [resolve(repo.root, field.slice("file:".length))]
      : [],
  );

  const values = fields.filter((_, index) => index % 2 === 1);

  const named = ["core.excludesfile", "core.attributesfile"].flatMap((key) => {
    const value = values.findLast((entry) => entry.startsWith(`${key}\n`))?.slice(key.length + 1);

    if (value === undefined) return [];
    const expanded = value.startsWith("~/") ? join(home, value.slice(2)) : value;

    return [resolve(repo.root, expanded), resolve(cwd, expanded)];
  });

  const segments = repo.prefix.split("/").filter((segment) => segment !== "");

  const rules = Array.from({ length: segments.length + 1 }, (_, index) =>
    join(repo.root, ...segments.slice(0, index)),
  ).flatMap((directory) => [...RULE_FILES].map((name) => join(directory, name)));

  return [
    ...new Set([
      join(repo.gitDir, "index"),
      join(repo.gitDir, "HEAD"),
      ...[repo.gitDir, repo.commonDir].flatMap((directory) =>
        [
          "config",
          "config.worktree",
          "info/exclude",
          "info/attributes",
          "info/sparse-checkout",
        ].map((name) => join(directory, name)),
      ),
      join(home, ".gitconfig"),
      join(config, "git", "config"),
      join(config, "git", "ignore"),
      join(config, "git", "attributes"),
      "/etc/gitconfig",
      ...[process.env.GIT_CONFIG_GLOBAL, process.env.GIT_CONFIG_SYSTEM].flatMap((path) =>
        path === undefined || path === "" ? [] : [resolve(repo.root, path)],
      ),
      ...origins,
      ...named,
      ...rules,
    ]),
  ].toSorted();
}

async function stampFiles(paths: readonly string[]): Promise<string> {
  const stats = await Promise.all(
    paths.map((path) =>
      stat(path, { bigint: true }).then(
        (found) =>
          `${found.dev}:${found.ino}:${found.mode}:${found.size}:${found.mtimeNs}:${found.ctimeNs}`,
        () => "-",
      ),
    ),
  );

  const variables = Object.entries(process.env)
    .filter(
      (entry) =>
        entry[0].startsWith("GIT_") || entry[0] === "HOME" || entry[0] === "XDG_CONFIG_HOME",
    )
    .map((entry) => `${entry[0]}=${entry[1] ?? ""}`)
    .toSorted();

  return JSON.stringify([stats, variables]);
}

function parseVerbose(stdout: Buffer): Map<string, Change> | null {
  const text = stdout.toString("utf8");

  if (text.includes("\uFFFD")) return null;
  const lines = text.split("\n").filter((line) => line !== "");

  const changes = lines.flatMap((line): (readonly [string, Change])[] => {
    const match = VERBOSE_LINE.exec(line);

    return match === null ? [] : [[match[2] ?? "", match[1] === "add" ? "add" : "remove"]];
  });

  return changes.length === lines.length ? new Map(changes) : null;
}

/** Whether every path the kept index added or removed since its seed is spelled on disk as git spelled it (no sibling that differs only in case or normalisation), no removed path is back, no directory on the way holds a `.git`, and an added path that is now a directory is still a repository. Otherwise the kept index's entries could steer `add -A` away from what a fresh copy of the real index gives. */
async function matchesDisk(root: string, touched: ReadonlyMap<string, Change>): Promise<boolean> {
  const checks = [...touched].flatMap((entry) => {
    const names = entry[0].split("/");

    return names.map((name, index) => ({
      path: entry[0],
      directory: names.slice(0, index).join("/"),
      name,
      change: index === names.length - 1 ? entry[1] : null,
    }));
  });

  const listings = new Map(
    await Promise.all(
      [...new Set(checks.map((check) => check.directory))].map(
        async (directory) => [directory, await listDirectory(join(root, directory))] as const,
      ),
    ),
  );

  const repositories: string[] = [];

  const clean = checks.every((check) => {
    const listing = listings.get(check.directory);

    if (listing === undefined || listing === null) return false;

    if (check.directory !== "" && listing.has(".git")) return false;
    const found = listing.get(foldName(check.name)) ?? [];

    if (found.some((entry) => entry.name !== check.name)) return false;

    if (check.change === "remove") return found.length === 0;

    if (check.change === "add" && found.some((entry) => entry.isDirectory()))
      repositories.push(check.path);

    return true;
  });

  if (!clean) return false;

  const held = await Promise.all(
    repositories.map((path) =>
      lstat(join(root, path, ".git")).then(
        () => true,
        () => false,
      ),
    ),
  );

  return held.every((found) => found);
}

async function listDirectory(path: string): Promise<Map<string, Dirent[]> | null> {
  const entries = await readdir(path, { withFileTypes: true }).catch((error) => {
    const code = readErrorCode(error);

    return code === "ENOENT" || code === "ENOTDIR" ? [] : null;
  });

  if (entries === null) return null;
  const listing = new Map<string, Dirent[]>();

  for (const entry of entries) {
    const folded = foldName(entry.name);
    listing.set(folded, [...(listing.get(folded) ?? []), entry]);
  }

  return listing;
}

function foldName(name: string): string {
  return name.normalize("NFC").toLowerCase();
}

/** Removes the kept indexes this machine's dead processes left in `directory` (named `<host>-<pid>-<uuid>`); a live process's, or another machine's on a shared home, stay. */
async function sweepIndexes(directory: string): Promise<void> {
  const names = await readdir(directory).catch(() => []);

  await Promise.all(
    names.map(async (name) => {
      const match = INDEX_NAME.exec(name);

      if (match === null || match[1] !== HOST || processAlive(Number(match[2]))) return;
      await rm(join(directory, name), { force: true });
    }),
  );
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch (error) {
    return readErrorCode(error) === "EPERM";
  }
}
