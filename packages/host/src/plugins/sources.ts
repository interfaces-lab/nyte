/**
 * Source fingerprints and import attempts, kept together so filesystem events
 * reload changed local graphs without repeating unchanged evaluations. A
 * `Prepare` walks one entry's local import graph for its runtime, reporting
 * every file to `track`, and returns a loader. Based on opencode v2
 * `plugin/src/source.ts`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

export type Track = (file: string, directory?: boolean) => void;

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
  /** Every later read prepares afresh under a new version, unchanged bytes included. */
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

      const track: Track = (file, directory = false) => {
        if (files.has(file)) return;
        files.set(file, { digest: digest(file, directory), directory });
        const pending = watch(file).finally(() => watching.delete(pending));
        watching.add(pending);
        void pending.catch(() => undefined);
      };

      track(entry);
      const prepared = await prepare(entry, track, ++instances);

      const loaded = prepared.load().then((value) => ({
        version: versionOf(files, epoch),
        value,
      }));

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

function digest(file: string, directory: boolean): string {
  try {
    return createHash("sha256")
      .update(directory ? JSON.stringify(readdirSync(file).sort()) : readFileSync(file))
      .digest("hex");
  } catch {
    return "missing";
  }
}
