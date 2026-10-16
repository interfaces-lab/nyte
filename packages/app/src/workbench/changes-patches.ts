import { parsePatchFiles } from "@pierre/diffs";
import type { FileDiffMetadata } from "@pierre/diffs";
import type { PatchEntry as HostPatch } from "@nyte-ai/sdk";

export const PATCH_READ_MAX = 50;

export type PatchEntry =
  | {
      readonly kind: "ready";
      readonly patch: string;
      readonly digest: string;
      readonly files: readonly FileDiffMetadata[];
      readonly added: number;
      readonly removed: number;
    }
  | { readonly kind: "binary"; readonly text: string; readonly digest: string }
  | { readonly kind: "empty" }
  | { readonly kind: "too_large"; readonly limit: number }
  | { readonly kind: "failed" };

export interface PatchSource {
  readonly key: string;
  readonly lineage: string;
  readonly paths: readonly string[];
  readonly read: (paths: readonly string[]) => Promise<readonly HostPatch[]>;
}

export interface PatchSnapshot {
  readonly key: string | undefined;
  readonly lineage: string | undefined;
  readonly fresh: ReadonlyMap<string, PatchEntry>;
  readonly stale: ReadonlyMap<string, PatchEntry>;
}

export type EnsuredPatches =
  | { readonly kind: "read"; readonly entries: ReadonlyMap<string, PatchEntry> }
  | { readonly kind: "superseded" };

const READ_BATCH = 8;

const PINNED_BATCH = PATCH_READ_MAX;

const EMPTY_ENTRIES: ReadonlyMap<string, PatchEntry> = new Map();

const EMPTY_SNAPSHOT: PatchSnapshot = {
  key: undefined,
  lineage: undefined,
  fresh: EMPTY_ENTRIES,
  stale: EMPTY_ENTRIES,
};

const SUPERSEDED: EnsuredPatches = { kind: "superseded" };

const EMPTY: PatchEntry = { kind: "empty" };

const FAILED: PatchEntry = { kind: "failed" };

/**
 * A host patch as the stack renders it: the host's unified text, parsed once
 * by the renderer. The host's digest names
 * the patch within its source's lineage (scope and whitespace mode): an
 * unchanged digest keeps the earlier entry, and the pair keys the highlighter.
 */
function entryFrom(diff: HostPatch, earlier: PatchEntry | undefined, lineage: string): PatchEntry {
  switch (diff.kind) {
    case "too-large":
      return { kind: "too_large", limit: diff.limit };
    case "failed":
      return FAILED;
    case "binary":
      return { kind: "binary", text: `Binary file ${diff.path}`, digest: diff.digest };
    case "empty":
      return EMPTY;
    case "text": {
      if (earlier?.kind === "ready" && earlier.digest === diff.digest) return earlier;

      return {
        kind: "ready",
        patch: diff.patch,
        digest: diff.digest,
        files: parsePatchFiles(diff.patch, `${lineage}\u0000${diff.digest}`).flatMap(
          (parsed) => parsed.files,
        ),
        added: diff.added,
        removed: diff.removed,
      };
    }

    default: {
      const _exhaustive: never = diff;

      return _exhaustive;
    }
  }
}

interface Waiter {
  readonly paths: readonly string[];
  readonly resolve: (answer: EnsuredPatches) => void;
}

export function createPatchLoader() {
  let source: PatchSource | undefined;
  let snapshot = EMPTY_SNAPSHOT;
  let generation = 0;
  const mounted = new Map<string, number>();
  const pinned = new Set<string>();
  let prepared: readonly string[] = [];
  const waiters = new Set<Waiter>();
  const listeners = new Set<() => void>();
  let reading = false;
  let scheduled = false;

  const publish = (next: PatchSnapshot): void => {
    snapshot = next;

    for (const listener of listeners) listener();
  };

  const supersede = (): void => {
    generation += 1;
    pinned.clear();
    const abandoned = [...waiters];
    waiters.clear();

    for (const waiter of abandoned) waiter.resolve(SUPERSEDED);
  };

  const settleWaiters = (): void => {
    for (const waiter of waiters) {
      const entries = new Map<string, PatchEntry>();

      for (const path of waiter.paths) {
        const entry = snapshot.fresh.get(path);

        if (entry !== undefined) entries.set(path, entry);
      }

      if (entries.size < waiter.paths.length) continue;
      waiters.delete(waiter);
      waiter.resolve({ kind: "read", entries });
    }
  };

  const wanted = (paths: Iterable<string>, limit: number): readonly string[] => {
    const batch: string[] = [];

    for (const path of paths) {
      if (snapshot.fresh.has(path)) continue;
      batch.push(path);

      if (batch.length === limit) break;
    }

    return batch;
  };

  const read = async (current: PatchSource, batch: readonly string[]): Promise<void> => {
    const readGeneration = generation;

    const answered = await current.read(batch).then(
      (diffs) => new Map(diffs.map((diff) => [diff.path, diff])),
      () => undefined,
    );

    const entries = new Map<string, PatchEntry>();

    if (generation !== readGeneration) return;

    for (const path of batch) {
      const diff = answered?.get(path);

      entries.set(
        path,
        answered === undefined
          ? FAILED
          : diff === undefined
            ? EMPTY
            : entryFrom(diff, snapshot.stale.get(path), current.lineage),
      );
    }

    const fresh = new Map(snapshot.fresh);
    const stale = new Map(snapshot.stale);

    for (const [path, entry] of entries) {
      fresh.set(path, entry);
      stale.delete(path);
      pinned.delete(path);
    }

    publish({ ...snapshot, fresh, stale });
  };

  const nextBatch = (): readonly string[] => {
    const visible = wanted(
      new Set([...prepared.filter((path) => mounted.has(path)), ...mounted.keys()]),
      READ_BATCH,
    );

    if (visible.length > 0) return visible;
    const pins = wanted(pinned, PINNED_BATCH);

    if (pins.length > 0) return pins;

    const unread = wanted(
      prepared.filter((path) => !snapshot.stale.has(path)),
      READ_BATCH,
    );

    return unread.length > 0 ? unread : wanted(prepared, READ_BATCH);
  };

  const pump = async (): Promise<void> => {
    const current = source;

    if (reading || current === undefined) return;
    const batch = nextBatch();

    if (batch.length === 0) return;
    reading = true;

    try {
      await read(current, batch);
    } finally {
      reading = false;
    }

    settleWaiters();
    void pump();
  };

  const schedule = (): void => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      void pump();
    });
  };

  return {
    getSnapshot: (): PatchSnapshot => snapshot,

    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },

    setSource(next: PatchSource): void {
      const previous = source;
      source = next;
      const reported = new Set(next.paths);

      if (previous?.key === next.key) {
        const kept = (entries: ReadonlyMap<string, PatchEntry>) =>
          [...entries.keys()].every((path) => reported.has(path))
            ? entries
            : new Map([...entries].filter(([path]) => reported.has(path)));

        const fresh = kept(snapshot.fresh);
        const stale = kept(snapshot.stale);

        if (fresh !== snapshot.fresh || stale !== snapshot.stale) {
          publish({ ...snapshot, fresh, stale });
        }

        return;
      }

      supersede();
      const stale = new Map<string, PatchEntry>();

      if (snapshot.lineage === next.lineage) {
        for (const path of reported) {
          const entry = snapshot.fresh.get(path) ?? snapshot.stale.get(path);

          if (entry !== undefined) stale.set(path, entry);
        }
      }

      publish({ key: next.key, lineage: next.lineage, fresh: EMPTY_ENTRIES, stale });
      schedule();
    },

    release(): void {
      source = undefined;
      mounted.clear();
      prepared = [];
      supersede();
      publish(EMPTY_SNAPSHOT);
    },

    prepare(paths: readonly string[]): void {
      prepared = paths;
      schedule();
    },

    mount: (path: string): (() => void) => {
      mounted.set(path, (mounted.get(path) ?? 0) + 1);

      if (snapshot.fresh.get(path)?.kind === "failed") {
        const fresh = new Map(snapshot.fresh);
        fresh.delete(path);
        publish({ ...snapshot, fresh });
      }

      schedule();

      return () => {
        const count = (mounted.get(path) ?? 1) - 1;

        if (count > 0) mounted.set(path, count);
        else mounted.delete(path);
      };
    },

    ensure(paths: readonly string[]): Promise<EnsuredPatches> {
      if (source === undefined) return Promise.resolve(SUPERSEDED);

      return new Promise((resolve) => {
        waiters.add({ paths, resolve });

        for (const path of paths) pinned.add(path);
        settleWaiters();
        schedule();
      });
    },
  };
}

export type PatchLoader = ReturnType<typeof createPatchLoader>;
