import { Type } from "typebox";
import { idSchema } from "./ids.ts";
import { standard } from "./schema.ts";
import type { Decoded, Schema } from "./schema.ts";
import { nullable } from "./wire/nullable.ts";

export const FileStatusType = Type.Enum([
  "added",
  "modified",
  "deleted",
  "renamed",
  "untracked",
  "conflicted",
]);

export type FileStatus = Decoded<typeof FileStatusType>;

export const FileChangeType = Type.Object({
  path: Type.String(),
  status: FileStatusType,
  added: Type.Number(),
  removed: Type.Number(),
  from: Type.Optional(Type.String()),
});

export type FileChange = Decoded<typeof FileChangeType>;

export const FileEntryViewType = Type.Object({
  path: Type.String(),
  kind: Type.Enum(["file", "directory", "symlink"]),
  size: nullable(Type.Number()),
  version: nullable(idSchema<"file-version">()),
});

export type FileEntryView = Decoded<typeof FileEntryViewType>;

export const FileEventType = Type.Object({
  path: Type.String(),
  version: nullable(idSchema<"file-version">()),
  kind: Type.Enum(["created", "modified", "removed"]),
});

export type FileEvent = Decoded<typeof FileEventType>;

export const ScanFrameType = Type.Union([
  Type.Object({ kind: Type.Literal("entries"), entries: Type.Array(FileEntryViewType) }),
  Type.Object({ kind: Type.Literal("complete") }),
  Type.Object({
    kind: Type.Literal("incomplete"),
    reason: Type.Enum(["limit", "changed", "permission"]),
  }),
]);

export type ScanFrame = Decoded<typeof ScanFrameType>;

export const SearchFrameType = Type.Union([
  Type.Object({
    kind: Type.Literal("match"),
    path: Type.String(),
    line: Type.Number(),
    column: Type.Number(),
    text: Type.String(),
  }),
  Type.Object({ kind: Type.Literal("complete") }),
  Type.Object({ kind: Type.Literal("truncated"), limit: Type.Number() }),
]);

export type SearchFrame = Decoded<typeof SearchFrameType>;

export const FormatOutcomeType = Type.Union([
  Type.Object({ kind: Type.Literal("formatted"), contents: Type.String() }),
  Type.Object({ kind: Type.Literal("unchanged") }),
  Type.Object({ kind: Type.Literal("unavailable"), reason: Type.String() }),
]);

export type FormatOutcome = Decoded<typeof FormatOutcomeType>;

export const WriteOutcomeType = Type.Union([
  Type.Object({ kind: Type.Literal("saved"), version: idSchema<"file-version">() }),
  Type.Object({ kind: Type.Literal("stale"), current: nullable(idSchema<"file-version">()) }),
  Type.Object({ kind: Type.Literal("missing-parent") }),
]);

export type WriteOutcome = Decoded<typeof WriteOutcomeType>;

export const BatchOutcomeType = Type.Union([
  Type.Object({
    kind: Type.Literal("applied"),
    snapshot: idSchema<"snapshot">(),
    paths: Type.Array(Type.String()),
  }),
  Type.Object({ kind: Type.Literal("stale"), paths: Type.Array(Type.String()) }),
  Type.Object({
    kind: Type.Literal("partial"),
    applied: Type.Array(Type.String()),
    remaining: Type.Array(Type.String()),
    reason: Type.String(),
  }),
  Type.Object({ kind: Type.Literal("stopped"), applied: Type.Array(Type.String()) }),
]);

export type BatchOutcome = Decoded<typeof BatchOutcomeType>;

export const FileDocumentType = Type.Union([
  Type.Object({
    kind: Type.Literal("text"),
    path: Type.String(),
    contents: Type.String(),
    version: idSchema<"file-version">(),
  }),
  Type.Object({
    kind: Type.Enum(["binary", "large"]),
    path: Type.String(),
    size: Type.Number(),
    version: idSchema<"file-version">(),
  }),
  Type.Object({ kind: Type.Literal("missing"), path: Type.String() }),
]);

export type FileDocument = Decoded<typeof FileDocumentType>;

export const FileStatusSchema: Schema<FileStatus> = standard(FileStatusType);

export const FileChangeSchema: Schema<FileChange> = standard(FileChangeType);

export const FileEntryViewSchema: Schema<FileEntryView> = standard(FileEntryViewType);

export const FileEventSchema: Schema<FileEvent> = standard(FileEventType);

export const ScanFrameSchema: Schema<ScanFrame> = standard(ScanFrameType);

export const SearchFrameSchema: Schema<SearchFrame> = standard(SearchFrameType);

export const FormatOutcomeSchema: Schema<FormatOutcome> = standard(FormatOutcomeType);

export const WriteOutcomeSchema: Schema<WriteOutcome> = standard(WriteOutcomeType);

export const BatchOutcomeSchema: Schema<BatchOutcome> = standard(BatchOutcomeType);

export const FileDocumentSchema: Schema<FileDocument> = standard(FileDocumentType);
