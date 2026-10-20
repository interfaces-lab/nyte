import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import type { Stats } from "node:fs";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Type, type TSchema } from "typebox";

export interface HistoryLine {
  readonly text: string;
  /** False for a last line without its newline: its writer may still be appending it. */
  readonly terminated: boolean;
}

export interface HistoryFold<Scan> {
  line(line: HistoryLine): void;
  scan(): Scan;
}

/** Folds a history file's lines into a scan. `scan()` returns a copy, so folding goes on without changing it. */
export type HistoryParser<Scan> = (from: Scan | undefined) => HistoryFold<Scan>;

export interface FileScan<Scan> {
  readonly size: number;
  readonly mtimeMs: number;
  /** The byte after the last newline, where a grown file resumes. */
  readonly position: number;
  /** The scan of every line up to `position`. */
  readonly committed: Scan;
}

export function fileScanSchema<Scan extends TSchema>(scan: Scan) {
  return Type.Object({
    size: Type.Number({ minimum: 0 }),
    mtimeMs: Type.Number(),
    position: Type.Number({ minimum: 0 }),
    committed: scan,
  });
}

/** Scans keyed by path. A scan answers while its file keeps the size and mtime it was read at. */
export class UsageScanCache<Scan> {
  readonly #files: Map<string, FileScan<Scan>>;
  #changed = false;

  constructor(files: Iterable<readonly [string, FileScan<Scan>]> = []) {
    this.#files = new Map(files);
  }

  keys(): IterableIterator<string> {
    return this.#files.keys();
  }

  entries(): IterableIterator<[string, FileScan<Scan>]> {
    return this.#files.entries();
  }

  get(path: string): FileScan<Scan> | undefined {
    return this.#files.get(path);
  }

  set(path: string, scan: FileScan<Scan>): void {
    if (this.#files.get(path) === scan) return;
    this.#files.set(path, scan);
    this.#changed = true;
  }

  /** Forgets every file a read did not reach. */
  keepOnly(seen: ReadonlySet<string>): void {
    for (const path of this.#files.keys()) {
      if (seen.has(path)) continue;
      this.#files.delete(path);
      this.#changed = true;
    }
  }

  /** Whether a scan was added or forgotten since the last {@link markSaved}. */
  get changed(): boolean {
    return this.#changed;
  }

  markSaved(): void {
    this.#changed = false;
  }
}

/**
 * Reads a history file through `cache`. An unchanged file answers from the cache without being
 * opened, and a file that only grew is read from its last newline on; any other change rereads it.
 * A last line without its newline is folded into the answer but not the cache, since its writer may
 * still be appending it: the next read starts from that line again.
 */
export async function readHistory<Scan>(
  path: string,
  info: Stats,
  parser: HistoryParser<Scan>,
  cache: UsageScanCache<Scan> | undefined,
  signal: AbortSignal | undefined,
): Promise<Scan> {
  const hit = cache?.get(path);
  const unchanged = hit !== undefined && hit.size === info.size && hit.mtimeMs === info.mtimeMs;

  if (unchanged && hit.position === info.size) return hit.committed;
  const from = unchanged || (hit !== undefined && info.size > hit.size) ? hit : undefined;
  const fold = parser(from?.committed);
  let position = from?.position ?? 0;
  let unterminated: HistoryLine | undefined;

  for await (const line of historyLines(path, position, signal)) {
    signal?.throwIfAborted();

    if (!line.terminated) {
      unterminated = line;
      continue;
    }

    fold.line(line);
    position = line.end;
  }

  const committed = fold.scan();
  cache?.set(
    path,
    unchanged ? hit : { size: info.size, mtimeMs: info.mtimeMs, position, committed },
  );

  if (unterminated === undefined) return committed;
  fold.line(unterminated);

  return fold.scan();
}

/** Yields a history file's lines from byte `start` up to the size it had when opened, though its writer may keep appending. */
async function* historyLines(path: string, start: number, signal: AbortSignal | undefined) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);

  try {
    const stat = await file.stat();

    if (!stat.isFile()) throw new Error("History is not a regular file.");
    const buffer = Buffer.alloc(64 * 1024);
    let pending = Buffer.alloc(0);
    let pendingStart = start;
    let position = start;

    while (position < stat.size) {
      signal?.throwIfAborted();

      const { bytesRead } = await file.read(
        buffer,
        0,
        Math.min(buffer.length, stat.size - position),
        position,
      );

      if (bytesRead === 0) break;
      position += bytesRead;
      const read = buffer.subarray(0, bytesRead);
      const chunk = pending.length === 0 ? read : Buffer.concat([pending, read]);
      let from = 0;

      // oxlint-disable-next-line nyte-code/no-index-of -- a byte search keeps offsets exact, which decoded text cannot
      for (let newline = chunk.indexOf(0x0a); newline !== -1; newline = chunk.indexOf(0x0a, from)) {
        yield {
          text: chunk.toString("utf8", from, newline),
          terminated: true,
          end: pendingStart + newline + 1,
        };
        from = newline + 1;
      }

      pendingStart += from;
      pending = Buffer.from(chunk.subarray(from));
    }

    if (pending.length > 0)
      yield {
        text: pending.toString("utf8"),
        terminated: false,
        end: pendingStart + pending.length,
      };
  } finally {
    await file.close();
  }
}

/** Reads a cache document written by {@link writeCacheDocument}; a missing, torn or outdated one reads as `undefined`. */
export async function readCacheDocument<Document>(
  path: string,
  validator: { Check(value: unknown): value is Document },
): Promise<Document | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));

    return validator.Check(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Replaces the cache document whole, so a reader never sees half of one. Resolves whether the write landed. */
export async function writeCacheDocument<Document>(
  path: string,
  document: Document,
): Promise<boolean> {
  const temporary = `${path}.${randomUUID()}.tmp`;

  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(temporary, JSON.stringify(document), { mode: 0o600 });
    await rename(temporary, path);

    return true;
  } catch {
    await rm(temporary, { force: true }).catch(() => undefined);

    return false;
  }
}
