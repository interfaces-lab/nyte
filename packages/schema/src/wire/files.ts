import { Type } from "typebox";
import type {
  BatchOutcome,
  FileChange,
  FileDocument,
  FileEntryView,
  FileEvent,
  FileStatus,
  FormatOutcome,
  ScanFrame,
  SearchFrame,
  WriteOutcome,
} from "../files.ts";
import { standard } from "../schema.ts";
import type { Schema } from "../schema.ts";
import { idSchema } from "./ids.ts";
import { nullable } from "./nullable.ts";

/** The TypeBox schema of a `FileStatus`. */
export const FileStatusType = Type.Enum([
  "added",
  "modified",
  "deleted",
  "renamed",
  "untracked",
  "conflicted",
]);

/** The TypeBox schema of a `FileChange`. */
export const FileChangeType = Type.Object({
  path: Type.String(),
  status: FileStatusType,
  added: Type.Number(),
  removed: Type.Number(),
  from: Type.Optional(Type.String()),
});

/** The TypeBox schema of a `FileEntryView`. */
export const FileEntryViewType = Type.Object({
  path: Type.String(),
  kind: Type.Enum(["file", "directory", "symlink"]),
  size: nullable(Type.Number()),
  version: nullable(idSchema<"file-version">()),
});

/** The TypeBox schema of a `FileEvent`. */
export const FileEventType = Type.Object({
  path: Type.String(),
  version: nullable(idSchema<"file-version">()),
  kind: Type.Enum(["created", "modified", "removed"]),
});

/** The TypeBox schema of a `ScanFrame`. */
export const ScanFrameType = Type.Union([
  Type.Object({ kind: Type.Literal("entries"), entries: Type.Array(FileEntryViewType) }),
  Type.Object({ kind: Type.Literal("complete") }),
  Type.Object({
    kind: Type.Literal("incomplete"),
    reason: Type.Enum(["limit", "changed", "permission"]),
  }),
]);

/** The TypeBox schema of a `SearchFrame`. */
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

/** The TypeBox schema of a `FormatOutcome`. */
export const FormatOutcomeType = Type.Union([
  Type.Object({ kind: Type.Literal("formatted"), contents: Type.String() }),
  Type.Object({ kind: Type.Literal("unchanged") }),
  Type.Object({ kind: Type.Literal("unavailable"), reason: Type.String() }),
]);

/** The TypeBox schema of a `WriteOutcome`. */
export const WriteOutcomeType = Type.Union([
  Type.Object({ kind: Type.Literal("saved"), version: idSchema<"file-version">() }),
  Type.Object({ kind: Type.Literal("stale"), current: nullable(idSchema<"file-version">()) }),
  Type.Object({ kind: Type.Literal("missing-parent") }),
]);

/** The TypeBox schema of a `BatchOutcome`. */
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

/** The TypeBox schema of a `FileDocument`. */
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

/** Validates a `FileStatus`. */
export const FileStatusSchema: Schema<FileStatus> = standard(FileStatusType);

/** Validates a `FileChange`. */
export const FileChangeSchema: Schema<FileChange> = standard(FileChangeType);

/** Validates a `FileEntryView`. */
export const FileEntryViewSchema: Schema<FileEntryView> = standard(FileEntryViewType);

/** Validates a `FileEvent`. */
export const FileEventSchema: Schema<FileEvent> = standard(FileEventType);

/** Validates a `ScanFrame`. */
export const ScanFrameSchema: Schema<ScanFrame> = standard(ScanFrameType);

/** Validates a `SearchFrame`. */
export const SearchFrameSchema: Schema<SearchFrame> = standard(SearchFrameType);

/** Validates a `FormatOutcome`. */
export const FormatOutcomeSchema: Schema<FormatOutcome> = standard(FormatOutcomeType);

/** Validates a `WriteOutcome`. */
export const WriteOutcomeSchema: Schema<WriteOutcome> = standard(WriteOutcomeType);

/** Validates a `BatchOutcome`. */
export const BatchOutcomeSchema: Schema<BatchOutcome> = standard(BatchOutcomeType);

/** Validates a `FileDocument`. */
export const FileDocumentSchema: Schema<FileDocument> = standard(FileDocumentType);
