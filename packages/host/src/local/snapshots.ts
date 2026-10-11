import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readlink,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ChangeSet,
  DiffOptions,
  LineStat,
  PatchEntry,
  RunId,
  SnapshotId,
} from "@nyte-ai/schema";
import { SdkError } from "@nyte-ai/core";
import type { ExecutionEnv, SnapshotsApi } from "@nyte-ai/core";
import { sha256 } from "../hash.ts";
import { run } from "./command.ts";
import type { Ran } from "./command.ts";
import {
  PATCH_LIMIT,
  lineStat,
  parseNameStatus,
  parseNumstat,
  readPatches,
  snapshotOf,
  textEntry,
} from "./patch.ts";
import type { Changed } from "./patch.ts";
import { decodeText } from "./text.ts";
import { WALK_LIMIT, walkTree } from "./tree.ts";

/** Returns a repository holding an environment: its root, git directory, and the environment's path under the root (`""` or `sub/dir/`). */
type Repository = { readonly root: string; readonly gitDir: string; readonly prefix: string };

/** Returns a walked tree's manifest: each path's content hash. */
type Manifest = Readonly<Record<string, string>>;

/** Returns a walked snapshot as stored: its manifest, and whether the walk stopped short (at its entry limit or at an unreadable directory), so a path it lacks may still be there. */
type Tree = { readonly files: Manifest; readonly incomplete: boolean };

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

const BEFORE_KEPT = 1_000;

const CHUNK = 64 * 1024;

/** Returns content-addressed snapshots of an environment's tree, so equal trees are equal ids whichever run took them. `before(run)` is taken once per run in this process and answered again after; `after(run)` is taken on every call. In a repository (`git`, default `git` on the PATH), a snapshot writes the environment's part of the worktree, tracked and untracked files that are not ignored, into a temporary index seeded from the real one (`GIT_INDEX_FILE`, `git add -A`, `git write-tree --prefix` for a workspace below the root; the real index is never touched) and keeps the tree reachable under the hidden ref `refs/nyte/snapshots/<tree>`; the id is `git:<tree>`. Without a repository it walks the tree as `localFiles.scan` does (up to `limit` entries, default 50 000), stores each file's bytes up to 1 MiB once under `<store>/objects/<sha256>` (a larger file is hashed, not stored; a file whose size, mtime and inode did not move is not re-read) and the tree, `{ incomplete, files }` (whether the walk stopped short, at its limit or at an unreadable directory, and the manifest of paths to content hashes), under `<store>/trees/<sha256 of it>.json`; the id is `tree:<hash>`. `diff(from, to)` answers the `ChangeSet` between two snapshots of one kind (`git diff-tree -r -M --name-status`/`--numstat`, or the two manifests compared, an exact-content move a rename; the empty id `""` is the empty tree), its `revision` `to`; a path only an incomplete side lacks is neither added nor deleted but `modified` with an `unknown` stat; `patches(from, to, paths, options)` answers one `PatchEntry` per path the comparison reports, parsed into hunks as `localGit` parses them (`git diff` between the trees, read as `localGit.patches` reads: a path past 1 MiB `too-large`, one whose read fails `failed`, the others fine), or, between manifests, from the stored contents with the line diff (`too-large` for a file not stored, `binary` for one not text, `failed { reason: "incomplete" }` for a path only an incomplete side lacks). Snapshots of two kinds do not compare: `SdkError("invalid")`. */
export function localSnapshots(
  env: ExecutionEnv,
  options: { readonly store: string; readonly git?: string; readonly limit?: number },
): SnapshotsApi {
  const binary = options.git ?? "git";
  const befores = new Map<RunId, Promise<SnapshotId>>();
  const stamps = new Map<string, { readonly stamp: string; readonly hash: string }>();

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

  const repository = async (): Promise<Repository | null> => {
    const ran = await git(env.cwd, [
      "rev-parse",
      "--show-toplevel",
      "--absolute-git-dir",
      "--show-prefix",
    ]).catch(() => null);

    if (ran === null || ran.code !== 0) return null;
    const [root, gitDir, prefix = ""] = ran.stdout.toString("utf8").split("\n");

    return root === undefined || gitDir === undefined ? null : { root, gitDir, prefix };
  };

  const checked = async (ran: Ran): Promise<string> => {
    if (ran.code !== 0) throw new SdkError("unavailable", ran.stderr.trim() || "git failed");

    return ran.stdout.toString("utf8").trim();
  };

  const gitSnapshot = async (repo: Repository): Promise<SnapshotId> => {
    const write = async (seeded: boolean): Promise<Ran> => {
      const index = join(tmpdir(), `nyte-index-${randomUUID()}`);

      try {
        if (seeded) await copyFile(join(repo.gitDir, "index"), index).catch(() => undefined);
        const indexEnv = { GIT_INDEX_FILE: index };
        await checked(await git(env.cwd, ["add", "-A", "--", "."], { env: indexEnv }));

        return await git(
          repo.root,
          repo.prefix === "" ? ["write-tree"] : ["write-tree", `--prefix=${repo.prefix}`],
          { env: indexEnv },
        );
      } finally {
        await rm(index, { force: true });
      }
    };

    const first = await write(true);
    const tree = await checked(first.code === 0 ? first : await write(false));
    await checked(await git(repo.root, ["update-ref", `refs/nyte/snapshots/${tree}`, tree]));

    return snapshotOf(`git:${tree}`);
  };

  const walkSnapshot = async (): Promise<SnapshotId> => {
    const manifest: Record<string, string> = {};
    let incomplete = false;

    for await (const frame of walkTree(env.cwd, {
      ignored: "exclude",
      limit: options.limit ?? WALK_LIMIT,
    })) {
      if (frame.kind === "incomplete") incomplete = true;

      if (frame.kind !== "entries") continue;

      for (const entry of frame.entries) {
        if (entry.kind === "directory") continue;

        const hash = await storeEntry(
          options.store,
          join(env.cwd, entry.path),
          entry.kind,
          stamps,
        ).catch(() => null);

        if (hash !== null) manifest[entry.path] = hash;
      }
    }

    const text = JSON.stringify({
      incomplete,
      files: Object.fromEntries(
        Object.entries(manifest).sort(([left], [right]) => (left < right ? -1 : 1)),
      ),
    });

    const id = sha256(text);
    await keep(join(options.store, "trees", `${id}.json`), text);

    return snapshotOf(`tree:${id}`);
  };

  const take = async (): Promise<SnapshotId> => {
    const repo = await repository();

    return repo === null ? walkSnapshot() : gitSnapshot(repo);
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
    const kinds = new Set(
      [from, to].filter((id) => id !== "").map((id) => id.slice(0, id.indexOf(":"))),
    );

    if (kinds.size > 1)
      throw new SdkError("invalid", `Snapshots ${from} and ${to} are of two kinds.`);

    if (kinds.has("tree") || kinds.size === 0)
      return {
        kind: "tree",
        from: await treeOf(options.store, from),
        to: await treeOf(options.store, to),
      };
    const repo = await repository();

    if (repo === null)
      throw new SdkError("unavailable", `${env.cwd} is no longer in a git repository.`);

    const empty = await checked(
      await git(repo.root, ["hash-object", "-t", "tree", "--stdin"], { input: "" }),
    );

    const tree = (id: SnapshotId): string => (id === "" ? empty : id.slice("git:".length));

    return { kind: "git", repo, from: tree(from), to: tree(to) };
  };

  const changed = async (
    from: SnapshotId,
    to: SnapshotId,
  ): Promise<readonly (Changed & { readonly stat: LineStat })[]> => {
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
    before(run) {
      const known = befores.get(run);

      if (known !== undefined) return known;
      const taken = take();
      befores.set(run, taken);
      taken.catch(() => befores.delete(run));

      for (const old of befores.keys()) {
        if (befores.size <= BEFORE_KEPT) break;
        befores.delete(old);
      }

      return taken;
    },
    after: () => take(),
    async diff(from, to): Promise<ChangeSet> {
      return { revision: to, files: await changed(from, to) };
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

/** Stores one walked file or symlink's bytes (a file's up to 1 MiB; a symlink's target) under its content hash, reusing the last hash while its size, mtime and inode stay, and returns the hash. */
async function storeEntry(
  store: string,
  path: string,
  kind: "file" | "symlink",
  stamps: Map<string, { readonly stamp: string; readonly hash: string }>,
): Promise<string> {
  const stats = await lstat(path);
  const stamp = `${kind}:${stats.size}:${stats.mtimeMs}:${stats.ino}`;
  const known = stamps.get(path);

  if (known?.stamp === stamp) return known.hash;

  if (kind === "symlink") {
    const target = new TextEncoder().encode(await readlink(path));
    const hash = sha256(target);
    await keep(join(store, "objects", hash), target);
    stamps.set(path, { stamp, hash });

    return hash;
  }

  if (stats.size > PATCH_LIMIT) {
    const hash = await hashFile(path);
    stamps.set(path, { stamp, hash });

    return hash;
  }

  const bytes = await readFile(path);
  const hash = sha256(bytes);
  await keep(join(store, "objects", hash), bytes);
  stamps.set(path, { stamp, hash });

  return hash;
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

/** Writes a content-addressed file once, through a temporary file renamed into place. */
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

/** Returns a walked snapshot's tree; the empty id is the empty tree. */
async function treeOf(store: string, id: SnapshotId): Promise<Tree> {
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

/** Compares two trees: added, deleted and modified paths, an added path whose content a deleted one had becoming a rename from it; in path order. A path only one side holds while the other is incomplete is in `incomplete` and listed as `modified`, never added or deleted. */
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

/** Returns a stored object's text, null when it is absent (empty side), and undefined when it is not stored or not text. */
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

  return {
    ...textEntry(
      file.path,
      file.status,
      (await sideText(store, before)) ?? null,
      (await sideText(store, after)) ?? null,
      diff,
    ),
    digest,
  };
}
