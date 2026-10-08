import type { FileDiffMetadata } from "@pierre/diffs";
import { VCS_DIFF_PATHS_MAX } from "@nyte-ai/protocol";
import type { VcsDiff } from "@nyte-ai/protocol";
import { patchDigest } from "./changes-viewed.ts";
import { parsePatch } from "./patch-parse.ts";

/** What one file's patch became once it was read and parsed. */
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
  /** The comparison reports the file but its patch has no text, as under ignore-whitespace. */
  | { readonly kind: "empty" }
  | { readonly kind: "too_large"; readonly limit: number }
  | { readonly kind: "failed" };

/**
 * Where patches come from. `key` names one comparison at one state: entries
 * read under another key are stale. `lineage` names the comparison across
 * states, so an earlier state's entry may stand in until the fresh one lands.
 * `paths` are the files the comparison reports now; nothing else is kept.
 */
export interface PatchSource {
  readonly key: string;
  readonly lineage: string;
  readonly paths: readonly string[];
  readonly read: (paths: readonly string[]) => Promise<readonly VcsDiff[]>;
}

export interface PatchSnapshot {
  readonly key: string | undefined;
  readonly lineage: string | undefined;
  /** Entries read under `key`. */
  readonly fresh: ReadonlyMap<string, PatchEntry>;
  /**
   * For reported paths not yet read under `key`, the entry an earlier state of
   * the same lineage left, shown until the fresh one replaces it.
   */
  readonly stale: ReadonlyMap<string, PatchEntry>;
}

/** What an explicit request answers: every entry, or that its source was replaced first. */
export type EnsuredPatches =
  | { readonly kind: "read"; readonly entries: ReadonlyMap<string, PatchEntry> }
  | { readonly kind: "superseded" };

/**
 * Paths one read of rendered headers or prepared files sends. Every read
 * repeats the comparison's discovery and the host runs four patch processes
 * at once, so eight paths amortize discovery while a header that scrolls in
 * waits at most two rounds behind the read in flight.
 */
const READ_BATCH = 8;

/** Paths one explicit request (mark all viewed) sends per read: as many as a read may name. */
const PINNED_BATCH = VCS_DIFF_PATHS_MAX;

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

/** A patch's text with nothing in it reads as no patch, as the host omits empty ones. */
async function entryOf(diff: VcsDiff, earlier: PatchEntry | undefined): Promise<PatchEntry> {
  switch (diff.kind) {
    case "too_large":
      return { kind: "too_large", limit: diff.limit };
    case "failed":
      return FAILED;
    case "binary":
      return { kind: "binary", text: diff.patch, digest: patchDigest(diff.patch) };
    case "text": {
      if (diff.patch.trim() === "") return EMPTY;

      // A refresh that leaves the file's patch unchanged keeps what was already parsed.
      if (earlier?.kind === "ready" && earlier.patch === diff.patch) return earlier;
      const digest = patchDigest(diff.patch);

      return {
        kind: "ready",
        patch: diff.patch,
        digest,
        files: await parsePatch(diff.patch, digest),
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

/**
 * Reads the patches a stack shows, one read at a time, until every expanded
 * file is read. Each read takes the first non-empty tier:
 *
 * 1. headers the stack renders, so a file scrolled to or revealed jumps ahead
 *    of everything queued behind the read in flight;
 * 2. explicit requests (mark viewed), including collapsed files;
 * 3. prepared files with nothing to show yet;
 * 4. prepared files still showing an earlier state's entry.
 *
 * Each read's entries publish together, so a stack re-renders once per read.
 *
 * Demand belongs to the source it was made against: replacing the source, or
 * releasing the loader, drops queued explicit demand and answers its waiters
 * `superseded`. A read answered after that is dropped too; the host still
 * finishes it, since nothing cancels a read in flight.
 */
export function createPatchLoader() {
  let source: PatchSource | undefined;
  let snapshot = EMPTY_SNAPSHOT;
  /** Bumped whenever the source's key changes or the loader is released. */
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

    for (const path of batch) {
      if (generation !== readGeneration) return;
      const diff = answered?.get(path);

      entries.set(
        path,
        answered === undefined
          ? FAILED
          : diff === undefined
            ? EMPTY
            : await entryOf(diff, snapshot.stale.get(path)).catch(() => FAILED),
      );
    }

    if (generation !== readGeneration) return;
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
    // Rendered headers in prepared order, nearest the file in view first, so a
    // revealed file is not queued behind its neighbors' headers.
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

  // Headers mounting in one commit register before the first read takes its batch.
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

    /**
     * Reads from `next` from now on. A new key starts a new generation: the
     * last entries of the same lineage stay as stand-ins, but only for paths
     * `next` still reports, and a fresh entry discards its stand-in.
     */
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

    /** Drops every source, demand, waiter, and entry; a read still in flight is discarded. */
    release(): void {
      source = undefined;
      mounted.clear();
      prepared = [];
      supersede();
      publish(EMPTY_SNAPSHOT);
    },

    /**
     * The expanded files to read without a header asking for them, in the
     * order to read them. Collapsed files stay out, and a hidden stack names
     * none, so neither costs a read unless something explicitly asks.
     */
    prepare(paths: readonly string[]): void {
      prepared = paths;
      schedule();
    },

    /** A rendered, expanded header asks for its patch while it stays mounted. */
    mount: (path: string): (() => void) => {
      mounted.set(path, (mounted.get(path) ?? 0) + 1);

      // A failed read is retried when its header comes back into view.
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

    /**
     * Reads every named path under the current source, ahead of prepared
     * files but behind rendered headers, and answers once each has an entry,
     * or `superseded` if the source is replaced or the loader released first.
     */
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
