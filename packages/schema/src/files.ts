import type { FileVersion, SnapshotId } from "./ids.ts";

/**
 * Names how a path changed.
 *
 * @category git
 * @since 0.1.0
 */
export type FileStatus = "added" | "modified" | "deleted" | "renamed" | "untracked" | "conflicted";

/** Returns one changed file with its line counts; `from` is a rename's source. */
export type FileChange = {
  readonly path: string;
  readonly status: FileStatus;
  readonly added: number;
  readonly removed: number;
  readonly from?: string;
};
/** Returns one file, directory or symlink as a listing row. */
export type FileEntryView = {
  readonly path: string;
  readonly kind: "file" | "directory" | "symlink";
  readonly size: number | null;
  readonly version: FileVersion | null;
};
/** Returns one file created, modified or removed, with its version. */
export type FileEvent = { readonly path: string; readonly version: FileVersion | null } & (
  | { readonly kind: "created" }
  | { readonly kind: "modified" }
  | { readonly kind: "removed" }
);
/** Returns one frame of a scan: a page of entries, then complete or incomplete. */
export type ScanFrame =
  | { readonly kind: "entries"; readonly entries: readonly FileEntryView[] }
  | { readonly kind: "complete" }
  | { readonly kind: "incomplete"; readonly reason: "limit" | "changed" | "permission" };
/** Returns one frame of a content search: a match, then complete or truncated. */
export type SearchFrame =
  | {
      readonly kind: "match";
      readonly path: string;
      readonly line: number;
      readonly column: number;
      readonly text: string;
    }
  | { readonly kind: "complete" }
  | { readonly kind: "truncated"; readonly limit: number };
/** Returns the result of formatting contents: formatted, unchanged, or no formatter. */
export type FormatOutcome =
  | { readonly kind: "formatted"; readonly contents: string }
  | { readonly kind: "unchanged" }
  | { readonly kind: "unavailable"; readonly reason: string };

/**
 * Returns the result of writing or removing one file.
 *
 * **Outcomes**
 *
 * - `saved`: written; `version` is the new version.
 * - `stale`: the file moved since `expect`; `current` is its version, or null if gone.
 * - `missing-parent`: the directory does not exist and `parents` was not set.
 *
 * @category files
 * @since 0.1.0
 */
export type WriteOutcome =
  | { readonly kind: "saved"; readonly version: FileVersion }
  | { readonly kind: "stale"; readonly current: FileVersion | null }
  | { readonly kind: "missing-parent" };

/**
 * Returns the result of applying a file batch.
 *
 * **Outcomes**
 *
 * - `applied`: every entry written; `snapshot` records the tree after.
 * - `stale`: `paths` moved since their `expect`; nothing was written.
 * - `partial`: `applied` were written, `remaining` were not, for `reason`.
 * - `stopped`: the receipt was stopped after `applied` were written.
 *
 * @category files
 * @since 0.1.0
 */
export type BatchOutcome =
  | { readonly kind: "applied"; readonly snapshot: SnapshotId; readonly paths: readonly string[] }
  | { readonly kind: "stale"; readonly paths: readonly string[] }
  | {
      readonly kind: "partial";
      readonly applied: readonly string[];
      readonly remaining: readonly string[];
      readonly reason: string;
    }
  | { readonly kind: "stopped"; readonly applied: readonly string[] };

/**
 * Returns a file read: text with contents, binary or large with a size, or
 * missing.
 *
 * @category files
 * @since 0.1.0
 */
export type FileDocument =
  | {
      readonly kind: "text";
      readonly path: string;
      readonly contents: string;
      readonly version: FileVersion;
    }
  | {
      readonly kind: "binary" | "large";
      readonly path: string;
      readonly size: number;
      readonly version: FileVersion;
    }
  | { readonly kind: "missing"; readonly path: string };
