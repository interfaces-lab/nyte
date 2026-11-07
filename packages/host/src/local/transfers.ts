import { randomUUID } from "node:crypto";
import { cp, lstat, mkdir, readdir, realpath, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { platform } from "node:process";
import { asId } from "@nyte-ai/schema";
import type { RestoreOutcome, TransferOutcome, TrashOutcome, TrashToken } from "@nyte-ai/schema";
import type { FilesApi } from "@nyte-ai/core";
import { run } from "./command.ts";
import { missing, readErrorCode } from "./tree.ts";

type Transfers = Pick<FilesApi, "move" | "copy" | "mkdir" | "trash" | "restore">;

type Inside =
  | { readonly kind: "inside"; readonly path: string }
  | { readonly kind: "invalid"; readonly reason: "root" | "outside" };

const LOCKING = platform === "win32";

const RENAME_ATTEMPTS = 8;

const RENAME_BACKOFF_MS = 250;

const HOLDING = "nyte-trash";

const holds = new Map<TrashToken, { readonly held: string; readonly original: string }>();

const purged = new Set<string>();

export function localTransfers(root: string): Transfers {
  const inside = (path: string): Inside => {
    const target = resolve(root, path);
    const within = relative(root, target);

    if (within === "") return { kind: "invalid", reason: "root" };

    if (within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within))
      return { kind: "invalid", reason: "outside" };

    return { kind: "inside", path: target };
  };

  const transfer = async (
    from: string,
    to: string,
    kind: "move" | "copy",
  ): Promise<TransferOutcome> => {
    const source = inside(from);
    const target = inside(to);

    if (source.kind === "invalid") return source;

    if (target.kind === "invalid") return target;

    const entry = await lstat(source.path, { bigint: true }).catch(missing);

    if (entry === null) return { kind: "stale", reason: "missing" };

    if (source.path === target.path) return { kind: "done" };

    if (await into(source.path, target.path)) return { kind: "invalid", reason: "into-itself" };
    const taken = await lstat(target.path, { bigint: true }).catch(missing);

    const sameEntry =
      taken !== null &&
      source.path.toLowerCase() === target.path.toLowerCase() &&
      entry.dev === taken.dev &&
      entry.ino === taken.ino;

    if (taken !== null && !(kind === "move" && sameEntry))
      return { kind: "stale", reason: "exists" };
    await mkdir(dirname(target.path), { recursive: true });

    if (kind === "move") return renameRetrying(source.path, target.path);

    try {
      await cp(source.path, target.path, {
        recursive: true,
        errorOnExist: true,
        force: false,
        verbatimSymlinks: true,
        preserveTimestamps: true,
      });
    } catch (error) {
      await rm(target.path, { recursive: true, force: true });

      if (readErrorCode(error) === "ERR_FS_CP_EEXIST") return { kind: "stale", reason: "exists" };

      throw error;
    }

    return { kind: "done" };
  };

  return {
    move: (from, to) => transfer(from, to, "move"),
    copy: (from, to) => transfer(from, to, "copy"),
    async mkdir(path) {
      const target = inside(path);

      if (target.kind === "invalid") return target;
      const existing = await lstat(target.path).catch(missing);

      if (existing !== null)
        return existing.isDirectory()
          ? { kind: "done" }
          : { kind: "invalid", reason: "not-a-folder" };

      try {
        await mkdir(target.path, { recursive: true });
      } catch (error) {
        const code = readErrorCode(error);

        if (code === "EEXIST" || code === "ENOTDIR")
          return { kind: "invalid", reason: "not-a-folder" };

        throw error;
      }

      return { kind: "done" };
    },
    async trash(path): Promise<TrashOutcome> {
      const target = inside(path);

      if (target.kind === "invalid") return target;
      const entry = await lstat(target.path).catch(missing);

      if (entry === null) return { kind: "stale" };
      const holding = await holdingFolder(root);

      if (holding === null || (await stat(holding)).dev !== entry.dev)
        return { kind: "unavailable" };
      const token = asId<"trash">(randomUUID());
      const held = join(holding, token, basename(target.path));
      await mkdir(dirname(held), { recursive: true });
      const moved = await renameRetrying(target.path, held);

      if (moved.kind !== "done") {
        await rm(dirname(held), { recursive: true, force: true });

        if (moved.kind === "busy") return moved;

        return moved.kind === "stale" ? { kind: "stale" } : { kind: "unavailable" };
      }

      holds.set(token, { held, original: target.path });

      return { kind: "trashed", token };
    },
    async restore(token): Promise<RestoreOutcome> {
      const hold = holds.get(token);

      if (hold === undefined) return { kind: "stale", reason: "expired" };

      if ((await lstat(hold.original).catch(missing)) !== null)
        return { kind: "stale", reason: "exists" };
      await mkdir(dirname(hold.original), { recursive: true });
      const moved = await renameRetrying(hold.held, hold.original);

      if (moved.kind !== "done") return { kind: "stale", reason: "expired" };
      holds.delete(token);
      await rm(dirname(hold.held), { recursive: true, force: true });

      return { kind: "restored" };
    },
  };
}

async function into(source: string, target: string): Promise<boolean> {
  const real = await realpath(source).catch(() => source);
  const parent = await nearestReal(dirname(target));
  const within = relative(real, join(parent, basename(target)));

  return within === "" || !(within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within));
}

async function nearestReal(path: string): Promise<string> {
  const real = await realpath(path).catch(missing);

  if (real !== null) return real;
  const parent = dirname(path);

  return parent === path ? path : join(await nearestReal(parent), basename(path));
}

async function renameRetrying(from: string, to: string, attempt = 1): Promise<TransferOutcome> {
  try {
    await rename(from, to);

    return { kind: "done" };
  } catch (error) {
    const code = readErrorCode(error);

    if (code === "EXDEV") return { kind: "invalid", reason: "cross-device" };

    if (code === "ENOENT") return { kind: "stale", reason: "missing" };

    if (code === "EEXIST" || code === "ENOTEMPTY") return { kind: "stale", reason: "exists" };

    if (!LOCKING || (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY")) throw error;

    if (attempt >= RENAME_ATTEMPTS) return { kind: "busy" };
    await new Promise((settle) => setTimeout(settle, RENAME_BACKOFF_MS));

    return renameRetrying(from, to, attempt + 1);
  }
}

async function holdingFolder(root: string): Promise<string | null> {
  const ran = await run("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd: root,
  }).catch(() => null);

  if (ran === null || ran.code !== 0) return null;
  const holding = join(ran.stdout.toString("utf8").trim(), HOLDING);

  if (!purged.has(holding)) {
    purged.add(holding);
    const live = new Set([...holds.keys()].map(String));
    const entries = await readdir(holding).catch(missing);

    for (const name of entries ?? [])
      if (!live.has(name)) await rm(join(holding, name), { recursive: true, force: true });
  }

  await mkdir(holding, { recursive: true });

  return holding;
}
