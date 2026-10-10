import type { FileVersion } from "./ids.ts";

/**
 * Names how a path changed.
 *
 * @category git
 * @since 0.1.0
 */
export type FileStatus = "added" | "modified" | "deleted" | "renamed" | "untracked" | "conflicted";

/** Returns one changed file with its line counts; `from` is a rename's source. */
export interface FileChange { readonly path: string; readonly status: FileStatus; readonly added: number; readonly removed: number; readonly from?: string }
/** Returns one file, directory or symlink as a listing row. */
export interface FileEntryView { readonly path: string; readonly kind: "file" | "directory" | "symlink"; readonly size: number | null; readonly version: FileVersion | null }
/** Returns one file created, modified or removed, with its version. */
export type FileEvent = { readonly path: string; readonly version: FileVersion | null } & ({ readonly kind: "created" } | { readonly kind: "modified" } | { readonly kind: "removed" });
/** Returns one frame of a scan: a page of entries, then complete or incomplete. */
export type ScanFrame = { readonly kind: "entries"; readonly entries: readonly FileEntryView[] } | { readonly kind: "complete" } | { readonly kind: "incomplete"; readonly reason: "limit" | "changed" | "permission" };
/** Returns one frame of a content search: a match, then complete or truncated. */
export type SearchFrame = { readonly kind: "match"; readonly path: string; readonly line: number; readonly column: number; readonly text: string } | { readonly kind: "complete" } | { readonly kind: "truncated"; readonly limit: number };
/** Returns the result of formatting contents: formatted, unchanged, or no formatter. */
export type FormatOutcome = { readonly kind: "formatted"; readonly contents: string } | { readonly kind: "unchanged" } | { readonly kind: "unavailable"; readonly reason: string };
