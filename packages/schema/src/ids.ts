export type Id<Name extends string> = string & { readonly __brand: Name };
export type SessionId = Id<"session">;
export type HeadName = Id<"head">;
export type RunId = Id<"run">;
export type CallId = Id<"call">;
export type MessageId = Id<"message">;
export type TurnId = Id<"turn">;
export type CommitId = Id<"commit">;
export type ObjectId = Id<"object">;
export type BlobId = Id<"blob">;
export type PartId = Id<"part">;
export type ReceiptId = Id<"receipt">;
export type JobId = Id<"job">;
export type JobKey = Id<"job-key">;
export type WorkspaceId = Id<"workspace">;
export type PageId = Id<"page">;
export type HostId = Id<"host">;
export type PrincipalId = Id<"principal">;
export type SnapshotId = Id<"snapshot">;
export type GitCommitId = Id<"git-commit">;
export type GitRevision = Id<"git-revision">;
export type FileVersion = Id<"file-version">;
export type DocumentRevision = Id<"document-revision">;
export type Revision = Id<"revision">;
export type CatalogGeneration = Id<"catalog-generation">;
export type Cursor = Id<"cursor">;
export type Seq = number & { readonly __brand: "seq" };

function isId<Name extends string>(_value: string): _value is Id<Name> {
  return true;
}

export function asId<Name extends string>(value: string): Id<Name> {
  if (!isId<Name>(value)) throw new Error("unreachable");

  return value;
}

function isSeq(_value: number): _value is Seq {
  return true;
}

export function asSeq(value: number): Seq {
  if (!isSeq(value)) throw new Error("unreachable");

  return value;
}
