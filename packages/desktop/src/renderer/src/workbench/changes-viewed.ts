import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

const STORAGE_KEY = "nyte.desktop.changes-viewed.v1";

/** A repository keeps review marks for a large change set, not for its whole history. */
const MAX_FILES_PER_REPOSITORY = 500;

/** Marks for a repository nobody opened in a month describe a review that ended. */
const REPOSITORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const viewedMarkSchema = Type.Object(
  { digest: Type.String(), at: Type.Number() },
  { additionalProperties: false },
);

const repositoryViewedSchema = Type.Object(
  { touchedAt: Type.Number(), files: Type.Record(Type.String(), viewedMarkSchema) },
  { additionalProperties: false },
);

const changesViewedSchema = Type.Record(Type.String(), repositoryViewedSchema);

export type ViewedMark = Static<typeof viewedMarkSchema>;

export type RepositoryViewed = Static<typeof repositoryViewedSchema>;

export type ChangesViewed = Static<typeof changesViewedSchema>;

/**
 * `changed` means the file was reviewed at an older patch: the mark is stale, so the
 * panel can offer a "recently changed" affordance instead of a plain unviewed row.
 */
export type ViewedState = "unviewed" | "viewed" | "changed";

export type ViewedSummary = "none" | "some" | "all";

/** A path with the digest of the patch shown for it right now. */
export interface ViewedFile {
  readonly path: string;
  readonly digest: string;
}

type ViewedStorage = Pick<Storage, "getItem" | "setItem">;

export interface ChangesViewedOptions {
  readonly storage?: ViewedStorage;
  readonly now?: () => number;
  readonly maxFilesPerRepository?: number;
  readonly repositoryRetentionMs?: number;
}

export const EMPTY_CHANGES_VIEWED: ChangesViewed = {};

export function decodeChangesViewed(serialized: string | null): ChangesViewed {
  if (serialized === null) return EMPTY_CHANGES_VIEWED;

  try {
    const parsed: unknown = JSON.parse(serialized);

    return Value.Check(changesViewedSchema, parsed) ? parsed : EMPTY_CHANGES_VIEWED;
  } catch {
    return EMPTY_CHANGES_VIEWED;
  }
}

/**
 * A stable, synchronous digest of patch text. Review marks only need to detect that a
 * patch differs from the reviewed one, so a 64-bit FNV-1a pair beats an async hash.
 */
export function patchDigest(patch: string): string {
  let low = 0x811c9dc5;
  let high = 0x01000193;

  for (let index = 0; index < patch.length; index += 1) {
    const code = patch.charCodeAt(index);
    low = Math.imul(low ^ code, 0x01000193);
    high = Math.imul(high ^ (code + index), 0x85ebca6b);
  }

  const part = (value: number): string => (value >>> 0).toString(16).padStart(8, "0");

  return `${part(low)}${part(high)}:${patch.length.toString(16)}`;
}

function markState(mark: ViewedMark | undefined, digest: string): ViewedState {
  if (mark === undefined) return "unviewed";

  return mark.digest === digest ? "viewed" : "changed";
}

/**
 * Per-file review marks, keyed by repository and path. The snapshot revision changes on
 * any edit in the workspace, so it must never appear in a key: marks would vanish on an
 * unrelated save.
 */
export class ChangesViewedStore {
  readonly #storage: ViewedStorage | undefined;
  readonly #now: () => number;
  readonly #maxFiles: number;
  readonly #retentionMs: number;
  readonly #listeners = new Set<() => void>();
  #viewed: ChangesViewed = EMPTY_CHANGES_VIEWED;

  constructor(options: ChangesViewedOptions = {}) {
    this.#storage = options.storage;
    this.#now = options.now ?? Date.now;
    this.#maxFiles = options.maxFilesPerRepository ?? MAX_FILES_PER_REPOSITORY;
    this.#retentionMs = options.repositoryRetentionMs ?? REPOSITORY_RETENTION_MS;

    try {
      this.#viewed = this.#prune(decodeChangesViewed(this.#storage?.getItem(STORAGE_KEY) ?? null));
    } catch {
      // Corrupt or unavailable storage must not prevent reviewing changes in this window.
    }
  }

  getSnapshot = (): ChangesViewed => this.#viewed;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);

    return () => this.#listeners.delete(listener);
  };

  /** A file counts as viewed only while its patch still matches the reviewed digest. */
  fileState(root: string, file: ViewedFile): ViewedState {
    return markState(this.#viewed[root]?.files[file.path], file.digest);
  }

  markViewed(root: string, file: ViewedFile): void {
    this.markAllViewed(root, [file]);
  }

  markAllViewed(root: string, files: readonly ViewedFile[]): void {
    if (files.length === 0) return;
    const pending = files.filter((file) => this.fileState(root, file) !== "viewed");

    if (pending.length === 0) return;
    const at = this.#now();
    const files_ = { ...this.#viewed[root]?.files };

    for (const file of pending) files_[file.path] = { digest: file.digest, at };
    this.#commit(root, files_);
  }

  clearViewed(root: string, path: string): void {
    this.clearAllViewed(root, [path]);
  }

  clearAllViewed(root: string, paths: readonly string[]): void {
    const current = this.#viewed[root];

    if (current === undefined) return;
    const marked = paths.filter((path) => current.files[path] !== undefined);

    if (marked.length === 0) return;
    const files = { ...current.files };

    for (const path of marked) delete files[path];
    this.#commit(root, files);
  }

  /** Tri-state for a master checkbox: a stale mark does not count as reviewed. */
  summary(root: string, files: readonly ViewedFile[]): ViewedSummary {
    if (files.length === 0) return "none";
    const viewed = files.filter((file) => this.fileState(root, file) === "viewed").length;

    if (viewed === 0) return "none";

    return viewed === files.length ? "all" : "some";
  }

  #commit(root: string, files: Record<string, ViewedMark>): void {
    const bounded = this.#evictOldest(files);

    const next = this.#prune({
      ...this.#viewed,
      [root]: { touchedAt: this.#now(), files: bounded },
    });

    this.#viewed = Object.keys(bounded).length === 0 ? this.#withoutRepository(next, root) : next;

    try {
      this.#storage?.setItem(STORAGE_KEY, JSON.stringify(this.#viewed));
    } catch {
      // Keep the marks for this window even when persistence is unavailable.
    }

    for (const listener of this.#listeners) listener();
  }

  #withoutRepository(viewed: ChangesViewed, root: string): ChangesViewed {
    const next = { ...viewed };
    delete next[root];

    return next;
  }

  #evictOldest(files: Record<string, ViewedMark>): Record<string, ViewedMark> {
    const entries = Object.entries(files);

    if (entries.length <= this.#maxFiles) return files;

    const kept = entries
      .toSorted(([, left], [, right]) => right.at - left.at)
      .slice(0, this.#maxFiles);

    return Object.fromEntries(kept);
  }

  #prune(viewed: ChangesViewed): ChangesViewed {
    const oldest = this.#now() - this.#retentionMs;

    const kept = Object.entries(viewed).filter(
      ([, repository]) =>
        repository.touchedAt >= oldest && Object.keys(repository.files).length > 0,
    );

    return kept.length === Object.keys(viewed).length ? viewed : Object.fromEntries(kept);
  }
}

function browserStorage(): ViewedStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export const changesViewed = new ChangesViewedStore({ storage: browserStorage() });
