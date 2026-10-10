import type {
  CallId,
  CommitBody,
  CommitId,
  Configuration,
  Delivery,
  EnvironmentIdentity,
  HeadInfo,
  HeadName,
  Json,
  MessageId,
  MessageSource,
  PartId,
  PartStatus,
  Placement,
  PrincipalId,
  PromptOverride,
  ReceiptId,
  RunEnd,
  RunId,
  RunView,
  Schedule,
  SessionId,
  UserContent,
  WaitTarget,
  WorkspaceId,
  WorkspaceTarget,
} from "@nyte-ai/schema";

/** Returns what `sessions/<id>` holds: identity, lineage, workspace, flags, heads and the session's own prompt. */
export type SessionRecord = {
  readonly id: SessionId;
  readonly name: string | null;
  readonly parent: SessionId | null;
  /** The run, head and call that spawned it through a tool invocation; null when a client created it. */
  readonly origin: {
    readonly run: RunId;
    readonly head: HeadName;
    readonly call: CallId | null;
  } | null;
  readonly workspace: WorkspaceId;
  readonly pinned: boolean;
  readonly archived: boolean;
  readonly createdAt: number;
  readonly lastActivityAt: number;
  readonly heads: readonly HeadRecord[];
  readonly prompt: PromptOverride | null;
};

/** Returns one head inside a `SessionRecord`: its stack, stored selection and how its last run ended. */
export type HeadRecord = {
  readonly name: HeadName;
  readonly stack: HeadInfo["stack"];
  readonly selected: Configuration | null;
  readonly lastRun: { readonly id: RunId; readonly end: RunEnd; readonly endedAt: number } | null;
};

/** Returns what a head ref targets: one commit in the session's DAG. */
export type CommitRecord = {
  readonly id: CommitId;
  readonly parent: CommitId | null;
  readonly at: number;
  readonly run: RunId | null;
  readonly body: CommitBody;
};

/** Returns what `sessions/<id>/inbox/<head>` holds: the head's admitted inputs, in order. */
export type InboxRecord = { readonly messages: readonly MessageId[] };

/** Returns one admitted input: the content-addressed object an inbox names. */
export type MessageRecord = {
  readonly id: MessageId;
  readonly at: number;
  readonly content: UserContent;
  readonly source: MessageSource;
  readonly delivery: Delivery;
  readonly schedule: Schedule;
  readonly covered: boolean;
  readonly configuration: Configuration;
  readonly replaced: { readonly previous: MessageId; readonly stopped: RunId | null } | null;
  readonly position: number;
};

/** Returns what `sessions/<id>/runs/<run>` holds while the run is live: its metadata, phase, fence, wait and retry. */
export type RunRecord = {
  readonly view: RunView;
  readonly phase: "responding" | "executing";
  readonly stopping: boolean;
  readonly waiting: WaitTarget | null;
  readonly retrying: {
    readonly attempt: number;
    readonly until: number;
    readonly reason: string;
  } | null;
};

/** Returns what `sessions/<id>/parts/<part>` holds: the part's kind, placement, current state version and status. */
export type PartRecord = {
  readonly id: PartId;
  readonly partKind: string;
  readonly placement: Placement;
  readonly state: Json;
  readonly version: number;
  readonly owner: string | null;
  readonly run: RunId | null;
  readonly status: PartStatus;
};

/** Returns what `sessions/<id>/receipts/<receipt>` holds: the command's kind, digest and outcome once settled. */
export type ReceiptRecord = {
  readonly id: ReceiptId;
  readonly kind: "send" | "move" | "batch";
  readonly digest: string;
  readonly outcome: Json | null;
};

/** Returns what `sessions/<id>/seen/<principal>/<head>` holds: the tip the principal last saw. */
export type SeenRecord = { readonly commit: CommitId | null };

/** Returns what `workspaces/<id>` holds: the registered workspace without its live fields. */
export type WorkspaceRecord = {
  readonly id: WorkspaceId;
  readonly target: WorkspaceTarget;
  readonly identity: EnvironmentIdentity;
  readonly projectResources: boolean;
  readonly projectSources: readonly string[];
  readonly addedBy: PrincipalId;
  readonly createdAt: number;
};

/** Names the record a stored object's envelope carries. */
export type RecordKind =
  | "session"
  | "commit"
  | "inbox"
  | "message"
  | "run"
  | "part"
  | "receipt"
  | "seen"
  | "workspace";

/** Returns a record in the stored-object envelope `{ kind, parent, at, body }`; `parent` is a commit's parent and null for every other record. */
export function envelope(
  kind: RecordKind,
  body: Json,
  at: number,
  parent: CommitId | null = null,
): Json {
  return { kind, parent, at, body };
}

/** Returns the session record a stored object holds, or null when it holds another record. */
export function decodeSessionRecord(object: Json | null): SessionRecord | null {
  return decode(object, "session", isSessionRecord);
}

/** Returns the commit record a stored object holds, or null when it holds another record. */
export function decodeCommitRecord(object: Json | null): CommitRecord | null {
  return decode(object, "commit", isCommitRecord);
}

/** Returns the run record a stored object holds, or null when it holds another record. */
export function decodeRunRecord(object: Json | null): RunRecord | null {
  return decode(object, "run", isRunRecord);
}

/** Returns the seen record a stored object holds, or null when it holds another record. */
export function decodeSeenRecord(object: Json | null): SeenRecord | null {
  return decode(object, "seen", isSeenRecord);
}

function decode<T extends Json>(
  object: Json | null,
  kind: RecordKind,
  is: (body: Json | undefined) => body is T,
): T | null {
  if (!isJsonObject(object) || object.kind !== kind) return null;
  const body = object.body;

  return is(body) ? body : null;
}

function isJsonObject(value: Json | undefined): value is { readonly [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSessionRecord(value: Json | undefined): value is SessionRecord {
  return (
    isJsonObject(value) &&
    typeof value.id === "string" &&
    typeof value.workspace === "string" &&
    typeof value.pinned === "boolean" &&
    typeof value.archived === "boolean" &&
    typeof value.createdAt === "number" &&
    typeof value.lastActivityAt === "number" &&
    Array.isArray(value.heads)
  );
}

function isCommitRecord(value: Json | undefined): value is CommitRecord {
  return (
    isJsonObject(value) &&
    typeof value.id === "string" &&
    typeof value.at === "number" &&
    isJsonObject(value.body)
  );
}

function isRunRecord(value: Json | undefined): value is RunRecord {
  return (
    isJsonObject(value) &&
    isJsonObject(value.view) &&
    typeof value.phase === "string" &&
    typeof value.stopping === "boolean"
  );
}

function isSeenRecord(value: Json | undefined): value is SeenRecord {
  return isJsonObject(value) && (value.commit === null || typeof value.commit === "string");
}
