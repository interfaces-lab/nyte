import type { FileVersion, SnapshotId } from "./ids.ts";

export type FileStatus = "added" | "modified" | "deleted" | "renamed" | "untracked" | "conflicted";

export type FileChange = {
  readonly path: string;
  readonly status: FileStatus;
  readonly added: number;
  readonly removed: number;
  readonly from?: string;
};
export type FileEntryView = {
  readonly path: string;
  readonly kind: "file" | "directory" | "symlink";
  readonly size: number | null;
  readonly version: FileVersion | null;
};
export type FileEvent = { readonly path: string; readonly version: FileVersion | null } & (
  | { readonly kind: "created" }
  | { readonly kind: "modified" }
  | { readonly kind: "removed" }
);
export type ScanFrame =
  | { readonly kind: "entries"; readonly entries: readonly FileEntryView[] }
  | { readonly kind: "complete" }
  | { readonly kind: "incomplete"; readonly reason: "limit" | "changed" | "permission" };
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
export type FormatOutcome =
  | { readonly kind: "formatted"; readonly contents: string }
  | { readonly kind: "unchanged" }
  | { readonly kind: "unavailable"; readonly reason: string };

export type WriteOutcome =
  | { readonly kind: "saved"; readonly version: FileVersion }
  | { readonly kind: "stale"; readonly current: FileVersion | null }
  | { readonly kind: "missing-parent" };

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
