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
  SnapshotId,
  ToolOutcome,
  UserContent,
  WaitOutcome,
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

/** Returns what a head ref targets: one commit in the session's DAG. A commit's id is its object id. */
export type CommitRecord = {
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

/** Returns what `sessions/<id>/runs/<run>` holds while the run is live: its metadata, phase, fence, wait, retry, and the snapshot taken before its first write-class call. */
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
  readonly snapshot: SnapshotId | null;
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

/** Returns what `sessions/<id>/calls/<call>` holds: one durable step (a tool call, a part action or a decide hook), where it runs (`head` null for an action or hook outside a head), its intent and replay policy, and everything it recorded so a re-run replays it: memos by name, clock readings and wait outcomes in call order, nested tool outcomes and acquisitions by key, the whole target it is parked on with one outcome slot per target of a pending combination (`partial`, empty otherwise), and its result once settled. */
export type CallRecord = {
  readonly id: CallId;
  readonly kind: "tool" | "action" | "hook";
  readonly run: RunId | null;
  readonly head: HeadName | null;
  readonly part: PartId | null;
  readonly intent: Json;
  readonly memos: Readonly<Record<string, Json>>;
  readonly clock: readonly number[];
  readonly waits: readonly WaitOutcome[];
  readonly waiting:
    | WaitTarget
    | {
        readonly kind: "any" | "all";
        readonly targets: readonly WaitTarget[];
        readonly deadline?: number;
        readonly untilInput?: boolean;
      }
    | null;
  readonly partial: readonly (WaitOutcome | null)[];
  readonly nested: Readonly<Record<string, ToolOutcome>>;
  readonly acquisitions: Readonly<Record<string, Json>>;
  readonly result: Json | null;
  readonly replay: "safe" | "never";
};

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
  | "workspace"
  | "lease"
  | "call"
  | "kv";

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

/** Returns the inbox record a stored object holds, or null when it holds another record. */
export function decodeInboxRecord(object: Json | null): InboxRecord | null {
  return decode(object, "inbox", isInboxRecord);
}

/** Returns the message record a stored object holds, or null when it holds another record. */
export function decodeMessageRecord(object: Json | null): MessageRecord | null {
  return decode(object, "message", isMessageRecord);
}

/** Returns the part record a stored object holds, or null when it holds another record. */
export function decodePartRecord(object: Json | null): PartRecord | null {
  return decode(object, "part", isPartRecord);
}

/** Returns the receipt record a stored object holds, or null when it holds another record. */
export function decodeReceiptRecord(object: Json | null): ReceiptRecord | null {
  return decode(object, "receipt", isReceiptRecord);
}

/** Returns the workspace record a stored object holds, or null when it holds another record. */
export function decodeWorkspaceRecord(object: Json | null): WorkspaceRecord | null {
  return decode(object, "workspace", isWorkspaceRecord);
}

/** Returns the call record a stored object holds, or null when it holds another record. */
export function decodeCallRecord(object: Json | null): CallRecord | null {
  return decode(object, "call", isCallRecord);
}

/** Returns the value a stored `kv` object holds (a setting, a plugin's stored value, a sealed secret), or undefined when it holds another record. */
export function decodeKvValue(object: Json | null): Json | undefined {
  return isJsonObject(object) && object.kind === "kv" ? object.body : undefined;
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
    (value.parent === null || typeof value.parent === "string") &&
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

function isInboxRecord(value: Json | undefined): value is InboxRecord {
  return (
    isJsonObject(value) &&
    Array.isArray(value.messages) &&
    value.messages.every((message) => typeof message === "string")
  );
}

function isMessageRecord(value: Json | undefined): value is MessageRecord {
  return (
    isJsonObject(value) &&
    typeof value.id === "string" &&
    typeof value.at === "number" &&
    typeof value.delivery === "string" &&
    isJsonObject(value.schedule) &&
    isJsonObject(value.configuration) &&
    typeof value.position === "number"
  );
}

function isPartRecord(value: Json | undefined): value is PartRecord {
  return (
    isJsonObject(value) &&
    typeof value.id === "string" &&
    typeof value.partKind === "string" &&
    isJsonObject(value.placement) &&
    typeof value.version === "number" &&
    isJsonObject(value.status)
  );
}

function isReceiptRecord(value: Json | undefined): value is ReceiptRecord {
  return (
    isJsonObject(value) &&
    typeof value.id === "string" &&
    typeof value.kind === "string" &&
    typeof value.digest === "string" &&
    value.outcome !== undefined
  );
}

function isWorkspaceRecord(value: Json | undefined): value is WorkspaceRecord {
  return (
    isJsonObject(value) &&
    typeof value.id === "string" &&
    isJsonObject(value.target) &&
    typeof value.identity === "string" &&
    typeof value.projectResources === "boolean"
  );
}

function isCallRecord(value: Json | undefined): value is CallRecord {
  return (
    isJsonObject(value) &&
    typeof value.id === "string" &&
    typeof value.kind === "string" &&
    "intent" in value &&
    isJsonObject(value.memos) &&
    Array.isArray(value.clock) &&
    Array.isArray(value.waits) &&
    Array.isArray(value.partial) &&
    isJsonObject(value.nested) &&
    isJsonObject(value.acquisitions) &&
    "result" in value &&
    typeof value.replay === "string"
  );
}
