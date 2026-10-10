import { Type } from "typebox";
import type { TUnsafe } from "typebox";
import type {
  BlobId,
  CallId,
  CatalogGeneration,
  CommitId,
  Cursor,
  DocumentRevision,
  FileVersion,
  GitCommitId,
  GitRevision,
  HeadName,
  HostId,
  Id,
  JobId,
  JobKey,
  MessageId,
  ObjectId,
  PageId,
  PartId,
  PrincipalId,
  ReceiptId,
  Revision,
  RunId,
  Seq,
  SessionId,
  SnapshotId,
  TurnId,
  WorkspaceId,
} from "../ids.ts";
import { standard } from "../schema.ts";
import type { Schema } from "../schema.ts";
import type { EnvironmentIdentity } from "../workspaces.ts";

/** Returns a string schema typed as an id of `Name`: no codec, so validating it is one compiled check (§40k). */
export function idSchema<Name extends string>(): TUnsafe<Id<Name>> {
  return Type.Unsafe<Id<Name>>(Type.String());
}

/** Validates a non-negative integer typed as a `Seq`, with no codec (§40k). */
export const SeqType = Type.Unsafe<Seq>(Type.Integer({ minimum: 0 }));

/** Validates a `SessionId`. */
export const SessionIdSchema: Schema<SessionId> = standard(idSchema<"session">());

/** Validates a `HeadName`. */
export const HeadNameSchema: Schema<HeadName> = standard(idSchema<"head">());

/** Validates a `RunId`. */
export const RunIdSchema: Schema<RunId> = standard(idSchema<"run">());

/** Validates a `CallId`. */
export const CallIdSchema: Schema<CallId> = standard(idSchema<"call">());

/** Validates a `MessageId`. */
export const MessageIdSchema: Schema<MessageId> = standard(idSchema<"message">());

/** Validates a `TurnId`. */
export const TurnIdSchema: Schema<TurnId> = standard(idSchema<"turn">());

/** Validates a `CommitId`. */
export const CommitIdSchema: Schema<CommitId> = standard(idSchema<"commit">());

/** Validates an `ObjectId`. */
export const ObjectIdSchema: Schema<ObjectId> = standard(idSchema<"object">());

/** Validates a `BlobId`. */
export const BlobIdSchema: Schema<BlobId> = standard(idSchema<"blob">());

/** Validates a `PartId`. */
export const PartIdSchema: Schema<PartId> = standard(idSchema<"part">());

/** Validates a `ReceiptId`. */
export const ReceiptIdSchema: Schema<ReceiptId> = standard(idSchema<"receipt">());

/** Validates a `JobId`. */
export const JobIdSchema: Schema<JobId> = standard(idSchema<"job">());

/** Validates a `JobKey`. */
export const JobKeySchema: Schema<JobKey> = standard(idSchema<"job-key">());

/** Validates a `WorkspaceId`. */
export const WorkspaceIdSchema: Schema<WorkspaceId> = standard(idSchema<"workspace">());

/** Validates a `PageId`. */
export const PageIdSchema: Schema<PageId> = standard(idSchema<"page">());

/** Validates a `HostId`. */
export const HostIdSchema: Schema<HostId> = standard(idSchema<"host">());

/** Validates a `PrincipalId`. */
export const PrincipalIdSchema: Schema<PrincipalId> = standard(idSchema<"principal">());

/** Validates a `SnapshotId`. */
export const SnapshotIdSchema: Schema<SnapshotId> = standard(idSchema<"snapshot">());

/** Validates a `GitCommitId`. */
export const GitCommitIdSchema: Schema<GitCommitId> = standard(idSchema<"git-commit">());

/** Validates a `GitRevision`. */
export const GitRevisionSchema: Schema<GitRevision> = standard(idSchema<"git-revision">());

/** Validates a `FileVersion`. */
export const FileVersionSchema: Schema<FileVersion> = standard(idSchema<"file-version">());

/** Validates a `DocumentRevision`. */
export const DocumentRevisionSchema: Schema<DocumentRevision> =
  standard(idSchema<"document-revision">());

/** Validates a `Revision`. */
export const RevisionSchema: Schema<Revision> = standard(idSchema<"revision">());

/** Validates a `CatalogGeneration`. */
export const CatalogGenerationSchema: Schema<CatalogGeneration> =
  standard(idSchema<"catalog-generation">());

/** Validates a `Cursor`. */
export const CursorSchema: Schema<Cursor> = standard(idSchema<"cursor">());

/** Validates a `Seq`. */
export const SeqSchema: Schema<Seq> = standard(SeqType);

/** Validates an `EnvironmentIdentity`. */
export const EnvironmentIdentitySchema: Schema<EnvironmentIdentity> =
  standard(idSchema<"environment-identity">());
