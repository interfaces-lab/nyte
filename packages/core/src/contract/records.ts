import {
  AuthorityType,
  BatchOutcomeType,
  CommitBodyType,
  compile,
  ConfigurationType,
  cyclicWithJson,
  HeadInfoType,
  idSchema,
  JobEndType,
  isJsonObject,
  JsonObjectType,
  JsonType,
  MoveOutcomeType,
  PartStatusType,
  PlacementType,
  PositionType,
  PromptOverrideType,
  RunEndType,
  RunViewType,
  UsageType,
  WaitOutcomeType,
  WaitTargetType,
  WorkspaceTargetType,
  WorktreeIsolationType,
} from "@nyte-ai/schema";
import type {
  BatchOutcome,
  CommitBody,
  Configuration,
  HeadInfo,
  JobEnd,
  Json,
  MoveOutcome,
  PartStatus,
  Placement,
  Position,
  PromptOverride,
  RunEnd,
  RunView,
  Usage,
  WaitOutcome,
  WaitTarget,
  WorkspaceTarget,
  WorktreeIsolation,
} from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Static, TProperties, TSchema, TUnsafe } from "typebox";
import type { SendReceipt } from "./session.ts";

const WaitTargetSchema = typed<WaitTarget>()(WaitTargetType);

const HeadRecordType = record({
  name: idSchema<"head">(),
  stack: typed<HeadInfo["stack"]>()(HeadInfoType.properties.stack),
  selected: nullable(typed<Configuration>()(ConfigurationType)),
  lastRun: nullable(
    record({ id: idSchema<"run">(), end: typed<RunEnd>()(RunEndType), endedAt: Type.Number() }),
  ),
  response: Type.Optional(typed<Usage>()(UsageType)),
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
  response: Type.Optional(typed<Usage>()(UsageType)),

  parked: list(idSchema<"call">()),
  interrupted: Type.Optional(record({ count: Type.Number(), mark: Type.String() })),
  requires: Type.Optional(list(Type.String())),
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
    principal: Type.Optional(idSchema<"principal">()),
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
  kind: Type.Enum(["tool", "action", "hook", "intent"]),
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
  projectSources: list(Type.String()),
  addedBy: idSchema<"principal">(),
  createdAt: Type.Number(),
  isolation: nullable(typed<WorktreeIsolation>()(WorktreeIsolationType)),
});

export type WorkspaceRecord = Static<typeof WorkspaceRecordType>;

const TrustRecordType = record({
  target: typed<WorkspaceTarget>()(WorkspaceTargetType),
  trusted: Type.Boolean(),
});

export type TrustRecord = Static<typeof TrustRecordType>;

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

const ProcessRecordType = record({
  instance: Type.String(),
  holder: idSchema<"host">(),
  label: Type.String(),
  pid: nullable(Type.Number()),
  capabilities: list(Type.String()),
  startedAt: Type.Number(),
});

export type ProcessRecord = Static<typeof ProcessRecordType>;

const JobRecordType = record({
  id: idSchema<"job">(),
  instance: Type.String(),
  workspace: idSchema<"workspace">(),
  session: idSchema<"session">(),
  head: idSchema<"head">(),
  startedBy: nullable(idSchema<"call">()),
  title: Type.String(),
  command: Type.String(),
  startedAt: Type.Number(),
  end: nullable(typed<JobEnd>()(JobEndType)),
  endedAt: nullable(Type.Number()),
});

export type JobRecord = Static<typeof JobRecordType>;

const HostIdentityType = record({ id: idSchema<"host">(), createdAt: Type.Number() });

export type HostIdentity = Static<typeof HostIdentityType>;

export type RecordKind =
  | "session"
  | "commit"
  | "inbox"
  | "run"
  | "part"
  | "receipt"
  | "seen"
  | "workspace"
  | "trust"
  | "lease"
  | "process"
  | "job"
  | "call"
  | "kv"
  | "principals"
  | "identity";

export const STORED_RECORD_TYPES = {
  session: SessionRecordType,
  commit: CommitRecordType,
  inbox: InboxRecordType,
  run: RunRecordType,
  part: PartRecordType,
  receipt: ReceiptRecordType,
  seen: SeenRecordType,
  workspace: WorkspaceRecordType,
  trust: TrustRecordType,
  lease: LeaseType,
  process: ProcessRecordType,
  job: JobRecordType,
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

export const decodePartRecord: Decode<PartRecord> = decoder("part", PartRecordType);

export const decodeReceiptRecord: Decode<ReceiptRecord> = decoder("receipt", ReceiptRecordType);

export const decodeWorkspaceRecord: Decode<WorkspaceRecord> = decoder(
  "workspace",
  WorkspaceRecordType,
);

export const decodeTrustRecord: Decode<TrustRecord> = decoder("trust", TrustRecordType);

export const decodeCallRecord: Decode<CallRecord> = decoder("call", CallRecordType);

export const decodePrincipalRecord: Decode<PrincipalRecord> = decoder(
  "principals",
  PrincipalRecordType,
);

export const decodeLease: Decode<Lease> = decoder("lease", LeaseType);

export const decodeProcessRecord: Decode<ProcessRecord> = decoder("process", ProcessRecordType);

export const decodeJobRecord: Decode<JobRecord> = decoder("job", JobRecordType);

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
