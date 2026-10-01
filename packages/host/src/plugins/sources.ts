import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { isFileError } from "../paths.ts";
import { unitDataFiles } from "./units.ts";

export type Track = (file: string, directory?: boolean, content?: string | Uint8Array) => void;

export interface Prepared<T> {
  load(): Promise<T>;
}

/** `instance` only grows; a loader keys fresh module instances by it. */
export type Prepare<T> = (
  entry: string,
  track: Track,
  instance: number,
) => Promise<Prepared<T>> | Prepared<T>;

export interface Loaded<T> {
  /** Content digest of the tracked graph; changed bytes give a new version. */
  readonly version: string;
  readonly value: T;
}

export interface PluginSources<T> {
  /** Cached until a tracked file's digest changes. A failed attempt is cached too. */
  read(entry: string): Promise<Loaded<T>>;
  retain(entries: ReadonlySet<string>): void;
  invalidate(): void;
  dispose(): void;
}

interface Source<T> {
  readonly loaded: Promise<Loaded<T>>;
  readonly files: Map<string, { readonly digest: string; readonly directory: boolean }>;
  readonly epoch: number;
}

let instances = 0;

export function createPluginSources<T>(
  prepare: Prepare<T>,
  watch: (file: string) => Promise<void>,
): PluginSources<T> {
  const sources = new Map<string, Source<T>>();
  const watching = new Set<Promise<void>>();
  let epoch = 0;

  return {
    read: async (entry) => {
      await Promise.all(watching);
      const previous = sources.get(entry);

      if (
        previous !== undefined &&
        previous.epoch === epoch &&
        [...previous.files].every(([file, item]) => item.digest === digest(file, item.directory))
      )
        return previous.loaded;

      const files: Source<T>["files"] = new Map();

      const track: Track = (file, directory = false, content) => {
        if (files.has(file)) {
          if (content !== undefined) files.set(file, { digest: hash(content), directory });
          return;
        }
        files.set(file, {
          digest: content === undefined ? digest(file, directory) : hash(content),
          directory,
        });
        const pending = watch(file).finally(() => watching.delete(pending));
        watching.add(pending);
        void pending.catch(() => undefined);
      };

      track(entry);
      const instance = ++instances;
      const sourceEpoch = epoch;
      const loaded = Promise.resolve().then(async () => {
        const unit = await unitDataFiles(dirname(entry)).catch((cause: unknown) => {
          sources.delete(entry);
          throw cause;
        });
        for (const directory of unit.directories) track(directory, true);
        for (const file of unit.files) track(file);
        const prepared = await prepare(entry, track, instance);
        const value = await prepared.load();
        if (![...files].every(([file, item]) => item.digest === digest(file, item.directory)))
          throw new Error(`${entry}: plugin sources changed while loading`);
        return { version: versionOf(files, sourceEpoch), value };
      });

      sources.set(entry, { loaded, files, epoch });

      try {
        return await loaded;
      } finally {
        await Promise.all(watching);
      }
    },
    retain: (entries) => {
      for (const entry of sources.keys()) if (!entries.has(entry)) sources.delete(entry);
    },
    invalidate: () => {
      epoch += 1;
    },
    dispose: () => {
      sources.clear();
    },
  };
}

function versionOf(files: Source<unknown>["files"], epoch: number): string {
  const hash = createHash("sha256");

  for (const [file, item] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    hash.update(file).update("\0").update(item.digest).update("\n");
  }

  if (epoch > 0) hash.update(`epoch:${String(epoch)}`);
  return hash.digest("hex").slice(0, 16);
}

function hash(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

function digest(file: string, directory: boolean): string {
  try {
    return hash(directory ? JSON.stringify(readdirSync(file).sort()) : readFileSync(file));
  } catch (cause) {
    if (isFileError(cause, ["ENOENT"])) return "missing";
    throw cause;
  }
}
