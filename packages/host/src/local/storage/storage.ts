import { lstat, readFile, readdir, stat, statfs } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import type {
  DiskSpace,
  StorageCleanup,
  StorageGroup,
  StorageItem,
  StorageScan,
} from "@nyte-ai/schema";
import type { StorageProvider, StorageWorkspace } from "@nyte-ai/core";
import { findExecutable, run } from "../process/command.ts";
import { AGENT_WORKTREE_ROOTS, PROJECT_ARTIFACTS, PROJECT_ROOTS, TOOL_CACHES } from "./rules.ts";
import type { ToolCache } from "./rules.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

const PROJECT_IDLE_MS = 7 * DAY_MS;

const NYTE_WORKTREE_IDLE_MS = DAY_MS;

const LOG_AGE_MS = 14 * DAY_MS;

const COMMAND_TIMEOUT_MS = 5 * 60_000;

const REMOVE_TIMEOUT_MS = 30 * 60_000;

const MIN_BYTES = 1024 * 1024;

const GIT_ENV = { GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" } as const;

interface Candidate {
  readonly item: Omit<StorageItem, "bytes">;
  readonly measure: readonly string[] | null;
  readonly remove: () => Promise<void>;
}

interface Repository {
  readonly root: string;
  readonly index: string;
  readonly linked: boolean;
}

interface LinkedWorktree {
  readonly main: string;
  readonly branch: string | null;
  readonly locked: boolean;
}

type Git = (cwd: string, args: readonly string[]) => Promise<string | null>;

export function localDiskCleanup(options?: {
  readonly home?: string;
  readonly git?: string;
}): StorageProvider {
  const home = options?.home ?? homedir();
  const git = gitRunner(options?.git);

  const candidates = async (
    workspaces: readonly StorageWorkspace[],
  ): Promise<readonly Candidate[]> => {
    const now = Date.now();

    const [repositories, processes, folders] = await Promise.all([
      findRepositories(git, home, workspaces),
      runningProcesses(),
      processFolders(),
    ]);

    const linked = await linkedWorktrees(git, repositories);

    const extra = await inParallel(
      [...linked.keys()].filter((root) => !repositories.some((repo) => repo.root === root)),
      8,
      (root) => readRepository(git, root),
    );

    const found = await inParallel(
      [...repositories, ...extra.filter((repo) => repo !== null)],
      6,
      (repo) =>
        repositoryCandidates(git, repo, { workspaces, linked, folders, now }).catch(() => []),
    );

    return [
      ...found.flat(),
      ...(await toolCaches(home, processes)).flat(),
      ...(await nyteLogs(home, now)),
    ];
  };

  return {
    async scan(workspaces) {
      const found = await candidates(workspaces);

      const items = await inParallel(found, 4, async (candidate) => ({
        ...candidate.item,
        bytes:
          candidate.measure === null
            ? null
            : await diskUsage(await freeablePaths(candidate.measure)),
      }));

      return {
        disk: await diskSpace(home),
        items: items
          .filter((item) => item.bytes === null || item.bytes >= MIN_BYTES)
          .toSorted((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0)),
      } satisfies StorageScan;
    },
    async clean(workspaces, ids) {
      const found = await candidates(workspaces);
      const wanted = new Set(ids);

      const ready = found.filter(
        (candidate) => wanted.has(candidate.item.id) && candidate.item.blocked === null,
      );

      const removed = await inParallel(ready, 2, (candidate) =>
        candidate.remove().then(
          () => ({ id: candidate.item.id, reason: null }),
          (error: unknown) => ({
            id: candidate.item.id,
            reason: error instanceof Error ? error.message : String(error),
          }),
        ),
      );

      const refused = ids.flatMap((id) => {
        if (ready.some((candidate) => candidate.item.id === id)) return [];
        const blocked = found.find((candidate) => candidate.item.id === id)?.item.blocked;

        return [{ id, reason: blocked ?? "It changed since the scan, so it was left alone." }];
      });

      return {
        cleaned: removed.flatMap((outcome) => (outcome.reason === null ? [outcome.id] : [])),
        failed: [
          ...removed.flatMap((outcome) =>
            outcome.reason === null ? [] : [{ id: outcome.id, reason: outcome.reason }],
          ),
          ...refused,
        ],
        disk: await diskSpace(home),
      } satisfies StorageCleanup;
    },
  };
}

async function repositoryCandidates(
  git: Git,
  repo: Repository,
  context: {
    readonly workspaces: readonly StorageWorkspace[];
    readonly linked: ReadonlyMap<string, LinkedWorktree>;
    readonly folders: readonly string[] | null;
    readonly now: number;
  },
): Promise<readonly Candidate[]> {
  const on = context.workspaces.filter((workspace) => {
    const path = workspacePath(workspace);

    return path !== null && within(resolve(path), repo.root);
  });

  const blocked = on.some((workspace) => workspace.running)
    ? "A chat is running in it"
    : context.folders?.some((folder) => within(folder, repo.root)) === true
      ? "A terminal or process is open in it"
      : null;

  const indexed =
    (
      await stat(repo.index)
        .catch(() => stat(repo.root))
        .catch(() => null)
    )?.mtimeMs ?? context.now;

  const idle = context.now - Math.max(indexed, ...on.map((workspace) => workspace.usedAt));
  const nyte = on.some((workspace) => workspace.worktree);
  const link = context.linked.get(repo.root);
  const name = basename(repo.root);

  if (
    link !== undefined &&
    on.length === 0 &&
    !link.locked &&
    idle >= PROJECT_IDLE_MS &&
    (await finished(git, repo, link))
  ) {
    return [
      {
        item: {
          id: `worktrees:remove:${repo.root}`,
          group: "worktrees",
          title: name,
          detail: `${link.branch === null ? "Its commits are on a branch" : `Keeps branch ${link.branch}`} · idle ${age(idle)}`,
          path: repo.root,
          blocked,
        },
        measure: [repo.root],
        remove: async () => {
          if ((await git(link.main, ["worktree", "remove", repo.root])) === null) {
            throw new Error(`git couldn't remove the worktree at ${repo.root}.`);
          }
        },
      },
    ];
  }

  if (idle < (nyte ? NYTE_WORKTREE_IDLE_MS : PROJECT_IDLE_MS)) return [];
  const artifacts = await ignoredArtifacts(git, repo.root);

  if (artifacts.length === 0) return [];
  const group: StorageGroup = nyte || link !== undefined ? "worktrees" : "projects";

  return [
    {
      item: {
        id: `${group}:build:${repo.root}`,
        group,
        title: name,
        detail: `${summarize(artifacts)} · idle ${age(idle)}`,
        path: repo.root,
        blocked,
      },
      measure: artifacts,
      remove: async () => {
        await removeAll(artifacts);
      },
    },
  ];
}

async function ignoredArtifacts(git: Git, root: string): Promise<readonly string[]> {
  const status = await git(root, [
    "status",
    "--porcelain=v1",
    "--ignored=traditional",
    "--untracked-files=normal",
    "-z",
  ]);

  if (status === null) return [];

  const folders = status
    .split("\0")
    .filter((entry) => entry.startsWith("!! ") && entry.endsWith("/"))
    .map((entry) => join(root, entry.slice(3, -1)))
    .filter((path) => PROJECT_ARTIFACTS.has(basename(path)));

  const safe = await inParallel(folders, 4, async (path) =>
    (await rebuildable(path)) ? [path] : [],
  );

  return safe.flat();
}

async function rebuildable(path: string): Promise<boolean> {
  const info = await lstat(path).catch(() => null);

  if (info === null || !info.isDirectory()) return false;
  const name = basename(path);

  if (name === "target" && !(await anyExists([dirname(path)], ["Cargo.toml", "pom.xml"]))) {
    return false;
  }

  if ((name === "venv" || name === ".venv") && !(await anyExists([path], ["pyvenv.cfg"]))) {
    return false;
  }

  if (name === ".build" && !(await anyExists([dirname(path)], ["Package.swift"]))) return false;

  const found = await run(
    "find",
    [
      path,
      "-maxdepth",
      "4",
      "(",
      "-name",
      ".git",
      "-o",
      "-name",
      "*-keypair.json",
      ")",
      "-print",
      "-quit",
    ],
    { cwd: path, timeoutMs: 30_000 },
  ).catch(() => null);

  return found !== null && found.code === 0 && found.stdout.byteLength === 0;
}

async function finished(git: Git, repo: Repository, link: LinkedWorktree): Promise<boolean> {
  const status = await git(repo.root, [
    "status",
    "--porcelain=v1",
    "--ignored=traditional",
    "--untracked-files=normal",
    "-z",
  ]);

  if (status === null) return false;

  const pending = status
    .split("\0")
    .filter((entry) => entry !== "")
    .some(
      (entry) =>
        !entry.startsWith("!! ") ||
        !(
          basename(entry.slice(3).replace(/\/$/u, "")) === ".DS_Store" ||
          (entry.endsWith("/") && PROJECT_ARTIFACTS.has(basename(entry.slice(3, -1))))
        ),
    );

  if (pending) return false;
  const flagged = await git(repo.root, ["ls-files", "-v", "-z"]);

  if (
    flagged === null ||
    flagged.split("\0").some((entry) => entry.startsWith("S ") || /^[a-z] /u.test(entry))
  ) {
    return false;
  }

  if (link.branch !== null) return true;

  const holders = await git(repo.root, [
    "for-each-ref",
    "--contains",
    "HEAD",
    "--format=%(refname)",
    "refs/heads",
    "refs/remotes",
  ]);

  return holders !== null && holders.trim() !== "";
}

async function findRepositories(
  git: Git,
  home: string,
  workspaces: readonly StorageWorkspace[],
): Promise<readonly Repository[]> {
  const registered = workspaces.flatMap((workspace) => {
    const path = workspacePath(workspace);

    return path === null ? [] : [path];
  });

  const searched = await Promise.all([
    ...PROJECT_ROOTS.map((folder) => searchRepositories(join(home, folder), 3)),
    ...AGENT_WORKTREE_ROOTS.map((folder) => searchRepositories(join(home, folder), 2)),
  ]);

  const read = await inParallel([...new Set([...registered, ...searched.flat()])], 8, (path) =>
    readRepository(git, path),
  );

  return [
    ...new Map(
      read.filter((repo) => repo !== null).map((repo) => [repo.root, repo] as const),
    ).values(),
  ];
}

async function searchRepositories(folder: string, depth: number): Promise<readonly string[]> {
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);

  if (entries.some((entry) => entry.name === ".git")) return [folder];

  if (depth === 0) return [];

  const children = entries.filter(
    (entry) =>
      entry.isDirectory() &&
      !entry.name.startsWith(".") &&
      entry.name !== "node_modules" &&
      entry.name !== "Library",
  );

  const found = await Promise.all(
    children.map((entry) => searchRepositories(join(folder, entry.name), depth - 1)),
  );

  return found.flat();
}

async function readRepository(git: Git, path: string): Promise<Repository | null> {
  const out = await git(path, [
    "rev-parse",
    "--path-format=absolute",
    "--show-toplevel",
    "--git-path",
    "index",
  ]);

  const lines = out?.split("\n") ?? [];
  const root = lines[0];
  const index = lines[1];

  if (root === undefined || index === undefined || root === "") return null;
  const marker = await lstat(join(root, ".git")).catch(() => null);

  return marker === null ? null : { root: resolve(root), index, linked: marker.isFile() };
}

async function linkedWorktrees(
  git: Git,
  repositories: readonly Repository[],
): Promise<ReadonlyMap<string, LinkedWorktree>> {
  const lists = await inParallel(
    repositories.filter((repo) => !repo.linked),
    6,
    async (repo) => {
      const out = await git(repo.root, ["worktree", "list", "--porcelain", "-z"]);

      return (out ?? "")
        .split("\0\0")
        .slice(1)
        .flatMap((record) => {
          const fields = record.split("\0");
          const path = fields.find((field) => field.startsWith("worktree "))?.slice(9);
          const branch = fields.find((field) => field.startsWith("branch refs/heads/"))?.slice(18);

          if (path === undefined || fields.some((field) => field.startsWith("prunable"))) return [];

          return [
            [
              resolve(path),
              {
                main: repo.root,
                branch: branch ?? null,
                locked: fields.some((field) => field.startsWith("locked")),
              },
            ] as const,
          ];
        });
    },
  );

  return new Map(lists.flat());
}

async function toolCaches(
  home: string,
  processes: ReadonlySet<string> | null,
): Promise<readonly (readonly Candidate[])[]> {
  return Promise.all(
    TOOL_CACHES.map(async (cache): Promise<readonly Candidate[]> => {
      const running = cache.busy.find((name) => processes?.has(name) === true);

      const blocked =
        processes === null && cache.busy.length > 0
          ? "Couldn't check which apps are running"
          : running === undefined
            ? null
            : `${running} is running`;

      return cache.kind === "folders"
        ? cacheFolders(home, cache, blocked)
        : cacheCommand(home, cache, blocked);
    }),
  );
}

async function cacheFolders(
  home: string,
  cache: Extract<ToolCache, { readonly kind: "folders" }>,
  blocked: string | null,
): Promise<readonly Candidate[]> {
  const found = await Promise.all(
    cache.folders.map(async (folder) => {
      const path = join(home, folder);
      const info = await lstat(path).catch(() => null);

      return info !== null && info.isDirectory() ? [path] : [];
    }),
  );

  const folders = found.flat();

  if (folders.length === 0) return [];

  return [
    {
      item: {
        id: `caches:${cache.id}`,
        group: "caches",
        title: cache.title,
        detail: "",
        path: folders.length === 1 ? (folders[0] ?? null) : null,
        blocked,
      },
      measure: folders,
      remove: async () => {
        await removeAll(folders);
      },
    },
  ];
}

async function cacheCommand(
  home: string,
  cache: Extract<ToolCache, { readonly kind: "command" }>,
  blocked: string | null,
): Promise<readonly Candidate[]> {
  const file = await findExecutable(cache.file);

  if (file === null) return [];

  if (cache.probe !== undefined) {
    const probed = await run(file, cache.probe.args, { cwd: home, timeoutMs: 30_000 }).catch(
      () => null,
    );

    if (
      probed === null ||
      probed.code !== 0 ||
      !cache.probe.finds(probed.stdout.toString("utf8"))
    ) {
      return [];
    }
  }

  return [
    {
      item: {
        id: `caches:${cache.id}`,
        group: "caches",
        title: cache.title,
        detail: "",
        path: null,
        blocked,
      },
      measure: null,
      remove: async () => {
        const ran = await run(file, cache.args, { cwd: home, timeoutMs: COMMAND_TIMEOUT_MS });

        if (ran.code !== 0) {
          throw new Error(ran.stderr.trim() || `${cache.file} ${cache.args.join(" ")} failed.`);
        }
      },
    },
  ];
}

async function nyteLogs(home: string, now: number): Promise<readonly Candidate[]> {
  const folder = join(home, ".nyte", "logs");
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);

  const old = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const path = join(folder, entry.name);
        const info = await stat(path).catch(() => null);

        return info !== null && now - info.mtimeMs >= LOG_AGE_MS ? [path] : [];
      }),
  );

  const files = old.flat();

  if (files.length === 0) return [];

  return [
    {
      item: {
        id: "nyte:logs",
        group: "nyte",
        title: "Old Nyte logs",
        detail: "",
        path: folder,
        blocked: null,
      },
      measure: files,
      remove: async () => {
        await removeAll(files);
      },
    },
  ];
}

async function removeAll(paths: readonly string[]): Promise<void> {
  const ran = await run("rm", ["-rf", "--", ...paths], { cwd: "/", timeoutMs: REMOVE_TIMEOUT_MS });

  if (ran.code !== 0) {
    throw new Error(ran.stderr.trim() || `Couldn't remove ${paths.join(", ")}.`);
  }
}

async function diskUsage(paths: readonly string[]): Promise<number> {
  const batches = Array.from({ length: Math.ceil(paths.length / 64) }, (_, index) =>
    paths.slice(index * 64, index * 64 + 64),
  );

  const sizes = await Promise.all(
    batches.map(async (batch) => {
      const ran = await run("du", ["-sk", ...batch], { cwd: "/", timeoutMs: 120_000 }).catch(
        () => null,
      );

      return (ran?.stdout.toString("utf8") ?? "")
        .split("\n")
        .reduce((sum, line) => sum + (Number.parseInt(line, 10) || 0), 0);
    }),
  );

  return sizes.reduce((sum, size) => sum + size, 0) * 1024;
}

async function diskSpace(home: string): Promise<DiskSpace | null> {
  const info = await statfs(home).catch(() => null);

  return info === null ? null : { size: info.blocks * info.bsize, free: info.bavail * info.bsize };
}

async function freeablePaths(paths: readonly string[]): Promise<readonly string[]> {
  const expanded = await Promise.all(
    paths.map(async (path): Promise<readonly string[]> => {
      if (basename(path) === "node_modules") return withoutSharedStore(path);
      const inside = join(path, "node_modules");

      if ((await sharedPnpmStore(inside)) === null) return [path];
      const entries = await readdir(path).catch(() => []);

      const children = await Promise.all(
        entries.map(async (name) =>
          name === "node_modules" ? withoutSharedStore(inside) : [join(path, name)],
        ),
      );

      return children.flat();
    }),
  );

  return expanded.flat();
}

async function withoutSharedStore(nodeModules: string): Promise<readonly string[]> {
  const shared = await sharedPnpmStore(nodeModules);

  if (shared === null) return [nodeModules];
  const entries = await readdir(nodeModules).catch(() => []);

  return entries.map((name) => join(nodeModules, name)).filter((path) => path !== shared);
}

async function sharedPnpmStore(nodeModules: string): Promise<string | null> {
  const manifest = await readFile(join(nodeModules, ".modules.yaml"), "utf8").catch(() => null);

  if (manifest === null) return null;
  const store = manifestValue(manifest, "storeDir");

  if (store === null) return null;
  const virtual = resolve(nodeModules, manifestValue(manifest, "virtualStoreDir") ?? ".pnpm");

  const [storeInfo, virtualInfo] = await Promise.all([
    stat(store).catch(() => null),
    stat(virtual).catch(() => null),
  ]);

  return storeInfo !== null && virtualInfo !== null && storeInfo.dev === virtualInfo.dev
    ? virtual
    : null;
}

function manifestValue(manifest: string, key: string): string | null {
  const found = new RegExp(`^\\s*"?${key}"?\\s*:\\s*"?([^"\\n]+?)"?\\s*,?\\s*$`, "mu").exec(
    manifest,
  );

  return found?.[1] ?? null;
}

async function processFolders(): Promise<readonly string[] | null> {
  const ran = await run(
    "lsof",
    ["-a", "-u", String(process.getuid?.() ?? ""), "-d", "cwd", "-R", "-F", "pRn"],
    { cwd: "/", timeoutMs: 15_000 },
  ).catch(() => null);

  if (ran === null || ran.stdout.byteLength === 0) return null;
  const own = String(process.pid);

  const records = ran.stdout.toString("utf8").split(/\n(?=p)/u);

  return records.flatMap((record) => {
    const lines = record.split("\n");
    const pid = lines.find((line) => line.startsWith("p"))?.slice(1);
    const parent = lines.find((line) => line.startsWith("R"))?.slice(1);
    const folder = lines.find((line) => line.startsWith("n/"))?.slice(1);

    return folder === undefined || pid === own || parent === own ? [] : [resolve(folder)];
  });
}

async function runningProcesses(): Promise<ReadonlySet<string> | null> {
  const ran = await run("ps", ["-A", "-o", "comm="], { cwd: "/", timeoutMs: 10_000 }).catch(
    () => null,
  );

  if (ran === null || ran.code !== 0) return null;

  return new Set(
    ran.stdout
      .toString("utf8")
      .split("\n")
      .map((line) => basename(line.trim()))
      .filter((name) => name !== ""),
  );
}

function gitRunner(binary = "git"): Git {
  return async (cwd, args) => {
    const ran = await run(binary, ["-c", "core.quotepath=off", ...args], {
      cwd,
      env: GIT_ENV,
      timeoutMs: 60_000,
    }).catch(() => null);

    return ran === null || ran.code !== 0 ? null : ran.stdout.toString("utf8");
  };
}

async function anyExists(folders: readonly string[], names: readonly string[]): Promise<boolean> {
  const found = await Promise.all(
    folders.flatMap((folder) =>
      names.map((name) =>
        lstat(join(folder, name)).then(
          () => true,
          () => false,
        ),
      ),
    ),
  );

  return found.includes(true);
}

function workspacePath(workspace: StorageWorkspace): string | null {
  return workspace.target.kind === "local" && "path" in workspace.target
    ? workspace.target.path
    : null;
}

function within(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`);
}

function summarize(paths: readonly string[]): string {
  const counts = paths.reduce(
    (tally, path) => tally.set(basename(path), (tally.get(basename(path)) ?? 0) + 1),
    new Map<string, number>(),
  );

  return [...counts]
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map((entry) => (entry[1] === 1 ? entry[0] : `${entry[0]} ×${String(entry[1])}`))
    .join(", ");
}

function age(ms: number): string {
  const days = Math.max(1, Math.floor(ms / DAY_MS));

  if (days < 14) return days === 1 ? "a day" : `${String(days)} days`;

  if (days < 60) return `${String(Math.floor(days / 7))} weeks`;

  return days < 730
    ? `${String(Math.floor(days / 30))} months`
    : `${String(Math.floor(days / 365))} years`;
}

async function inParallel<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const queue = items.map((item, index) => ({ item, index }));
  const results: R[] = [];

  const worker = async (): Promise<void> => {
    const next = queue.shift();

    if (next === undefined) return;
    results[next.index] = await work(next.item);

    return worker();
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));

  return results;
}
