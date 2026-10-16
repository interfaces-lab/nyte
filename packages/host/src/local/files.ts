import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { asId, SdkError, serial } from "@nyte-ai/schema";
import type {
  ByteReader,
  FileEntryView,
  FileEvent,
  FileVersion,
  FormatOutcome,
  SearchFrame,
} from "@nyte-ai/schema";
import type { FileBatch, FilesApi } from "@nyte-ai/core";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { sha256 } from "../hash.ts";
import { findExecutable, run } from "./command.ts";
import type { Ran } from "./command.ts";
import { feed } from "./feed.ts";
import { decodeText } from "./text.ts";
import { readErrorCode, createIgnores, walkTree, watchPath, watchTree } from "./tree.ts";

/** Returns a byte reader that carries the version of the file it read, which the server answers as `X-Nyte-Version` (§40h, §40p). */
export type VersionedReader = ByteReader & { readonly version: FileVersion };

/** Returns the local `FilesApi`, its `bytes` typed with the version it read. */
export type LocalFiles = Omit<FilesApi, "bytes"> & {
  bytes(path: string): Promise<VersionedReader>;
};

/** The size past which `read` answers `large`: 1 MiB. */
export const TEXT_LIMIT = 1024 * 1024;

const CHUNK = 64 * 1024;

const FIND_DEFAULT = 20;

const FIND_CAP = 50;

const FIND_TTL_MS = 5_000;

const SEARCH_DEFAULT = 200;

const SEARCH_LINE = 500;

const WATCH_DELAY_MS = 100;

const WATCH_POLL_MS = 1_000;

const FORMATTERS = ["oxfmt", "prettier", "biome"] as const;

/** Returns a folder's files over `node:fs`: a relative path resolves against `root`, an absolute one is taken as given (the ancestor context files are read through it, §37g). A version is the SHA-256 of what is there, never an mtime: a file's contents (through a symlink, its target's), a directory's sorted entry names, and, for `stat` of a symlink itself, its target path. `read` answers `text` for UTF-8 without NUL up to 1 MiB, `large` above, `binary` otherwise, `missing` when absent (`SdkError("invalid")` for a directory); `bytes` streams the file with its size, a null mime and its version (`SdkError("unknown")` when absent); `stat` uses `lstat` (a symlink with its `target`), null when absent. `write` compares `expect` with the current version first (`stale { current }`, `absent` needing no file), answers `missing-parent` unless `parents`, and writes through a temporary file renamed into place (through a symlink, at its target), keeping an existing file's mode; `remove` compares `expect` the same way (`stale { current: null }` when nothing is there) and answers `saved` with the version it removed. `batch()` returns a plan whose `apply` and `upload()` reject with `SdkError("unavailable")`: core lays its own over them (`wrapFiles`). `format` runs `formatter`, else the first of `oxfmt`, `prettier` and `biome` under `<root>/node_modules/.bin`, then on the `PATH`, with the contents on stdin and the path for its config, answering `unchanged` when equal and `unavailable { reason }` when there is none or it fails. `scan` walks `directory` (default the root; an absolute one is walked as its own root and answered with absolute paths) breadth-first in pages of 500 entries, skipping `.git` and, unless `ignored: "include"` or the directory is itself ignored, what `.gitignore` files and `.git/info/exclude` ignore (`ignore`), then `complete`, or `incomplete` with `limit` after 50,000 entries or `permission` after an unreadable directory; entries carry no version. `find` matches the query against the scanned file paths, case-insensitively: exact name, name prefix, name substring, path substring, then a fuzzy subsequence, shorter first, at most `limit` (default 20, capped at 50), the scan reused for 5 s. `search` runs `ripgrep` (else `rg` on the PATH; with neither, a scan of the text files up to 1 MiB) for the literal query with smart case, yielding a `match` per matching line (1-based line and column, the line cut at 500 characters), then `complete`, or `truncated` at `limit` (default 200). `watch` uses a recursive `fs.watch` on the root (a 1 s poll where there is none) or, given `paths`, a watch on each of them alone that waits for a missing one to appear and never polls, without ignored paths or directories, coalescing changes over 100 ms into `created`, `modified` and `removed` events with the version after (null when removed), a path's last change winning while the reader is behind. `signal` ends every open `watch`. */
export function localFiles(
  root: string,
  options?: {
    readonly ripgrep?: string;
    readonly formatter?: string;
    readonly signal?: AbortSignal;
  },
): LocalFiles {
  const absolute = (path: string): string => (isAbsolute(path) ? path : join(root, path));

  const within = (path: string): string => {
    const inside = relative(root, path);

    return inside.startsWith("..") || isAbsolute(inside) ? path : inside.split(sep).join("/");
  };

  let found: { readonly at: number; readonly paths: Promise<readonly FileEntryView[]> } | null =
    null;

  const scanned = (): Promise<readonly FileEntryView[]> => {
    if (found !== null && Date.now() - found.at < FIND_TTL_MS) return found.paths;
    const paths = collectFiles(root);
    found = { at: Date.now(), paths };
    paths.catch(() => {
      if (found?.paths === paths) found = null;
    });

    return paths;
  };

  return {
    async read(path) {
      const target = absolute(path);
      const stats = await stat(target).catch(missing);

      if (stats === null) return { kind: "missing", path };

      if (stats.isDirectory()) throw new SdkError("invalid", `${path} is a directory.`);

      if (stats.size > TEXT_LIMIT)
        return { kind: "large", path, size: stats.size, version: await hashFile(target) };
      const bytes = await readFile(target).catch(missing);

      if (bytes === null) return { kind: "missing", path };
      const version = hashVersion(bytes);
      const text = decodeText(bytes);

      return text === null
        ? { kind: "binary", path, size: bytes.byteLength, version }
        : { kind: "text", path, contents: text, version };
    },
    async bytes(path) {
      const target = absolute(path);
      const stats = await stat(target).catch(missing);

      if (stats === null || !stats.isFile())
        throw new SdkError("unknown", `No file is at ${path}.`);
      const version = await hashFile(target);
      let handle: Awaited<ReturnType<typeof open>> | null = null;

      const close = async (): Promise<void> => {
        const held = handle;
        handle = null;
        await held?.close();
      };

      return {
        size: stats.size,
        mime: null,
        version,
        async *chunks() {
          handle = await open(target, "r");

          try {
            for (;;) {
              const held = handle;

              if (held === null) return;
              const buffer = new Uint8Array(CHUNK);
              const { bytesRead } = await held.read(buffer, 0, CHUNK, null);

              if (bytesRead === 0) return;
              yield buffer.subarray(0, bytesRead);
            }
          } finally {
            await close();
          }
        },
        close,
        [Symbol.asyncDispose]: close,
      };
    },
    async stat(path) {
      const target = absolute(path);
      const stats = await lstat(target).catch(missing);

      if (stats === null) return null;

      if (stats.isSymbolicLink()) {
        const link = await readlink(target);

        return { kind: "symlink", size: stats.size, version: hashVersion(link), target: link };
      }

      if (stats.isDirectory())
        return { kind: "directory", size: stats.size, version: await directoryVersion(target) };

      return { kind: "file", size: stats.size, version: await hashFile(target) };
    },
    async write(path, contents, writeOptions) {
      const target = await resolveLink(absolute(path));
      const current = await currentVersion(target);
      const expect = writeOptions?.expect;

      if (expect === "absent" ? current !== null : expect !== undefined && expect !== current)
        return { kind: "stale", current };
      const parent = dirname(target);
      const folder = await stat(parent).catch(missing);

      if (folder === null) {
        if (writeOptions?.parents !== true) return { kind: "missing-parent" };
        await mkdir(parent, { recursive: true });
      } else if (!folder.isDirectory())
        throw new SdkError("invalid", `${dirname(path)} is not a directory.`);

      const bytes = typeof contents === "string" ? new TextEncoder().encode(contents) : contents;
      const mode = (await stat(target).catch(missing))?.mode;
      const temporary = join(parent, `.${basename(target)}.${randomUUID()}.nyte-tmp`);

      try {
        await writeFile(temporary, bytes);

        if (mode !== undefined) await chmod(temporary, mode & 0o7777);
        await rename(temporary, target);
      } catch (error) {
        await unlink(temporary).catch(() => undefined);

        throw error;
      }

      return { kind: "saved", version: hashVersion(bytes) };
    },
    async remove(path, removeOptions) {
      const target = absolute(path);
      const link = await lstat(target).catch(missing);

      if (link === null) return { kind: "stale", current: null };

      const current =
        (await currentVersion(target)) ??
        (link.isSymbolicLink() ? hashVersion(await readlink(target)) : null);

      if (removeOptions?.expect !== undefined && removeOptions.expect !== current)
        return { kind: "stale", current };
      await rm(target, { recursive: link.isDirectory() });

      return current === null ? { kind: "stale", current } : { kind: "saved", version: current };
    },
    batch: () => refusedBatch(),
    async format(path, contents) {
      return format(root, absolute(path), contents, options?.formatter);
    },
    async *scan(input) {
      const directory = input?.directory ?? "";
      const own = isAbsolute(directory);
      const base = own ? directory : root;
      const start = own ? "" : directory;
      const ignores = createIgnores(base);

      const ignored =
        input?.ignored === "include" || (start !== "" && (await ignores.ignored(start, true)))
          ? "include"
          : "exclude";

      for await (const frame of walkTree(base, { directory: start, ignored, ignores })) {
        if (frame.kind !== "entries") {
          yield frame;
          continue;
        }

        yield {
          kind: "entries",
          entries: frame.entries.map((entry): FileEntryView => ({
            path: own ? join(directory, entry.path) : entry.path,
            kind: entry.kind,
            size: entry.size,
            version: null,
          })),
        };
      }
    },
    async find(input) {
      const limit = Math.min(Math.max(1, input.limit ?? FIND_DEFAULT), FIND_CAP);

      return rank(await scanned(), input.query, limit);
    },
    search(input) {
      const limit = Math.max(1, input.limit ?? SEARCH_DEFAULT);

      return search(root, input.query, limit, options?.ripgrep);
    },
    watch(input) {
      const paths = (input?.paths ?? []).map((path) => within(absolute(path)));

      return watchFiles(root, paths, options?.signal);
    },
    upload: async () => {
      throw new SdkError("unavailable", "Core stores uploads; the local provider does not.");
    },
  };
}

function hashVersion(data: string | Uint8Array): FileVersion {
  return asId<"file-version">(sha256(data));
}

function missing(error: unknown): null {
  const code = readErrorCode(error);

  if (code === "ENOENT" || code === "ENOTDIR") return null;

  throw error;
}

async function hashFile(path: string): Promise<FileVersion> {
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

  return asId<"file-version">(hash.digest("hex"));
}

async function directoryVersion(path: string): Promise<FileVersion> {
  return hashVersion((await readdir(path)).sort().join("\n"));
}

async function currentVersion(path: string): Promise<FileVersion | null> {
  const stats = await stat(path).catch(missing);

  if (stats === null) return null;

  return stats.isDirectory() ? directoryVersion(path) : hashFile(path).catch(missing);
}

async function resolveLink(path: string): Promise<string> {
  const link = await lstat(path).catch(missing);

  return link?.isSymbolicLink() === true ? realpath(path).catch(() => path) : path;
}

function refusedBatch(): FileBatch {
  return {
    put: () => refusedBatch(),
    remove: () => refusedBatch(),
    apply: async () => {
      throw new SdkError("unavailable", "Core applies file batches; the local provider does not.");
    },
  };
}

async function collectFiles(root: string): Promise<readonly FileEntryView[]> {
  const entries: FileEntryView[] = [];

  for await (const frame of walkTree(root, { ignored: "exclude" }))
    if (frame.kind === "entries")
      for (const entry of frame.entries)
        if (entry.kind !== "directory")
          entries.push({ path: entry.path, kind: entry.kind, size: entry.size, version: null });

  return entries;
}

function rank(
  entries: readonly FileEntryView[],
  query: string,
  limit: number,
): readonly FileEntryView[] {
  const needle = query.trim().toLowerCase();

  if (needle === "") return entries.slice(0, limit);

  const scored = entries.flatMap((entry) => {
    const path = entry.path.toLowerCase();
    const name = path.slice(path.lastIndexOf("/") + 1);

    const score =
      name === needle
        ? 0
        : name.startsWith(needle)
          ? 1
          : name.includes(needle)
            ? 2
            : path.includes(needle)
              ? 3
              : subsequence(path, needle)
                ? 4
                : null;

    return score === null ? [] : [{ entry, score }];
  });

  return scored
    .sort(
      (left, right) =>
        left.score - right.score ||
        left.entry.path.length - right.entry.path.length ||
        (left.entry.path < right.entry.path ? -1 : 1),
    )
    .slice(0, limit)
    .map(({ entry }) => entry);
}

function subsequence(text: string, needle: string): boolean {
  let at = 0;

  for (const char of text) {
    if (char === needle[at]) at += 1;

    if (at === needle.length) return true;
  }

  return false;
}

async function format(
  root: string,
  path: string,
  contents: string,
  formatter: string | undefined,
): Promise<FormatOutcome> {
  const binary = formatter ?? (await detectFormatter(root));

  if (binary === null)
    return { kind: "unavailable", reason: "No formatter is installed for this workspace." };
  const name = basename(binary).replace(/\.(cmd|exe)$/i, "");

  const args =
    name === "biome"
      ? ["format", `--stdin-file-path=${path}`]
      : name === "oxfmt"
        ? [`--stdin-filepath=${path}`]
        : ["--stdin-filepath", path];

  let ran: Ran;

  try {
    ran = await run(binary, args, { cwd: root, input: contents });
  } catch (error) {
    return { kind: "unavailable", reason: error instanceof Error ? error.message : String(error) };
  }

  if (ran.code !== 0)
    return {
      kind: "unavailable",
      reason: `${name} could not format ${basename(path)}: ${ran.stderr.trim()}`,
    };
  const formatted = ran.stdout.toString("utf8");

  return formatted === contents
    ? { kind: "unchanged" }
    : { kind: "formatted", contents: formatted };
}

async function detectFormatter(root: string): Promise<string | null> {
  for (const name of FORMATTERS) {
    const found = await findExecutable(name, [join(root, "node_modules", ".bin")]);

    if (found !== null) return found;
  }

  return null;
}

async function* search(
  root: string,
  query: string,
  limit: number,
  ripgrep: string | undefined,
): AsyncGenerator<SearchFrame> {
  if (query === "") {
    yield { kind: "complete" };

    return;
  }

  const binary = await findExecutable(ripgrep ?? "rg");

  if (binary === null) {
    yield* scanText(root, query, limit);

    return;
  }

  const child = spawn(
    binary,
    [
      "--json",
      "--fixed-strings",
      "--smart-case",
      "--no-config",
      "--hidden",
      "--no-require-git",
      "--glob=!.git",
      "--",
      query,
      ".",
    ],
    { cwd: root, stdio: ["ignore", "pipe", "ignore"], windowsHide: true },
  );

  const lines = createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY });
  let count = 0;

  try {
    for await (const line of lines) {
      const match = ripgrepMatch(line);

      if (match === null) continue;

      if (count >= limit) {
        yield { kind: "truncated", limit };

        return;
      }

      count += 1;
      yield match;
    }

    yield { kind: "complete" };
  } finally {
    lines.close();
    child.kill();
  }
}

/** The `match` records `rg --json` prints, the fields a search frame takes from them. */
const RipgrepMatchSchema = Type.Object({
  type: Type.Literal("match"),
  data: Type.Object({
    path: Type.Object({ text: Type.String() }),
    lines: Type.Object({ text: Type.String() }),
    line_number: Type.Number(),
    submatches: Type.Optional(Type.Array(Type.Unknown())),
  }),
});

const SubmatchSchema = Type.Object({ start: Type.Number() });

function ripgrepMatch(line: string): Extract<SearchFrame, { readonly kind: "match" }> | null {
  let record: unknown;

  try {
    record = JSON.parse(line);
  } catch {
    return null;
  }

  if (!Value.Check(RipgrepMatchSchema, record)) return null;
  const { path, lines, line_number: number, submatches } = record.data;
  const first = submatches?.[0];
  const offset = Value.Check(SubmatchSchema, first) ? first.start : 0;
  const text = lines.text.replace(/\r?\n$/, "");
  const before = new TextDecoder().decode(new TextEncoder().encode(text).subarray(0, offset));

  return {
    kind: "match",
    path: path.text.replace(/^\.\//, "").split(sep).join("/"),
    line: number,
    column: before.length + 1,
    text: text.slice(0, SEARCH_LINE),
  };
}

async function* scanText(root: string, query: string, limit: number): AsyncGenerator<SearchFrame> {
  const sensitive = query !== query.toLowerCase();
  const needle = sensitive ? query : query.toLowerCase();
  let count = 0;

  for await (const frame of walkTree(root, { ignored: "exclude" })) {
    if (frame.kind !== "entries") continue;

    for (const entry of frame.entries) {
      if (entry.kind !== "file" || (entry.size ?? 0) > TEXT_LIMIT) continue;
      const bytes = await readFile(join(root, entry.path)).catch(() => null);
      const text = bytes === null ? null : decodeText(bytes);

      if (text === null) continue;

      for (const [index, line] of text.split("\n").entries()) {
        const [before = "", ...after] = (sensitive ? line : line.toLowerCase()).split(needle);

        if (after.length === 0) continue;
        const column = before.length;

        if (count >= limit) {
          yield { kind: "truncated", limit };

          return;
        }

        count += 1;
        yield {
          kind: "match",
          path: entry.path,
          line: index + 1,
          column: column + 1,
          text: line.replace(/\r$/, "").slice(0, SEARCH_LINE),
        };
      }
    }
  }

  yield { kind: "complete" };
}

function watchFiles(
  root: string,
  paths: readonly string[],
  signal: AbortSignal | undefined,
): AsyncIterable<readonly FileEvent[]> {
  return feed<readonly FileEvent[]>(
    (sink) => {
      const ignores = createIgnores(root);
      const known = new Map<string, FileVersion | null>();
      const started = Date.now();
      const reads = serial();

      const readEvent = async (path: string): Promise<FileEvent | null> => {
        if (path.endsWith(".gitignore"))
          ignores.forget(path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

        if (await ignores.ignored(path, false)) return null;
        const at = isAbsolute(path) ? path : join(root, path);
        const stats = await lstat(at).catch(() => null);

        if (stats?.isDirectory() === true) return null;

        const version = stats === null ? null : await currentVersion(at).catch(() => null);

        const before = known.get(path);
        known.set(path, version);

        if (version === null)
          return before === null ? null : { kind: "removed", path, version: null };

        if (before === version) return null;

        const created =
          before === null ||
          (before === undefined && stats !== null && stats.birthtimeMs >= started - 1_000);

        return { kind: created ? "created" : "modified", path, version };
      };

      const listMoved = async (
        prefix: string,
        changed: ReadonlySet<string>,
      ): Promise<readonly string[]> => {
        const inside = [...changed].flatMap((path) => (path === "" ? [] : [`${prefix}/${path}`]));

        if (!changed.has("")) return inside;
        const below = [...known.keys()].filter((path) => path.startsWith(`${prefix}/`));

        for await (const frame of walkTree(isAbsolute(prefix) ? prefix : join(root, prefix), {
          ignored: "include",
        }))
          if (frame.kind === "entries")
            for (const entry of frame.entries)
              if (entry.kind === "file") below.push(`${prefix}/${entry.path}`);

        return [prefix, ...below, ...inside];
      };

      const heard = (changed: Iterable<string> | Promise<Iterable<string>>): void => {
        void reads.run(async () => {
          const events: FileEvent[] = [];

          for (const path of await changed) {
            if (path === "") continue;
            const event = await readEvent(path).catch(() => null);

            if (event !== null) events.push(event);
          }

          if (events.length > 0) sink.push(events);
        });
      };

      const watching =
        paths.length === 0 || paths.includes("")
          ? [watchTree(root, { delay: WATCH_DELAY_MS, poll: WATCH_POLL_MS }, heard)]
          : paths.map((prefix) =>
              watchPath(
                isAbsolute(prefix) ? prefix : join(root, prefix),
                { delay: WATCH_DELAY_MS },
                (changed) => heard(listMoved(prefix, changed)),
              ),
            );

      const dispose = (): void => {
        for (const stop of watching) stop();
      };

      const end = (): void => sink.end();
      signal?.addEventListener("abort", end, { once: true });

      if (signal?.aborted === true) end();

      return () => {
        signal?.removeEventListener("abort", end);
        dispose();
      };
    },
    (waiting, next) => {
      const merged = new Map(waiting.map((event) => [event.path, event]));

      for (const event of next) merged.set(event.path, event);

      return [...merged.values()];
    },
  );
}
