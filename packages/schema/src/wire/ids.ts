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

export function idSchema<Name extends string>(): TUnsafe<Id<Name>> {
  return Type.Unsafe<Id<Name>>(Type.String());
}

export const SeqType = Type.Unsafe<Seq>(Type.Integer({ minimum: 0 }));

export const SessionIdSchema: Schema<SessionId> = standard(idSchema<"session">());

export const HeadNameSchema: Schema<HeadName> = standard(idSchema<"head">());

export const RunIdSchema: Schema<RunId> = standard(idSchema<"run">());

export const CallIdSchema: Schema<CallId> = standard(idSchema<"call">());

export const MessageIdSchema: Schema<MessageId> = standard(idSchema<"message">());

export const TurnIdSchema: Schema<TurnId> = standard(idSchema<"turn">());

export const CommitIdSchema: Schema<CommitId> = standard(idSchema<"commit">());

export const ObjectIdSchema: Schema<ObjectId> = standard(idSchema<"object">());

export const BlobIdSchema: Schema<BlobId> = standard(idSchema<"blob">());

export const PartIdSchema: Schema<PartId> = standard(idSchema<"part">());

export const ReceiptIdSchema: Schema<ReceiptId> = standard(idSchema<"receipt">());

export const JobIdSchema: Schema<JobId> = standard(idSchema<"job">());

export const JobKeySchema: Schema<JobKey> = standard(idSchema<"job-key">());

export const WorkspaceIdSchema: Schema<WorkspaceId> = standard(idSchema<"workspace">());

export const PageIdSchema: Schema<PageId> = standard(idSchema<"page">());

export const HostIdSchema: Schema<HostId> = standard(idSchema<"host">());

export const PrincipalIdSchema: Schema<PrincipalId> = standard(idSchema<"principal">());

export const SnapshotIdSchema: Schema<SnapshotId> = standard(idSchema<"snapshot">());

export const GitCommitIdSchema: Schema<GitCommitId> = standard(idSchema<"git-commit">());

export const GitRevisionSchema: Schema<GitRevision> = standard(idSchema<"git-revision">());

export const FileVersionSchema: Schema<FileVersion> = standard(idSchema<"file-version">());

export const DocumentRevisionSchema: Schema<DocumentRevision> =
  standard(idSchema<"document-revision">());

export const RevisionSchema: Schema<Revision> = standard(idSchema<"revision">());

export const CatalogGenerationSchema: Schema<CatalogGeneration> =
  standard(idSchema<"catalog-generation">());

export const CursorSchema: Schema<Cursor> = standard(idSchema<"cursor">());

export const SeqSchema: Schema<Seq> = standard(SeqType);

export const EnvironmentIdentitySchema: Schema<EnvironmentIdentity> =
  standard(idSchema<"environment-identity">());
