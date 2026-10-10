/** Brands a string as one kind of id. */
export type Id<Name extends string> = string & { readonly __brand: Name };
/** Names a session. */
export type SessionId = Id<"session">;
/** Names a head within a session. */
export type HeadName = Id<"head">;
/** Names a run. */
export type RunId = Id<"run">;
/** Names a tool call. */
export type CallId = Id<"call">;
/** Names a message from admission until it is committed. */
export type MessageId = Id<"message">;
/** Names a turn. */
export type TurnId = Id<"turn">;
/** Names a commit in a session's DAG. */
export type CommitId = Id<"commit">;
/** Names a stored object by its content hash. */
export type ObjectId = Id<"object">;
/** Names a stored blob by its content hash. */
export type BlobId = Id<"blob">;
/** Names a part. */
export type PartId = Id<"part">;
/** Names a durable command's receipt. */
export type ReceiptId = Id<"receipt">;
/** Names a job. */
export type JobId = Id<"job">;
/** Reclaims a pty job after a reconnect. */
export type JobKey = Id<"job-key">;
/** Names a registered workspace. */
export type WorkspaceId = Id<"workspace">;
/** Names a browser page. */
export type PageId = Id<"page">;
/** Names a host. */
export type HostId = Id<"host">;
/** Names a principal: who a connection acts as. */
export type PrincipalId = Id<"principal">;
/** Names a recorded file-tree snapshot. */
export type SnapshotId = Id<"snapshot">;
/** Names a git commit. */
export type GitCommitId = Id<"git-commit">;
/** Names the repository state a git read saw. */
export type GitRevision = Id<"git-revision">;
/** Fingerprints a file's content. */
export type FileVersion = Id<"file-version">;
/** Names a page snapshot's revision. */
export type DocumentRevision = Id<"document-revision">;
/** Names a ref's or a tree's revision; passed back as `expect`. */
export type Revision = Id<"revision">;
/** Names a catalog generation. */
export type CatalogGeneration = Id<"catalog-generation">;
/** Marks where the next page starts. */
export type Cursor = Id<"cursor">;
/** Counts a session's updates: a position in its log. */
export type Seq = number & { readonly __brand: "seq" };

/** Narrows a string to an id of `Name`; ids are minted only through `asId`. */
function isId<Name extends string>(_value: string): _value is Id<Name> {
  return true;
}

/** Brands a string as an id of `Name`. */
export function asId<Name extends string>(value: string): Id<Name> {
  if (!isId<Name>(value)) throw new Error("unreachable");

  return value;
}

/** Narrows a number to a `Seq`; seqs are minted only through `asSeq`. */
function isSeq(_value: number): _value is Seq {
  return true;
}

/** Brands a number as a `Seq`. */
export function asSeq(value: number): Seq {
  if (!isSeq(value)) throw new Error("unreachable");

  return value;
}
