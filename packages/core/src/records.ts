import {
  AuthorityType,
  CommitBodyType,
  ConfigurationType,
  FileChangeType,
  HeadInfoType,
  JsonType,
  PartStatusType,
  PlacementType,
  PositionType,
  PromptOverrideType,
  RunEndType,
  RunViewType,
  ToolOutcomeType,
  UsageType,
  WaitOutcomeType,
  WaitTargetType,
  WorkspaceTargetType,
  compile,
  cyclicWithJson,
  idSchema,
} from "@nyte-ai/schema";
import type {
  Authority,
  CallId,
  CommitBody,
  CommitId,
  Configuration,
  EnvironmentIdentity,
  FileChange,
  HeadInfo,
  HeadName,
  HostId,
  Json,
  MessageId,
  PartId,
  PartStatus,
  Placement,
  Position,
  PrincipalId,
  PromptOverride,
  ReceiptId,
  RunEnd,
  RunId,
  RunView,
  SessionId,
  SnapshotId,
  ToolOutcome,
  Usage,
  WaitOutcome,
  WaitTarget,
  WorkspaceId,
  WorkspaceTarget,
} from "@nyte-ai/schema";
import { Type } from "typebox";
import type { TSchema } from "typebox";

/** What `sessions/<id>` holds. */
export type SessionRecord = {
  readonly id: SessionId;
  readonly name: string | null;
  readonly parent: SessionId | null;
  /** The run, head and call that spawned it through a tool; null when a client created it. */
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

/** One head inside a `SessionRecord`. */
export type HeadRecord = {
  readonly name: HeadName;
  readonly stack: HeadInfo["stack"];
  readonly selected: Configuration | null;
  readonly lastRun: { readonly id: RunId; readonly end: RunEnd; readonly endedAt: number } | null;
};

/** What a head ref targets: one commit, whose id is its object id. */
export type CommitRecord = {
  readonly parent: CommitId | null;
  readonly at: number;
  readonly run: RunId | null;
  readonly body: CommitBody;
};

/** What `sessions/<id>/inbox/<head>` holds: the head's admitted inputs, in order, and those among them a move or an edit must not pass (`pending-input`): a user's message that runs, never a child's, job's or shell's, which only wakes the head. */
export type InboxRecord = {
  readonly messages: readonly MessageId[];
  readonly pendingInput: readonly MessageId[];
};

/** What `sessions/<id>/changes` holds: the files the session's runs changed, latest per path in first-seen order. */
export type ChangesRecord = { readonly files: readonly FileChange[] };

/** What `sessions/<id>/runs/<run>` holds while the run is live (`usage` sums every charged request; `requests` counts its `request` events). */
export type RunRecord = {
  readonly view: RunView;
  readonly phase: "responding" | "executing";
  readonly stopping: boolean;
  readonly waiting: WaitTarget | null;
  readonly retrying: {
    readonly until: number;
    readonly reason: string;
  } | null;
  readonly snapshot: SnapshotId | null;
  /** The snapshot after the run's last write-class call: the next one diffs from it. */
  readonly lastSnapshot: SnapshotId | null;
  readonly usage: Usage | null;
  readonly requests: number;
  /** The durable steps parked on this run, each written by its park in the same set as its wait. */
  readonly waitedBy: readonly { readonly session: SessionId; readonly call: CallId }[];
  /** This run's own calls parked on a wait: written by the park, cleared by completion. */
  readonly parked: readonly CallId[];
};

/** What `sessions/<id>/parts/<part>` holds. */
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

/** What `sessions/<id>/receipts/<receipt>` holds; `outcome` is null until settled. A record whose `id` is another receipt's names it: a revise's names its target. A move's pending record, written in the set that moves its head, names the head and position, so its settlement survives a crash. */
export type ReceiptRecord = {
  readonly id: ReceiptId;
  readonly kind: "send" | "move" | "batch";
  readonly digest: string;
  readonly outcome: Json | null;
  readonly move?: { readonly head: HeadName; readonly position: Position };
};

/** What `sessions/<id>/seen/<principal>/<head>` holds: the tip the principal last saw. */
export type SeenRecord = { readonly commit: CommitId | null };

/** What `sessions/<id>/calls/<call>` holds: one durable step and everything it recorded so a re-run replays it. */
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
  /** One outcome slot per target of a pending combination; empty otherwise. */
  readonly partial: readonly (WaitOutcome | null)[];
  readonly nested: Readonly<Record<string, ToolOutcome>>;
  readonly acquisitions: Readonly<Record<string, Json>>;
  readonly result: Json | null;
  readonly replay: "safe" | "never";
  /** The claim on the step's latest re-run: the count of `waits` it started after, the kernel instance holding it and when it lapses, as a lease does; a lapsed claim's step is re-run by another runner. */
  readonly reran: {
    readonly waits: number;
    readonly holder: string;
    readonly expiresAt: number;
  } | null;
};

/** What `workspaces/<id>` holds. */
export type WorkspaceRecord = {
  readonly id: WorkspaceId;
  readonly target: WorkspaceTarget;
  readonly identity: EnvironmentIdentity;
  readonly projectResources: boolean;
  readonly projectSources: readonly string[];
  readonly addedBy: PrincipalId;
  readonly createdAt: number;
};

/** What `host/principals` holds: the paired principals, each with the SHA-256 hex digest of its device token, and the unredeemed pairing codes. */
export type PrincipalRecord = {
  readonly principals: readonly {
    readonly id: PrincipalId;
    readonly label: string;
    readonly authority: readonly Authority[];
    readonly pairedAt: number;
    readonly tokenDigest: string;
  }[];
  readonly codes: readonly {
    readonly code: string;
    readonly authority: readonly Authority[];
    readonly label: string;
    readonly expiresAt: number;
  }[];
};

/** What `sessions/<id>/leases/<head>` holds: the host running the head, the kernel instance within it that holds the lease (`kernel.instance`), and when the lease expires. */
export type Lease = {
  readonly holder: HostId;
  readonly instance: string;
  readonly expiresAt: number;
};

/** What `host/identity` holds: the host's id and when it was first opened. */
export type HostIdentity = {
  readonly id: HostId;
  readonly createdAt: number;
};

export type RecordKind =
  | "session"
  | "commit"
  | "inbox"
  | "changes"
  | "run"
  | "part"
  | "receipt"
  | "seen"
  | "workspace"
  | "lease"
  | "call"
  | "kv"
  | "principals"
  | "identity";

type Decode<T> = (object: Json | null) => T | null;

/** Returns a record in the stored-object envelope. */
export function envelope(kind: RecordKind, body: Json, at: number): Json {
  return { kind, at, body };
}

/** Returns whether a JSON value is an object, not an array or a scalar. */
export function isJsonObject(value: Json | undefined): value is { readonly [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const RetryingType = Type.Object({
  until: Type.Number(),
  reason: Type.String(),
});

const WaitOutcomeRef = Type.Unsafe<WaitOutcome>(Type.Ref("WaitOutcome"));

const WaitingType = Type.Union([
  WaitTargetType,
  Type.Object({
    kind: Type.Enum(["any", "all"]),
    targets: Type.Array(WaitTargetType),
    deadline: Type.Optional(Type.Number()),
    untilInput: Type.Optional(Type.Boolean()),
  }),
]);

export const decodeSessionRecord: Decode<SessionRecord> = decoder(
  "session",
  Type.Object({
    id: idSchema<"session">(),
    name: nullable(Type.String()),
    parent: nullable(idSchema<"session">()),
    origin: nullable(
      Type.Object({
        run: idSchema<"run">(),
        head: idSchema<"head">(),
        call: nullable(idSchema<"call">()),
      }),
    ),
    workspace: idSchema<"workspace">(),
    pinned: Type.Boolean(),
    archived: Type.Boolean(),
    createdAt: Type.Number(),
    lastActivityAt: Type.Number(),
    heads: Type.Array(
      Type.Object({
        name: idSchema<"head">(),
        stack: HeadInfoType.properties.stack,
        selected: nullable(ConfigurationType),
        lastRun: nullable(
          Type.Object({ id: idSchema<"run">(), end: RunEndType, endedAt: Type.Number() }),
        ),
      }),
    ),
    prompt: nullable(PromptOverrideType),
  }),
);

export const decodeCommitRecord: Decode<CommitRecord> = decoder(
  "commit",
  Type.Object({
    parent: nullable(idSchema<"commit">()),
    at: Type.Number(),
    run: nullable(idSchema<"run">()),
    body: CommitBodyType,
  }),
);

export const decodeRunRecord: Decode<RunRecord> = decoder(
  "run",
  Type.Object({
    view: RunViewType,
    phase: Type.Enum(["responding", "executing"]),
    stopping: Type.Boolean(),
    waiting: nullable(WaitTargetType),
    retrying: nullable(RetryingType),
    snapshot: nullable(idSchema<"snapshot">()),
    lastSnapshot: nullable(idSchema<"snapshot">()),
    usage: nullable(UsageType),
    requests: Type.Number(),
    waitedBy: Type.Array(Type.Object({ session: idSchema<"session">(), call: idSchema<"call">() })),
    parked: Type.Array(idSchema<"call">()),
  }),
);

export const decodeSeenRecord: Decode<SeenRecord> = decoder(
  "seen",
  Type.Object({ commit: nullable(idSchema<"commit">()) }),
);

export const decodeInboxRecord: Decode<InboxRecord> = decoder(
  "inbox",
  Type.Object({
    messages: Type.Array(idSchema<"message">()),
    pendingInput: Type.Array(idSchema<"message">()),
  }),
);

export const decodeChangesRecord: Decode<ChangesRecord> = decoder(
  "changes",
  Type.Object({ files: Type.Array(FileChangeType) }),
);

export const decodePartRecord: Decode<PartRecord> = decoder(
  "part",
  Type.Object({
    id: idSchema<"part">(),
    partKind: Type.String(),
    placement: PlacementType,
    state: JsonType,
    version: Type.Number(),
    owner: nullable(Type.String()),
    run: nullable(idSchema<"run">()),
    status: PartStatusType,
  }),
);

export const decodeReceiptRecord: Decode<ReceiptRecord> = decoder(
  "receipt",
  Type.Object({
    id: idSchema<"receipt">(),
    kind: Type.Enum(["send", "move", "batch"]),
    digest: Type.String(),
    outcome: nullable(JsonType),
    move: Type.Optional(Type.Object({ head: idSchema<"head">(), position: PositionType })),
  }),
);

export const decodeWorkspaceRecord: Decode<WorkspaceRecord> = decoder(
  "workspace",
  Type.Object({
    id: idSchema<"workspace">(),
    target: WorkspaceTargetType,
    identity: idSchema<"environment-identity">(),
    projectResources: Type.Boolean(),
    projectSources: Type.Array(Type.String()),
    addedBy: idSchema<"principal">(),
    createdAt: Type.Number(),
  }),
);

export const decodeCallRecord: Decode<CallRecord> = decoder(
  "call",
  Type.Object({
    id: idSchema<"call">(),
    kind: Type.Enum(["tool", "action", "hook"]),
    run: nullable(idSchema<"run">()),
    head: nullable(idSchema<"head">()),
    part: nullable(idSchema<"part">()),
    intent: JsonType,
    memos: Type.Record(Type.String(), JsonType),
    clock: Type.Array(Type.Number()),
    waits: Type.Array(WaitOutcomeRef),
    waiting: nullable(WaitingType),
    partial: Type.Array(nullable(WaitOutcomeRef)),
    nested: Type.Record(Type.String(), ToolOutcomeType),
    acquisitions: Type.Record(Type.String(), JsonType),
    result: nullable(JsonType),
    replay: Type.Enum(["safe", "never"]),
    reran: nullable(
      Type.Object({ waits: Type.Number(), holder: Type.String(), expiresAt: Type.Number() }),
    ),
  }),
);

export const decodePrincipalRecord: Decode<PrincipalRecord> = decoder(
  "principals",
  Type.Object({
    principals: Type.Array(
      Type.Object({
        id: idSchema<"principal">(),
        label: Type.String(),
        authority: Type.Array(AuthorityType),
        pairedAt: Type.Number(),
        tokenDigest: Type.String(),
      }),
    ),
    codes: Type.Array(
      Type.Object({
        code: Type.String(),
        authority: Type.Array(AuthorityType),
        label: Type.String(),
        expiresAt: Type.Number(),
      }),
    ),
  }),
);

export const decodeLease: Decode<Lease> = decoder(
  "lease",
  Type.Object({
    holder: idSchema<"host">(),
    instance: Type.String(),
    expiresAt: Type.Number(),
  }),
);

export const decodeHostIdentity: Decode<HostIdentity> = decoder(
  "identity",
  Type.Object({ id: idSchema<"host">(), createdAt: Type.Number() }),
);

/** Returns the value a stored `kv` object holds (a setting, a plugin's stored value, a sealed secret), or undefined when it holds another record. */
export function decodeKvValue(object: Json | null): Json | undefined {
  return isJsonObject(object) && object.kind === "kv" ? object.body : undefined;
}

/** Returns the decoder of one record kind: the body of an envelope of that kind that its schema accepts, compiled once. */
function decoder<S extends TSchema>(kind: RecordKind, schema: S) {
  const validator = compile(cyclicWithJson({ Root: schema, WaitOutcome: WaitOutcomeType }, "Root"));

  return (object: Json | null) =>
    isJsonObject(object) && object.kind === kind && validator.Check(object.body)
      ? validator.Decode(object.body)
      : null;
}

function nullable<T extends TSchema>(schema: T) {
  return Type.Union([schema, Type.Null()]);
}
