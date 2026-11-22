import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, readlink, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, posix, resolve } from "node:path";
import { asId, SdkError } from "@nyte-ai/schema";
import type { ChangeSet, DiffOptions, LineStat, PatchEntry, SnapshotId } from "@nyte-ai/schema";
import { dev } from "@nyte-ai/core";
import type { SnapshotScope, SnapshotsApi } from "@nyte-ai/core";
import { sha256 } from "../../hash.ts";
import { run } from "../process/command.ts";
import type { Ran } from "../process/command.ts";
import {
  PATCH_LIMIT,
  lineStat,
  parseNameStatus,
  parseNumstat,
  readPatches,
  textEntry,
} from "../git/patch.ts";
import type { Changed } from "../git/patch.ts";
import { snapshotIndex } from "./snapshot-index.ts";
import type { Repository } from "./snapshot-index.ts";
import { decodeText } from "../text.ts";
import { walkTree } from "../files/tree.ts";
import { readErrorCode } from "../../fs-errors.ts";
import { openJournal } from "./journal.ts";
import type { Change } from "./journal.ts";

type Manifest = Readonly<Record<string, string>>;

type Tree = { readonly files: Manifest; readonly incomplete: boolean };

type Seen = { readonly stamp: string; readonly hash: string };

type Discovery =
  | { readonly kind: "unwalked" }
  | { readonly kind: "walked"; readonly files: ReadonlySet<string> }
  | { readonly kind: "over-limit" };

type FileEntry = {
  readonly path: string;
  readonly kind: "file" | "symlink";
  readonly size: number;
  readonly mtimeMs: number;
  readonly ino: number;
};

type Kept = {
  readonly id: string;
  readonly root: readonly { readonly tree: string; readonly name: string }[];
  readonly last: {
    readonly name: string;
    readonly number: number;
    readonly trees: readonly string[];
  } | null;
};

const GENERATION_NAME = /^g(\d{6})$/;

const NOTHING_KEPT: Kept = { id: "", root: [], last: null };

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

const KEPT_REF = "refs/nyte/kept";

const LEGACY_REFS = "refs/nyte/snapshots/";

const GENERATION = 1_000;

const KEPT_GENERATIONS = 10;

const KEEP_TRIES = 3;

const STORE_CONCURRENCY = 32;

const CHUNK = 64 * 1024;

const JOURNAL = "journal:";

const DISCOVERY_LIMIT = 5_000;

export function localSnapshots(
  root: string,
  options: { readonly store: string; readonly git?: string; readonly limit?: number },
): SnapshotsApi {
  const binary = options.git ?? "git";
  const journal = openJournal(join(options.store, "journals", `${sha256(root)}.ndjson`));
  const known = new Map<string, Seen | null>();
  let discovery: Discovery = { kind: "unwalked" };
  let observing: Promise<unknown> = Promise.resolve();
  const fresh: string[] = [];
  let repositoryLookup: Promise<Repository | null> | undefined;
  let emptyTree: Promise<string> | undefined;
  let keeping: Promise<void> | undefined;
  let kept: Kept | null = null;
  const keptTrees = new Set<string>();

  const git = (
    cwd: string,
    args: readonly string[],
    extra?: {
      readonly env?: Readonly<Record<string, string>>;
      readonly input?: string;
      readonly limit?: number;
    },
  ): Promise<Ran> =>
    run(binary, [...CONFIG, ...args], {
      cwd,
      env: { ...ENV, ...extra?.env },
      input: extra?.input,
      limit: extra?.limit,
    });

  const findRepository = async (): Promise<Repository | null> => {
    const ran = await git(root, [
      "rev-parse",
      "--show-toplevel",
      "--absolute-git-dir",
      "--git-common-dir",
      "--show-prefix",
    ]).catch(() => null);

    if (ran === null || ran.code !== 0) return null;
    const [top, gitDir, commonDir, prefix = ""] = ran.stdout.toString("utf8").split("\n");

    return top === undefined || gitDir === undefined || commonDir === undefined
      ? null
      : {
          root: resolve(top),
          gitDir: resolve(gitDir),
          commonDir: resolve(root, commonDir),
          prefix,
        };
  };

  const repository = (): Promise<Repository | null> => {
    repositoryLookup ??= journal
      .started()
      .then((journaled) => (journaled ? null : findRepository()));

    return repositoryLookup;
  };

  const index = snapshotIndex(root, options.store, git);

  const checked = async (ran: Ran): Promise<string> => {
    if (ran.code !== 0) throw new SdkError("unavailable", ran.stderr.trim() || "git failed");

    return ran.stdout.toString("utf8").trim();
  };

  const gitSnapshot = async (repo: Repository): Promise<SnapshotId> => {
    const first = await index.write(repo);
    const tree = await checked(first.code === 0 ? first : await index.writeEmpty(repo));
    const id = asId<"snapshot">(`git:${tree}`);

    if (!fresh.includes(tree) && !keptTrees.has(tree)) fresh.push(tree);

    if (fresh.length > 0) keeping ??= keepTrees(repo);

    return id;
  };

  const keepTrees = async (repo: Repository): Promise<void> => {
    let failures = 0;

    while (fresh.length > 0 && failures < KEEP_TRIES) {
      const taken = fresh.splice(0);
      let landed = false;

      try {
        landed = await rewriteKept(repo, taken);
      } catch (error) {
        dev("snapshots", "keep failed", { error: String(error) });
      }

      if (!landed) {
        fresh.unshift(...taken);
        failures += 1;
      }
    }

    keeping = undefined;
  };

  const rewriteKept = async (repo: Repository, taken: readonly string[]): Promise<boolean> => {
    const listed = await checked(
      await git(repo.root, ["for-each-ref", "--format=%(objectname) %(refname)", "refs/nyte/"]),
    );

    const refs = listed
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => {
        const [id = "", name = ""] = line.split(" ");

        return { id, name };
      });

    const current = refs.find((ref) => ref.name === KEPT_REF)?.id ?? null;
    const legacy = refs.filter((ref) => ref.name.startsWith(LEGACY_REFS));
    const known = current === null ? NOTHING_KEPT : await readKept(repo, current);

    const open = known.last !== null && known.last.trees.length < GENERATION ? known.last : null;

    const openTrees = open?.trees ?? [];

    const adding = [...new Set([...legacy.map((ref) => ref.id), ...taken])].filter(
      (tree) => !keptTrees.has(tree) && !openTrees.includes(tree),
    );

    if (adding.length === 0 && legacy.length === 0) return true;
    const filled = [...openTrees, ...adding];
    const first = open?.number ?? (known.last === null ? 0 : known.last.number + 1);

    const generations = await Promise.all(
      Array.from({ length: Math.ceil(filled.length / GENERATION) }, async (_, index) => {
        const trees = filled.slice(index * GENERATION, (index + 1) * GENERATION);

        return {
          number: first + index,
          trees,
          tree: await mktree(
            repo,
            trees.map((tree) => ({ tree, name: tree })),
          ),
        };
      }),
    );

    const grown = [
      ...known.root.filter((entry) => entry.name !== open?.name),
      ...generations.map((generation) => ({
        tree: generation.tree,
        name: generationName(generation.number),
      })),
    ];

    const root = grown.slice(-KEPT_GENERATIONS);

    const next = await mktree(repo, root);

    const commands = [
      current === null ? `create ${KEPT_REF} ${next}` : `update ${KEPT_REF} ${next} ${current}`,
      ...legacy.map((ref) => `delete ${ref.name} ${ref.id}`),
    ];

    const updated = await git(repo.root, ["update-ref", "--stdin"], {
      input: `${commands.join("\n")}\n`,
    });

    if (updated.code !== 0) {
      kept = null;

      return false;
    }

    const newest = generations.at(-1);

    kept = {
      id: next,
      root,
      last:
        newest === undefined
          ? known.last
          : {
              name: generationName(newest.number),
              number: newest.number,
              trees: newest.trees,
            },
    };

    if (root.length < grown.length) keptTrees.clear();

    for (const tree of filled) keptTrees.add(tree);

    return true;
  };

  const mktree = async (
    repo: Repository,
    entries: readonly { readonly tree: string; readonly name: string }[],
  ): Promise<string> =>
    checked(
      await git(repo.root, ["mktree"], {
        input: entries.map((entry) => `040000 tree ${entry.tree}\t${entry.name}\n`).join(""),
      }),
    );

  const readTree = async (
    repo: Repository,
    id: string,
  ): Promise<readonly { readonly tree: string; readonly name: string }[]> => {
    const listed = await checked(await git(repo.root, ["ls-tree", id]));

    return listed.split("\n").flatMap((line) => {
      const [mode = "", type = "", rest = ""] = line.split(" ");
      const [tree = "", name = ""] = rest.split("\t");

      return mode === "040000" && type === "tree" ? [{ tree, name }] : [];
    });
  };

  const readKept = async (repo: Repository, id: string): Promise<Kept> => {
    if (kept?.id === id) return kept;
    keptTrees.clear();
    const root = await readTree(repo, id);

    const last = root
      .flatMap((entry) => {
        const number = GENERATION_NAME.exec(entry.name)?.[1];

        return number === undefined ? [] : [{ ...entry, number: Number(number) }];
      })
      .toSorted((left, right) => left.number - right.number)
      .at(-1);

    if (last === undefined) return { id, root, last: null };
    const trees = (await readTree(repo, last.tree)).map((entry) => entry.tree);

    for (const tree of trees) keptTrees.add(tree);

    return { id, root, last: { name: last.name, number: last.number, trees } };
  };

  const note = (path: string, seen: Seen | null, prior: Seen | null | undefined): Change[] => {
    known.set(path, seen);
    const now = seen?.hash ?? null;
    const was = prior === undefined ? now : (prior?.hash ?? null);

    return was === now ? [] : [[path, was, now]];
  };

  const discover = async (): Promise<readonly Change[]> => {
    if (discovery.kind === "over-limit") return [];
    const files: FileEntry[] = [];

    for await (const frame of walkTree(root, {
      ignored: "exclude",
      limit: options.limit ?? DISCOVERY_LIMIT,
    })) {
      if (frame.kind === "incomplete") {
        discovery = { kind: "over-limit" };

        return [];
      }

      if (frame.kind === "entries")
        files.push(
          ...frame.entries.flatMap((entry) => (entry.kind === "directory" ? [] : [entry])),
        );
    }

    const previous = discovery.kind === "walked" ? discovery.files : null;
    const changes: Change[] = [];

    for (let start = 0; start < files.length; start += STORE_CONCURRENCY)
      await Promise.all(
        files.slice(start, start + STORE_CONCURRENCY).map(async (entry) => {
          const prior = known.has(entry.path)
            ? known.get(entry.path)
            : previous === null
              ? undefined
              : null;

          const seen = await storeEntry(options.store, root, entry, prior).catch(() => null);

          if (seen !== null) changes.push(...note(entry.path, seen, prior));
        }),
      );

    const present = new Set(files.map((entry) => entry.path));
    discovery = { kind: "walked", files: present };

    return [
      ...changes,
      ...[...(previous ?? [])]
        .filter((path) => !present.has(path))
        .flatMap((path) => note(path, null, known.get(path))),
    ];
  };

  const observePaths = async (paths: readonly string[]): Promise<readonly Change[]> => {
    const inside = [...new Set(paths.flatMap((path) => insidePath(path)))];

    const observed = await Promise.all(
      inside.map(async (path): Promise<readonly Change[]> => {
        const entry = await readEntry(root, path);
        const prior = known.get(path);

        if (entry === null) return note(path, null, prior);
        const seen = await storeEntry(options.store, root, entry, prior).catch(() => null);

        return seen === null ? [] : note(path, seen, prior);
      }),
    );

    return observed.flat();
  };

  const observe = async (scope: SnapshotScope): Promise<SnapshotId> => {
    const changes = scope.kind === "workspace" ? await discover() : await observePaths(scope.paths);
    const id = changes.length === 0 ? await journal.head() : await journal.append(changes);

    return asId<"snapshot">(`${JOURNAL}${id}`);
  };

  const capture = async (scope: SnapshotScope): Promise<SnapshotId> => {
    const started = Date.now();
    const repo = await repository();

    if (repo !== null) {
      const id = await gitSnapshot(repo);
      dev("snapshots", "capture", { kind: "git", ms: Date.now() - started });

      return id;
    }

    const next = observing.then(() => observe(scope));
    observing = next.catch(() => undefined);
    const id = await next;

    dev("snapshots", "capture", {
      kind: "journal",
      scope: scope.kind === "workspace" ? scope.kind : scope.paths.length,
      discovery: discovery.kind,
      ms: Date.now() - started,
    });

    return id;
  };

  const pair = async (
    from: SnapshotId,
    to: SnapshotId,
  ): Promise<
    | {
        readonly kind: "git";
        readonly repo: Repository;
        readonly from: string;
        readonly to: string;
      }
    | { readonly kind: "tree"; readonly from: Tree; readonly to: Tree }
  > => {
    if (to.startsWith(JOURNAL)) {
      const range = await journal.range(
        from.startsWith(JOURNAL) ? from.slice(JOURNAL.length) : null,
        to.slice(JOURNAL.length),
      );

      return {
        kind: "tree",
        from: { files: range.before, incomplete: false },
        to: { files: range.after, incomplete: false },
      };
    }

    const kinds = new Set([from, to].flatMap((id) => (id === "" ? [] : id.split(":", 1))));

    if (kinds.size > 1)
      throw new SdkError("invalid", `Snapshots ${from} and ${to} are of two kinds.`);

    if (kinds.has("tree") || kinds.size === 0)
      return {
        kind: "tree",
        from: await readWalkedTree(options.store, from),
        to: await readWalkedTree(options.store, to),
      };
    const repo = await repository();

    if (repo === null)
      throw new SdkError("unavailable", `${root} is no longer in a git repository.`);

    const empty =
      from === "" || to === ""
        ? await (emptyTree ??= git(repo.root, ["hash-object", "-t", "tree", "--stdin"], {
            input: "",
          }).then(checked))
        : "";

    const tree = (id: SnapshotId): string => (id === "" ? empty : id.slice("git:".length));

    return { kind: "git", repo, from: tree(from), to: tree(to) };
  };

  const changed = async (
    from: SnapshotId,
    to: SnapshotId,
  ): Promise<readonly (Changed & { readonly stat: LineStat })[]> => {
    if (from === to) return [];
    const compared = await pair(from, to);

    if (compared.kind === "git") {
      const [names, numstat] = await Promise.all([
        git(compared.repo.root, [
          "diff-tree",
          "-r",
          "-z",
          "-M",
          "--name-status",
          compared.from,
          compared.to,
        ]),
        git(compared.repo.root, [
          "diff-tree",
          "-r",
          "-z",
          "-M",
          "--numstat",
          compared.from,
          compared.to,
        ]),
      ]);

      const stats = parseNumstat(await checked(numstat));

      return parseNameStatus(await checked(names)).map((file) => ({
        ...file,
        stat: stats.get(file.path) ?? { kind: "unknown" },
      }));
    }

    const { files, incomplete } = compareTrees(compared.from, compared.to);

    return Promise.all(
      files.map(async (file) => ({
        ...file,
        stat: incomplete.has(file.path)
          ? { kind: "unknown" as const }
          : await manifestStat(options.store, compared.from.files, compared.to.files, file),
      })),
    );
  };

  return {
    capture,
    async diff(from, to): Promise<ChangeSet> {
      const started = Date.now();
      const files = await changed(from, to);
      dev("snapshots", "diff", { entries: files.length, ms: Date.now() - started });

      return { revision: to, files };
    },
    async patches(from, to, paths, diff?: DiffOptions) {
      const compared = await pair(from, to);
      const reported = new Map((await changed(from, to)).map((file) => [file.path, file]));

      const wanted = [...new Set(paths)].flatMap((path) => {
        const file = reported.get(path);

        return file === undefined ? [] : [file];
      });

      if (wanted.length === 0) return [];

      if (compared.kind === "tree") {
        const { incomplete } = compareTrees(compared.from, compared.to);

        return Promise.all(
          wanted.map(async (file): Promise<PatchEntry> =>
            incomplete.has(file.path)
              ? {
                  path: file.path,
                  status: file.status,
                  digest: "",
                  kind: "failed",
                  reason: "incomplete",
                }
              : manifestEntry(options.store, compared.from.files, compared.to.files, file, diff),
          ),
        );
      }

      return readPatches(
        wanted,
        (files, limit) =>
          git(
            compared.repo.root,
            [
              "diff",
              ...DIFF,
              "-U3",
              ...(diff?.ignoreWhitespace === true ? ["--ignore-all-space"] : []),
              compared.from,
              compared.to,
              "--",
              ...files.flatMap((file) =>
                file.from === undefined ? [file.path] : [file.from, file.path],
              ),
            ],
            { limit },
          ),
        (file) => sha256(`${to}\u0000${file.path}`),
      );
    },
  };
}

function insidePath(path: string): readonly string[] {
  const normalized = posix.normalize(path.replaceAll("\\", "/")).replace(/\/+$/, "");

  return isAbsolute(normalized) ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../")
    ? []
    : [normalized];
}

async function readEntry(root: string, path: string): Promise<FileEntry | null> {
  const stats = await lstat(join(root, path)).catch((error: unknown) => {
    const code = readErrorCode(error);

    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  });

  if (stats === null || (!stats.isFile() && !stats.isSymbolicLink())) return null;

  return {
    path,
    kind: stats.isSymbolicLink() ? "symlink" : "file",
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    ino: stats.ino,
  };
}

async function storeEntry(
  store: string,
  root: string,
  entry: FileEntry,
  prior: Seen | null | undefined,
): Promise<Seen> {
  const path = join(root, entry.path);
  const stamp = `${entry.kind}:${entry.size}:${entry.mtimeMs}:${entry.ino}`;

  if (prior?.stamp === stamp) return prior;

  if (entry.kind === "symlink") {
    const target = new TextEncoder().encode(await readlink(path));
    const hash = sha256(target);
    await keep(join(store, "objects", hash), target);

    return { stamp, hash };
  }

  if (entry.size > PATCH_LIMIT) return { stamp, hash: await hashFile(path) };

  const bytes = await readFile(path);
  const hash = sha256(bytes);
  await keep(join(store, "objects", hash), bytes);

  return { stamp, hash };
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  const handle = await open(path, "r");

  try {
    const buffer = new Uint8Array(CHUNK);

    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, CHUNK, null);

      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    await handle.close();
  }

  return hash.digest("hex");
}

async function keep(path: string, contents: string | Uint8Array): Promise<void> {
  if (
    await lstat(path).then(
      () => true,
      () => false,
    )
  )
    return;
  await mkdir(join(path, ".."), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;

  try {
    await writeFile(temporary, contents);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function readWalkedTree(store: string, id: SnapshotId): Promise<Tree> {
  if (id === "") return { files: {}, incomplete: false };

  if (!id.startsWith("tree:")) throw new SdkError("invalid", `${id} is not a walked snapshot.`);

  const text = await readFile(
    join(store, "trees", `${id.slice("tree:".length)}.json`),
    "utf8",
  ).catch(() => null);

  if (text === null) throw new SdkError("unknown", `No snapshot ${id} is stored.`);
  const value: unknown = JSON.parse(text);

  if (
    typeof value !== "object" ||
    value === null ||
    !("files" in value) ||
    typeof value.files !== "object" ||
    value.files === null ||
    Array.isArray(value.files)
  )
    throw new SdkError("internal", `Snapshot ${id} is malformed.`);

  return {
    incomplete: "incomplete" in value && value.incomplete === true,
    files: Object.fromEntries(
      Object.entries(value.files).flatMap(([path, hash]) =>
        typeof hash === "string" ? [[path, hash]] : [],
      ),
    ),
  };
}

function compareTrees(before: Tree, after: Tree) {
  const from = before.files;
  const to = after.files;
  const gone = Object.keys(from).filter((path) => !(path in to));
  const fresh = Object.keys(to).filter((path) => !(path in from));

  const incomplete = new Set([
    ...(after.incomplete ? gone : []),
    ...(before.incomplete ? fresh : []),
  ]);

  const deleted = after.incomplete ? [] : gone;
  const added = before.incomplete ? [] : fresh;
  const moved = new Map<string, string>();
  const byHash = new Map<string, string[]>();

  for (const path of deleted)
    byHash.set(from[path] ?? "", [...(byHash.get(from[path] ?? "") ?? []), path]);

  for (const path of added) {
    const source = byHash.get(to[path] ?? "")?.shift();

    if (source !== undefined) moved.set(path, source);
  }

  const sources = new Set(moved.values());

  const files: Changed[] = [
    ...deleted
      .filter((path) => !sources.has(path))
      .map((path): Changed => ({ path, status: "deleted" })),
    ...added.map((path): Changed => {
      const source = moved.get(path);

      return source === undefined
        ? { path, status: "added" }
        : { path, status: "renamed", from: source };
    }),
    ...Object.keys(to)
      .filter((path) => path in from && from[path] !== to[path])
      .map((path): Changed => ({ path, status: "modified" })),
    ...[...incomplete].map((path): Changed => ({ path, status: "modified" })),
  ];

  return {
    files: files.sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    ),
    incomplete,
  };
}

async function sideText(
  store: string,
  hash: string | undefined,
): Promise<string | null | undefined> {
  if (hash === undefined) return null;
  const bytes = await readFile(join(store, "objects", hash)).catch(() => undefined);

  return bytes === undefined ? undefined : (decodeText(bytes) ?? undefined);
}

async function stored(
  store: string,
  hash: string | undefined,
): Promise<"absent" | "text" | "binary" | "missing"> {
  if (hash === undefined) return "absent";
  const bytes = await readFile(join(store, "objects", hash)).catch(() => undefined);

  if (bytes === undefined) return "missing";

  return decodeText(bytes) === null ? "binary" : "text";
}

async function manifestStat(
  store: string,
  from: Manifest,
  to: Manifest,
  file: Changed,
): Promise<LineStat> {
  const before = from[file.from ?? file.path];
  const after = to[file.path];
  const kinds = await Promise.all([stored(store, before), stored(store, after)]);

  if (kinds.includes("missing")) return { kind: "unknown" };

  if (kinds.includes("binary")) return { kind: "binary" };

  return lineStat((await sideText(store, before)) ?? "", (await sideText(store, after)) ?? "");
}

async function manifestEntry(
  store: string,
  from: Manifest,
  to: Manifest,
  file: Changed,
  diff: DiffOptions | undefined,
): Promise<PatchEntry> {
  const before = from[file.from ?? file.path];
  const after = to[file.path];
  const kinds = await Promise.all([stored(store, before), stored(store, after)]);
  const digest = sha256(`${before ?? ""}\u0000${after ?? ""}`);

  if (kinds.includes("missing"))
    return { path: file.path, status: file.status, digest, kind: "too-large", limit: PATCH_LIMIT };

  if (kinds.includes("binary"))
    return { path: file.path, status: file.status, digest, kind: "binary" };

  return textEntry(
    file.path,
    file.status,
    (await sideText(store, before)) ?? null,
    (await sideText(store, after)) ?? null,
    diff,
  );
}

function generationName(number: number): string {
  return `g${String(number).padStart(6, "0")}`;
}
