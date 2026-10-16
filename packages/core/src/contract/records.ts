import {
  AuthorityType,
  BatchOutcomeType,
  CommitBodyType,
  compile,
  ConfigurationType,
  cyclicWithJson,
  FileChangeType,
  HeadInfoType,
  idSchema,
  JsonObjectType,
  JsonType,
  MoveOutcomeType,
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
} from "@nyte-ai/schema";
import type {
  BatchOutcome,
  CommitBody,
  Configuration,
  FileChange,
  HeadInfo,
  Json,
  MoveOutcome,
  PartStatus,
  Placement,
  Position,
  PromptOverride,
  RunEnd,
  RunView,
  ToolOutcome,
  Usage,
  WaitOutcome,
  WaitTarget,
  WorkspaceTarget,
} from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Static, TProperties, TSchema, TUnsafe } from "typebox";
import { isJsonObject } from "../util/json-schema.ts";
import type { SendReceipt } from "./session.ts";

const WaitTargetSchema = typed<WaitTarget>()(WaitTargetType);

const HeadRecordType = record({
  name: idSchema<"head">(),
  stack: typed<HeadInfo["stack"]>()(HeadInfoType.properties.stack),
  selected: nullable(typed<Configuration>()(ConfigurationType)),
  lastRun: nullable(
    record({ id: idSchema<"run">(), end: typed<RunEnd>()(RunEndType), endedAt: Type.Number() }),
  ),
});

export type HeadRecord = Static<typeof HeadRecordType>;

const SessionRecordType = record({
  id: idSchema<"session">(),
  name: nullable(Type.String()),
  parent: nullable(idSchema<"session">()),

  origin: nullable(
    record({
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
  heads: list(HeadRecordType),
  prompt: nullable(typed<PromptOverride>()(PromptOverrideType)),
});

export type SessionRecord = Static<typeof SessionRecordType>;

const CommitRecordType = record({
  parent: nullable(idSchema<"commit">()),
  at: Type.Number(),
  run: nullable(idSchema<"run">()),
  body: typed<CommitBody>()(CommitBodyType),
});

export type CommitRecord = Static<typeof CommitRecordType>;

const InboxRecordType = record({
  messages: list(idSchema<"message">()),
  pendingInput: list(idSchema<"message">()),
});

export type InboxRecord = Static<typeof InboxRecordType>;

const ChangesRecordType = record({ files: list(typed<FileChange>()(FileChangeType)) });

type ChangesRecord = Static<typeof ChangesRecordType>;

const RunRecordType = record({
  view: typed<RunView>()(RunViewType),
  phase: Type.Enum(["responding", "executing"]),
  stopping: Type.Boolean(),
  waiting: nullable(WaitTargetSchema),
  retrying: nullable(record({ until: Type.Number(), reason: Type.String() })),
  snapshot: nullable(idSchema<"snapshot">()),

  lastSnapshot: nullable(idSchema<"snapshot">()),
  usage: nullable(typed<Usage>()(UsageType)),
  requests: Type.Number(),

  waitedBy: list(record({ session: idSchema<"session">(), call: idSchema<"call">() })),

  parked: list(idSchema<"call">()),
});

export type RunRecord = Static<typeof RunRecordType>;

const PartRecordType = record({
  id: idSchema<"part">(),
  partKind: Type.String(),
  placement: typed<Placement>()(PlacementType),
  state: JsonType,
  version: Type.Number(),
  owner: nullable(Type.String()),
  run: nullable(idSchema<"run">()),
  status: typed<PartStatus>()(PartStatusType),
  definition: Type.Optional(
    record({
      state: JsonObjectType,
      actions: Type.Record(
        Type.String(),
        record({ input: JsonObjectType, output: Type.Optional(JsonObjectType) }),
      ),
    }),
  ),
});

export type PartRecord = Static<typeof PartRecordType>;

const RECEIPT = {
  id: idSchema<"receipt">(),
  digest: Type.String(),
};

const ReceiptRecordType = Type.Union([
  record({
    ...RECEIPT,
    kind: Type.Literal("send"),
    outcome: nullable(
      typed<Awaited<ReturnType<SendReceipt["settled"]>>>()(
        Type.Union([
          RunEndType,
          record({ kind: Type.Literal("withdrawn") }),
          Type.Exclude(MoveOutcomeType, Type.Object({ kind: Type.Literal("moved") })),
        ]),
      ),
    ),
  }),
  record({
    ...RECEIPT,
    kind: Type.Literal("move"),
    outcome: nullable(typed<MoveOutcome>()(MoveOutcomeType)),
    move: Type.Optional(
      record({ head: idSchema<"head">(), position: typed<Position>()(PositionType) }),
    ),
  }),
  record({
    ...RECEIPT,
    kind: Type.Literal("batch"),
    outcome: nullable(typed<BatchOutcome>()(BatchOutcomeType)),
  }),
]);

export type ReceiptRecord = Static<typeof ReceiptRecordType>;

const SeenRecordType = record({ commit: nullable(idSchema<"commit">()) });

export type SeenRecord = Static<typeof SeenRecordType>;

const WaitOutcomeRef = Type.Unsafe<WaitOutcome>(Type.Ref("WaitOutcome"));

const CallRecordType = record({
  id: idSchema<"call">(),
  kind: Type.Enum(["tool", "action", "hook"]),
  run: nullable(idSchema<"run">()),
  head: nullable(idSchema<"head">()),
  part: nullable(idSchema<"part">()),
  intent: JsonType,
  memos: Type.Record(Type.String(), JsonType),
  clock: list(Type.Number()),
  waits: list(WaitOutcomeRef),
  waiting: nullable(
    Type.Union([
      WaitTargetSchema,
      record({
        kind: Type.Enum(["any", "all"]),
        targets: list(WaitTargetSchema),
        deadline: Type.Optional(Type.Number()),
        untilInput: Type.Optional(Type.Boolean()),
      }),
    ]),
  ),

  partial: list(nullable(WaitOutcomeRef)),
  nested: Type.Record(Type.String(), typed<ToolOutcome>()(ToolOutcomeType)),
  acquisitions: Type.Record(Type.String(), JsonType),
  result: nullable(JsonType),
  replay: Type.Enum(["safe", "never"]),

  reran: nullable(
    record({ waits: Type.Number(), holder: Type.String(), expiresAt: Type.Number() }),
  ),
});

export type CallRecord = Static<typeof CallRecordType>;

const WorkspaceRecordType = record({
  id: idSchema<"workspace">(),
  target: typed<WorkspaceTarget>()(WorkspaceTargetType),
  identity: idSchema<"environment-identity">(),
  projectResources: Type.Union([Type.Boolean(), Type.Null()]),
  projectSources: list(Type.String()),
  addedBy: idSchema<"principal">(),
  createdAt: Type.Number(),
});

export type WorkspaceRecord = Static<typeof WorkspaceRecordType>;

const PrincipalRecordType = record({
  principals: list(
    record({
      id: idSchema<"principal">(),
      label: Type.String(),
      authority: list(AuthorityType),
      pairedAt: Type.Number(),
      tokenDigest: Type.String(),
    }),
  ),
  codes: list(
    record({
      code: Type.String(),
      authority: list(AuthorityType),
      label: Type.String(),
      expiresAt: Type.Number(),
    }),
  ),
});

export type PrincipalRecord = Static<typeof PrincipalRecordType>;

const LeaseType = record({
  holder: idSchema<"host">(),
  instance: Type.String(),
  expiresAt: Type.Number(),
});

type Lease = Static<typeof LeaseType>;

const HostIdentityType = record({ id: idSchema<"host">(), createdAt: Type.Number() });

export type HostIdentity = Static<typeof HostIdentityType>;

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

/** The schema of every stored record body by envelope kind, `kv` excepted since it holds any JSON. Old stores keep old bodies, so a change here must still decode them or come with a backfill. */
export const STORED_RECORD_TYPES = {
  session: SessionRecordType,
  commit: CommitRecordType,
  inbox: InboxRecordType,
  changes: ChangesRecordType,
  run: RunRecordType,
  part: PartRecordType,
  receipt: ReceiptRecordType,
  seen: SeenRecordType,
  workspace: WorkspaceRecordType,
  lease: LeaseType,
  call: CallRecordType,
  principals: PrincipalRecordType,
  identity: HostIdentityType,
} satisfies Record<Exclude<RecordKind, "kv">, TSchema>;

type Decode<T> = (object: Json | null) => T | null;

export function envelope(kind: RecordKind, body: Json, at: number): Json {
  return { kind, at, body };
}

export const decodeSessionRecord: Decode<SessionRecord> = decoder("session", SessionRecordType);

export const decodeCommitRecord: Decode<CommitRecord> = decoder("commit", CommitRecordType);

export const decodeRunRecord: Decode<RunRecord> = decoder("run", RunRecordType);

export const decodeSeenRecord: Decode<SeenRecord> = decoder("seen", SeenRecordType);

export const decodeInboxRecord: Decode<InboxRecord> = decoder("inbox", InboxRecordType);

export const decodeChangesRecord: Decode<ChangesRecord> = decoder("changes", ChangesRecordType);

export const decodePartRecord: Decode<PartRecord> = decoder("part", PartRecordType);

export const decodeReceiptRecord: Decode<ReceiptRecord> = decoder("receipt", ReceiptRecordType);

export const decodeWorkspaceRecord: Decode<WorkspaceRecord> = decoder(
  "workspace",
  WorkspaceRecordType,
);

export const decodeCallRecord: Decode<CallRecord> = decoder("call", CallRecordType);

export const decodePrincipalRecord: Decode<PrincipalRecord> = decoder(
  "principals",
  PrincipalRecordType,
);

export const decodeLease: Decode<Lease> = decoder("lease", LeaseType);

export const decodeHostIdentity: Decode<HostIdentity> = decoder("identity", HostIdentityType);

export function decodeKvValue(object: Json | null): Json | undefined {
  return isJsonObject(object) && object.kind === "kv" ? object.body : undefined;
}

function decoder<S extends TSchema>(kind: RecordKind, schema: S) {
  const validator = compile(cyclicWithJson({ Root: schema, WaitOutcome: WaitOutcomeType }, "Root"));

  return (object: Json | null) =>
    isJsonObject(object) && object.kind === kind && validator.Check(object.body)
      ? object.body
      : null;
}

function typed<T>() {
  return <S extends TSchema>(schema: [Static<S>] extends [T] ? S : never): TUnsafe<T> =>
    Type.Unsafe<T>(schema);
}

function record<P extends TProperties>(properties: P) {
  return Type.ReadonlyObject(Type.Object(properties));
}

function list<T extends TSchema>(item: T) {
  return Type.Immutable(Type.Array(item));
}

function nullable<T extends TSchema>(schema: T) {
  return Type.Union([schema, Type.Null()]);
}
