/**
 * Runtime schemas for every type that crosses the wire, one per interface.
 *
 * Inputs are strict (`additionalProperties: false`): a caller that sends a
 * key the operation does not read has a bug, and a `__proto__` key parsed from
 * JSON is an own property this refuses. Outputs are open: a newer server may
 * add a field an older client ignores.
 *
 * `typed<T>()` pins a schema to its interface. It compiles only when every
 * value the schema accepts is assignable to `T`, so a schema that drifts from
 * its type is a build error, not a runtime surprise, in both directions.
 *
 * Built with `typebox` only; never `typebox/compile`. A browser renderer's CSP
 * forbids the code `Compile` evaluates, and `typebox/value` needs none.
 */
import { MODEL_THINKING_LEVELS } from "@nyte-ai/schema";
import type {
  AssistantMessage as AssistantMessageType,
  AssistantMessageDiagnostic as AssistantMessageDiagnosticType,
  DeferredHandle as DeferredHandleType,
  DiagnosticErrorInfo as DiagnosticErrorInfoType,
  ImageContent as ImageContentType,
  JsonValue as JsonValueType,
  Message as MessageType,
  ProviderCheckpointMaterial as ProviderCheckpointMaterialType,
  Skill as SkillType,
  StopReason as StopReasonType,
  TextContent as TextContentType,
  ThinkingContent as ThinkingContentType,
  ToolCall as ToolCallType,
  ToolResultMessage as ToolResultMessageType,
  Usage as UsageType,
  UserMessage as UserMessageType,
} from "@nyte-ai/schema";
import { Type, Unsafe } from "typebox";
import type { Static, TProperties, TSchema, TUnsafe } from "typebox";
import { HeadName } from "./names.ts";
import type {
  Choice as ChoiceType,
  Selection as SelectionType,
  SelectionReply as SelectionReplyType,
} from "./ui.ts";
import type {
  Actor as ActorType,
  Commit as CommitType,
  CommitBody as CommitBodyType,
  ModelRef as ModelRefType,
  RunPhase as RunPhaseType,
  ToolProgress as ToolProgressType,
} from "./kernel.ts";
import type {
  ApplyOutcome as ApplyOutcomeType,
  CommandInfo as CommandInfoType,
  CommandOutcome as CommandOutcomeType,
  PluginCatalog as PluginCatalogType,
  PluginInfo as PluginInfoType,
  SettingChoice as SettingChoiceType,
  SettingInfo as SettingInfoType,
} from "./plugins.ts";
import type {
  ActivationRequirement as ActivationRequirementType,
  AbortOutcome as AbortOutcomeType,
  CancelOutcome as CancelOutcomeType,
  ConfigureOutcome as ConfigureOutcomeType,
  CompactionInfo as CompactionInfoType,
  HeadInfo as HeadInfoType,
  Landing as LandingType,
  MoveOutcome as MoveOutcomeType,
  Page,
  ParkedCall as ParkedCallType,
  PendingItem as PendingItemType,
  RedeliverOutcome as RedeliverOutcomeType,
  ReplyOutcome as ReplyOutcomeType,
  RunConfig as RunConfigType,
  RunInfo as RunInfoType,
  SendReceipt as SendReceiptType,
  SessionEvent as SessionEventType,
  SessionId as SessionIdType,
  SessionInfo as SessionInfoType,
  SessionParent as SessionParentType,
  SessionActivationState as SessionActivationStateType,
  SessionSnapshot as SessionSnapshotType,
} from "./sdk.ts";
import type {
  ContextStatus as ContextStatusType,
  FileChange as FileChangeType,
  ToolTurnPart as ToolTurnPartType,
  Turn as TurnType,
  TurnPart as TurnPartType,
  UserTurnPart as UserTurnPartType,
} from "./views.ts";
import type {
  ModelInfo as ModelInfoType,
  VcsDiff as VcsDiffType,
  VcsStatus as VcsStatusType,
  WorkspaceInfo as WorkspaceInfoType,
} from "./workspace.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** `T` with every `readonly` removed, so a schema's static type (never readonly) can be compared to it. */
type Mutable<T> = T extends string | number | boolean | null | undefined
  ? T
  : T extends readonly [infer Head, ...infer Rest]
    ? [Mutable<Head>, ...Mutable<Rest>]
    : T extends readonly (infer Item)[]
      ? Mutable<Item>[]
      : T extends object
        ? { -readonly [K in keyof T]: Mutable<T[K]> }
        : T;

type Proof<S extends TSchema, T> = [Static<S>] extends [T]
  ? [Mutable<T>] extends [Static<S>]
    ? S
    : never
  : never;

/**
 * Pin a runtime schema to the interface it validates. The argument type
 * collapses to `never` when the schema admits a value that is not a `T`, or
 * refuses a value that is one (readonly aside).
 */
export const typed =
  <T>() =>
  <S extends TSchema>(schema: Proof<S, T>): TUnsafe<T> =>
    Unsafe<T>(schema);

/** An input object: every key named, no other key accepted. */
export const strict = <P extends TProperties>(properties: P) =>
  Type.Object(properties, { additionalProperties: false });

/** An output object: the named keys, extra keys tolerated. */
const open = <P extends TProperties>(properties: P) => Type.Object(properties);

/** An operation input that may be absent altogether. */
export const optional = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Undefined()]);

const nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);

/** An output array. The SDK hands out `readonly` arrays, so the static type says so too. */
export const list = <T extends TSchema>(item: T) => Unsafe<readonly Static<T>[]>(Type.Array(item));

/** A union of string literals whose static type keeps every member. */
const literals = <Values extends string[]>(values: readonly [...Values]) => Type.Enum(values);

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Non-empty is the whole `SessionId` brand invariant, so the check earns the type. */
export const SessionId = Unsafe<SessionIdType>({ type: "string", minLength: 1 });
export const Oid = Type.String({ minLength: 1 });
export const Seq = Type.Integer({ minimum: 0 });
export { HeadName };
export const NonEmptyString = Type.String({ minLength: 1 });
export const ThinkingLevel = Type.Enum(MODEL_THINKING_LEVELS);

/** Any JSON value, including nested. Rejects `undefined` at every depth. */
export const JsonValue = typed<JsonValueType>()(
  Unsafe<JsonValueType>(
    Type.Cyclic(
      {
        json: Type.Union([
          Type.String(),
          Type.Number(),
          Type.Boolean(),
          Type.Null(),
          Type.Array(Type.Ref("json")),
          Type.Record(Type.String(), Type.Ref("json")),
        ]),
      },
      "json",
    ),
  ),
);

// ---------------------------------------------------------------------------
// UI shapes (ui.ts)
// ---------------------------------------------------------------------------

const ChoiceProperties = {
  id: Type.String(),
  label: Type.String(),
  description: Type.Optional(Type.String()),
};

export const Choice = typed<ChoiceType>()(open(ChoiceProperties));

export const Selection = typed<SelectionType>()(
  open({
    title: Type.String(),
    // `minItems: 1` is the tuple's whole invariant, so the check earns the type.
    choices: Unsafe<readonly [ChoiceType, ...ChoiceType[]]>(Type.Array(Choice, { minItems: 1 })),
    multiple: Type.Optional(Type.Literal(true)),
    other: Type.Optional(Type.String()),
  }),
);

export const SelectionReply = typed<SelectionReplyType>()(
  open({ choices: list(Type.String()), other: Type.Optional(Type.String()) }),
);

// ---------------------------------------------------------------------------
// Messages (mirrors @nyte-ai/schema)
// ---------------------------------------------------------------------------

export const TextContent = typed<TextContentType>()(
  open({
    type: Type.Literal("text"),
    text: Type.String(),
    textSignature: Type.Optional(Type.String()),
  }),
);

export const ThinkingContent = typed<ThinkingContentType>()(
  open({
    type: Type.Literal("thinking"),
    thinking: Type.String(),
    thinkingSignature: Type.Optional(Type.String()),
    redacted: Type.Optional(Type.Boolean()),
  }),
);

export const ImageContent = typed<ImageContentType>()(
  open({ type: Type.Literal("image"), data: Type.String(), mimeType: Type.String() }),
);

export const ToolCall = typed<ToolCallType>()(
  open({
    type: Type.Literal("toolCall"),
    id: Type.String(),
    name: Type.String(),
    arguments: Type.Record(Type.String(), Type.Unknown()),
    thoughtSignature: Type.Optional(Type.String()),
    namespace: Type.Optional(Type.String()),
  }),
);

export const Usage = typed<UsageType>()(
  open({
    input: Type.Number(),
    output: Type.Number(),
    cacheRead: Type.Number(),
    cacheWrite: Type.Number(),
    cacheWrite1h: Type.Optional(Type.Number()),
    reasoning: Type.Optional(Type.Number()),
    totalTokens: Type.Number(),
    cost: open({
      input: Type.Number(),
      output: Type.Number(),
      cacheRead: Type.Number(),
      cacheWrite: Type.Number(),
      total: Type.Number(),
    }),
  }),
);

export const StopReason = typed<StopReasonType>()(
  literals(["pending", "stop", "length", "toolUse", "error", "aborted", "deferred"]),
);

export const DeferredHandle = typed<DeferredHandleType>()(
  open({
    provider: Type.String(),
    modelId: Type.String(),
    api: Type.String(),
    id: Type.String(),
    expiresAt: Type.Optional(Type.Number()),
    pollAfterMs: Type.Optional(Type.Number()),
    data: Type.Optional(JsonValue),
  }),
);

export const DiagnosticErrorInfo = typed<DiagnosticErrorInfoType>()(
  open({
    name: Type.Optional(Type.String()),
    message: Type.String(),
    stack: Type.Optional(Type.String()),
    code: Type.Optional(Type.Union([Type.String(), Type.Number()])),
  }),
);

export const AssistantMessageDiagnostic = typed<AssistantMessageDiagnosticType>()(
  open({
    type: Type.String(),
    timestamp: Type.Number(),
    error: Type.Optional(DiagnosticErrorInfo),
    details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  }),
);

/** What a user turn or pending item carries. */
export const UserContent = typed<UserMessageType["content"]>()(
  Type.Union([Type.String(), Type.Array(Type.Union([TextContent, ImageContent]))]),
);

export const UserMessage = typed<UserMessageType>()(
  open({ role: Type.Literal("user"), content: UserContent, timestamp: Type.Number() }),
);

export const AssistantMessage = typed<AssistantMessageType>()(
  open({
    role: Type.Literal("assistant"),
    content: Type.Array(Type.Union([TextContent, ThinkingContent, ToolCall])),
    api: Type.String(),
    provider: Type.String(),
    model: Type.String(),
    responseModel: Type.Optional(Type.String()),
    responseId: Type.Optional(Type.String()),
    diagnostics: Type.Optional(Type.Array(AssistantMessageDiagnostic)),
    usage: Usage,
    stopReason: StopReason,
    deferred: Type.Optional(DeferredHandle),
    errorMessage: Type.Optional(Type.String()),
    rawStopReason: Type.Optional(Type.String()),
    endTurn: Type.Optional(Type.Boolean()),
    timestamp: Type.Number(),
  }),
);

export const ToolResultMessage = typed<ToolResultMessageType>()(
  open({
    role: Type.Literal("toolResult"),
    toolCallId: Type.String(),
    toolName: Type.String(),
    content: Type.Array(Type.Union([TextContent, ImageContent])),
    details: Type.Optional(Type.Unknown()),
    title: Type.Optional(Type.String()),
    usage: Type.Optional(Usage),
    addedToolNames: Type.Optional(Type.Array(Type.String())),
    isError: Type.Boolean(),
    timestamp: Type.Number(),
  }),
);

export const Message = typed<MessageType>()(
  Type.Union([UserMessage, AssistantMessage, ToolResultMessage]),
);

export const ProviderCheckpointMaterial = typed<ProviderCheckpointMaterialType>()(
  open({
    type: Type.Literal("provider"),
    provider: Type.String(),
    api: Type.String(),
    model: Type.String(),
    data: JsonValue,
  }),
);

export const Skill = typed<SkillType>()(
  open({
    name: Type.String(),
    description: Type.String(),
    content: Type.String(),
    filePath: Type.String(),
    disableModelInvocation: Type.Optional(Type.Boolean()),
  }),
);

// ---------------------------------------------------------------------------
// Kernel objects
// ---------------------------------------------------------------------------

export const Actor = typed<ActorType>()(
  open({
    clientId: Type.Optional(Type.String()),
    userId: Type.Optional(Type.String()),
    device: Type.Optional(Type.String()),
  }),
);

export const ModelRef = typed<ModelRefType>()(
  open({ provider: Type.Optional(Type.String()), id: Type.String() }),
);

const CheckpointBody = open({
  kind: Type.Literal("checkpoint"),
  summary: Type.String(),
  retainedTail: Type.Array(Message),
  material: Type.Optional(ProviderCheckpointMaterial),
  tokensBefore: Type.Number(),
  usage: Type.Optional(Usage),
});

const SummaryBody = open({
  kind: Type.Literal("summary"),
  text: Type.String(),
  usage: Type.Optional(Usage),
});

const ConfigBody = open({
  kind: Type.Literal("config"),
  model: Type.Optional(ModelRef),
  thinkingLevel: Type.Optional(Type.String()),
  agent: Type.Optional(Type.String()),
});

const NoteBody = open({
  kind: Type.Literal("note"),
  type: Type.String(),
  data: Type.Optional(JsonValue),
});

const JobFields = {
  id: Type.String(),
  runId: Type.String(),
  callId: Type.String(),
  head: HeadName,
  title: Type.String(),
  mode: literals(["foreground", "background"]),
  state: literals(["running", "completed", "failed", "cancelled", "interrupted"]),
  startedAt: Type.Number(),
  updatedAt: Type.Number(),
  output: Type.String(),
};

/** Strict variants keep childSessionId exclusive to subagent jobs. */
export const JobInfo = Type.Union([
  strict({ ...JobFields, kind: Type.Literal("command") }),
  strict({ ...JobFields, kind: Type.Literal("subagent"), childSessionId: SessionId }),
]);

export const CommitBody = typed<CommitBodyType>()(
  Type.Union([
    open({
      kind: Type.Literal("message"),
      message: Message,
      agent: Type.Optional(Type.String()),
    }),
    open({ kind: Type.Literal("completion"), job: JobInfo }),
    CheckpointBody,
    SummaryBody,
    ConfigBody,
    NoteBody,
  ]),
);

export const Commit = typed<CommitType>()(
  open({
    kind: Type.Literal("commit"),
    parent: nullable(Oid),
    imports: Type.Optional(Type.Array(Oid)),
    change: Type.Optional(Oid),
    run: Type.Optional(Type.String()),
    body: CommitBody,
    at: Type.Number(),
    author: Type.Optional(Actor),
  }),
);

export const RunPhase = typed<RunPhaseType>()(
  Type.Union([
    open({ kind: Type.Literal("respond") }),
    open({ kind: Type.Literal("tools") }),
    open({ kind: Type.Literal("waiting") }),
    open({ kind: Type.Literal("retry"), at: Type.Number(), error: Type.String() }),
    open({ kind: Type.Literal("done") }),
    open({ kind: Type.Literal("aborted") }),
    open({ kind: Type.Literal("failed"), error: Type.String() }),
  ]),
);

export const ToolProgress = typed<ToolProgressType>()(
  open({
    text: Type.String(),
    title: Type.Optional(Type.String()),
    details: Type.Optional(JsonValue),
  }),
);

// ---------------------------------------------------------------------------
// Sessions and runs
// ---------------------------------------------------------------------------

export const ActivationRequirement = typed<ActivationRequirementType>()(
  open({
    kind: Type.Literal("workspace_trust"),
    cwd: Type.String({ minLength: 1 }),
  }),
);

export const SessionActivationState = typed<SessionActivationStateType>()(
  Type.Union([
    open({ kind: Type.Literal("active") }),
    open({ kind: Type.Literal("inactive") }),
    open({
      kind: Type.Literal("requires"),
      requirement: ActivationRequirement,
    }),
  ]),
);

export const RunConfig = typed<RunConfigType>()(
  open({
    model: Type.Optional(ModelRef),
    thinkingLevel: Type.Optional(ThinkingLevel),
    agent: Type.Optional(Type.String()),
  }),
);

export const RunInfo = typed<RunInfoType>()(
  open({
    runId: Type.String(),
    head: HeadName,
    phase: RunPhase,
    startedAt: Type.Number(),
    attempts: Type.Number(),
    config: RunConfig,
    abortRequested: Type.Optional(Type.Literal(true)),
    lease: Type.Optional(open({ owner: Type.String(), expiresAt: Type.Number() })),
  }),
);

export const CompactionInfo = typed<CompactionInfoType>()(
  open({
    id: Type.String(),
    reason: literals(["threshold", "overflow", "manual"]),
    startedAt: Type.Number(),
  }),
);

export const JobActionOutcome = Type.Union([
  open({ kind: Type.Literal("applied") }),
  open({ kind: Type.Literal("not_found") }),
  open({ kind: Type.Literal("finished") }),
]);

export const HeadInfo = typed<HeadInfoType>()(
  open({
    head: HeadName,
    tip: nullable(Oid),
    stack: Type.Optional(open({ parent: HeadName, base: nullable(Oid), stale: Type.Boolean() })),
    run: Type.Optional(RunInfo),
  }),
);

/** Strict: it is also operation input (`sessions.create`). */
export const SessionParent = typed<SessionParentType>()(
  strict({
    sessionId: SessionId,
    runId: Type.String(),
    callId: Type.String(),
    depth: Type.Number(),
  }),
);

export const SessionInfo = typed<SessionInfoType>()(
  open({
    sessionId: SessionId,
    activation: SessionActivationState,
    name: Type.Optional(Type.String()),
    preview: Type.Optional(Type.String()),
    createdAt: Type.Number(),
    lastActivityAt: Type.Number(),
    pinned: Type.Boolean(),
    archived: Type.Boolean(),
    heads: Type.Array(HeadInfo),
    config: RunConfig,
    parent: Type.Optional(SessionParent),
  }),
);

export const SessionPage = typed<Page<SessionInfoType>>()(
  open({ items: Type.Array(SessionInfo), next: Type.Optional(Type.String()) }),
);

export const PendingItem = typed<PendingItemType>()(
  open({
    change: Oid,
    lane: Type.String(),
    at: Type.Number(),
    content: UserContent,
    author: Type.Optional(Actor),
  }),
);

export const ParkedCall = typed<ParkedCallType>()(
  open({
    runId: Type.String(),
    callId: Type.String(),
    waitId: Oid,
    tool: Type.String(),
    args: JsonValue,
    selection: Type.Optional(Selection),
    until: Type.Optional(Type.Number()),
  }),
);

export const UserTurnPart = typed<UserTurnPartType>()(
  open({
    kind: Type.Literal("user"),
    commit: Oid,
    parent: nullable(Oid),
    content: UserContent,
  }),
);

export const ToolTurnPart = typed<ToolTurnPartType>()(
  open({
    kind: Type.Literal("tool"),
    callId: Type.String(),
    toolName: Type.String(),
    args: Type.Optional(JsonValue),
    result: Type.Optional(
      open({
        commit: Oid,
        output: Type.String(),
        details: Type.Optional(JsonValue),
        title: Type.Optional(Type.String()),
        isError: Type.Boolean(),
      }),
    ),
  }),
);

export const TurnPart = typed<TurnPartType>()(
  Type.Union([
    UserTurnPart,
    open({
      kind: Type.Literal("assistant"),
      commit: Oid,
      contentIndex: Type.Number(),
      text: Type.String(),
    }),
    open({
      kind: Type.Literal("thinking"),
      commit: Oid,
      contentIndex: Type.Number(),
      text: Type.String(),
    }),
    ToolTurnPart,
    open({ kind: Type.Literal("note"), commit: Oid, text: Type.String() }),
  ]),
);

export const Turn = typed<TurnType>()(
  Type.Union([
    open({
      kind: Type.Literal("turn"),
      id: Oid,
      parts: Type.Array(TurnPart),
      outcome: literals(["completed", "aborted", "failed"]),
      startedAt: Type.Number(),
      durationMs: Type.Number(),
    }),
    open({
      kind: Type.Literal("checkpoint"),
      commit: Oid,
      at: Type.Number(),
      body: CheckpointBody,
    }),
    open({ kind: Type.Literal("summary"), commit: Oid, at: Type.Number(), body: SummaryBody }),
    open({ kind: Type.Literal("config"), commit: Oid, at: Type.Number(), body: ConfigBody }),
    open({ kind: Type.Literal("note"), commit: Oid, at: Type.Number(), body: NoteBody }),
  ]),
);

export const ContextStatus = typed<ContextStatusType>()(
  open({
    estimatedTokens: Type.Number(),
    lastTurnTokens: Type.Optional(Type.Number()),
    usageTokens: Type.Number(),
    trailingTokens: Type.Number(),
    contextWindow: Type.Number(),
    percent: Type.Optional(Type.Number()),
  }),
);

export const FileChange = typed<FileChangeType>()(
  open({ path: Type.String(), added: Type.Number(), removed: Type.Number(), lastCommit: Oid }),
);

export const SessionSnapshot = typed<SessionSnapshotType>()(
  open({
    seq: Seq,
    session: SessionInfo,
    head: HeadName,
    tip: nullable(Oid),
    config: RunConfig,
    transcript: Type.Array(Turn),
    pending: Type.Array(PendingItem),
    run: Type.Optional(RunInfo),
    compaction: Type.Optional(CompactionInfo),
    parked: Type.Optional(Type.Array(ParkedCall)),
    context: ContextStatus,
  }),
);

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

export const ConfigureOutcome = typed<ConfigureOutcomeType>()(
  Type.Union([
    open({ kind: Type.Literal("queued"), change: Oid }),
    open({ kind: Type.Literal("unknown_model") }),
    open({ kind: Type.Literal("unknown_agent") }),
  ]),
);

export const SendReceipt = typed<SendReceiptType>()(
  Type.Union([
    open({ kind: Type.Literal("queued"), change: Oid }),
    open({ kind: Type.Literal("duplicate"), change: Oid }),
  ]),
);

export const CancelOutcome = typed<CancelOutcomeType>()(
  Type.Union([
    open({ kind: Type.Literal("cancelled") }),
    open({ kind: Type.Literal("landed") }),
    open({ kind: Type.Literal("not_found") }),
  ]),
);

export const RedeliverOutcome = typed<RedeliverOutcomeType>()(
  Type.Union([
    open({ kind: Type.Literal("redelivered"), change: Oid }),
    open({ kind: Type.Literal("unchanged") }),
    open({ kind: Type.Literal("landed") }),
    open({ kind: Type.Literal("not_found") }),
  ]),
);

export const AbortOutcome = typed<AbortOutcomeType>()(
  Type.Union([
    open({ kind: Type.Literal("requested"), runId: Type.String() }),
    open({ kind: Type.Literal("not_running") }),
  ]),
);

export const ReplyOutcome = typed<ReplyOutcomeType>()(
  Type.Union([
    open({ kind: Type.Literal("signalled") }),
    open({ kind: Type.Literal("not_waiting") }),
    open({ kind: Type.Literal("not_found") }),
  ]),
);

/** Only opaque correlation data leaves the summary diagnostic boundary. */
export const SummaryFailure = strict({
  kind: Type.Literal("failed"),
  code: Type.Literal("internal"),
  message: Type.Literal("Internal error"),
  correlationId: NonEmptyString,
});

export const SummaryStoppedFailure = strict({
  kind: Type.Literal("failed"),
  code: literals(["aborted", "nothing_to_compact"]),
  message: Type.Literal("Summary unavailable"),
});

export const InactiveFailure = strict({
  kind: Type.Literal("failed"),
  code: Type.Literal("inactive"),
  message: Type.Literal("Session is not active in this host"),
});

export const CheckpointFailure = Type.Union([
  SummaryFailure,
  InactiveFailure,
  strict({
    kind: Type.Literal("failed"),
    code: literals(["busy", "conflict", "fenced"]),
    message: Type.String(),
  }),
]);

export const MoveOutcome = typed<MoveOutcomeType>()(
  Type.Union([
    open({
      kind: Type.Literal("moved"),
      from: nullable(Oid),
      restored: Type.Optional(open({ commit: Oid, content: UserContent })),
      summary: Type.Optional(Oid),
    }),
    open({ kind: Type.Literal("busy"), run: RunInfo }),
    open({ kind: Type.Literal("moved_since"), tip: nullable(Oid) }),
    open({ kind: Type.Literal("not_found") }),
    SummaryFailure,
    SummaryStoppedFailure,
    InactiveFailure,
  ]),
);

// ---------------------------------------------------------------------------
// Plugins, workspace, provider
// ---------------------------------------------------------------------------

const PluginIdentity = {
  id: Type.String(),
  version: Type.String(),
  source: literals(["builtin", "user", "project", "inline"]),
  path: Type.Optional(Type.String()),
};

export const PluginInfo = typed<PluginInfoType>()(
  Type.Union([
    open({ ...PluginIdentity, status: Type.Literal("active") }),
    open({ ...PluginIdentity, status: Type.Literal("failed"), error: Type.String() }),
  ]),
);

export const SettingChoice = typed<SettingChoiceType>()(
  open({ ...ChoiceProperties, status: Type.Optional(Type.String()) }),
);

export const SettingInfo = typed<SettingInfoType>()(
  open({
    id: Type.String(),
    owner: Type.String(),
    label: Type.String(),
    // `minItems: 1` is the tuple's whole invariant, so the check earns the type.
    choices: Unsafe<readonly [SettingChoiceType, ...SettingChoiceType[]]>(
      Type.Array(SettingChoice, { minItems: 1 }),
    ),
    current: Type.String(),
  }),
);

export const CommandInfo = typed<CommandInfoType>()(
  open({ name: Type.String(), owner: Type.String(), description: Type.String() }),
);

export const PluginCatalog = typed<PluginCatalogType>()(
  open({
    plugins: Type.Array(PluginInfo),
    commands: Type.Array(CommandInfo),
    skills: Type.Array(Skill),
    settings: Type.Array(SettingInfo),
  }),
);

export const CommandOutcome = typed<CommandOutcomeType>()(
  Type.Union([
    open({ kind: Type.Literal("ran"), output: Type.Optional(Type.String()) }),
    open({ kind: Type.Literal("prompt"), prompt: Type.String() }),
    open({ kind: Type.Literal("not_found") }),
    open({ kind: Type.Literal("failed"), message: Type.String() }),
  ]),
);

export const ApplyOutcome = typed<ApplyOutcomeType>()(
  Type.Union([
    open({ kind: Type.Literal("applied") }),
    open({ kind: Type.Literal("not_found") }),
    open({ kind: Type.Literal("invalid_choice") }),
  ]),
);

export const WorkspaceInfo = typed<WorkspaceInfoType>()(
  open({
    path: Type.String(),
    name: Type.String(),
    lastOpenedAt: Type.Number(),
    available: Type.Optional(Type.Boolean()),
  }),
);

export const VcsStatus = typed<VcsStatusType>()(
  open({
    branch: Type.Optional(Type.String()),
    files: Type.Array(
      open({
        path: Type.String(),
        kind: literals(["added", "modified", "deleted", "untracked"]),
      }),
    ),
  }),
);

export const VcsDiff = typed<VcsDiffType>()(open({ path: Type.String(), patch: Type.String() }));

export const ModelInfo = typed<ModelInfoType>()(
  open({
    id: Type.String(),
    provider: Type.String(),
    name: Type.String(),
    contextWindow: Type.Optional(Type.Number()),
  }),
);

export const LanePolicy = open({ lane: Type.String(), lands: literals(["boundary", "idle"]) });

export const Landing = typed<LandingType>()(
  open({ lanes: Type.Array(LanePolicy), drain: literals(["one", "all"]) }),
);

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

const Delta = {
  runId: Type.String(),
  attempt: Type.Number(),
  index: Type.Number(),
  delta: Type.String(),
};

export const SessionEvent = typed<SessionEventType>()(
  Type.Union([
    open({
      seq: Seq,
      kind: Type.Literal("activation_changed"),
      activation: SessionActivationState,
    }),
    open({
      seq: Seq,
      kind: Type.Literal("commit"),
      head: HeadName,
      item: open({ oid: Oid, commit: Commit }),
    }),
    open({
      seq: Seq,
      kind: Type.Literal("head_moved"),
      head: HeadName,
      from: nullable(Oid),
      to: nullable(Oid),
      reason: Type.String(),
      actor: Type.Optional(Actor),
    }),
    open({ seq: Seq, kind: Type.Literal("run"), head: HeadName, run: RunInfo }),
    open({
      seq: Seq,
      kind: Type.Literal("compaction"),
      head: HeadName,
      compaction: nullable(CompactionInfo),
    }),
    open({ seq: Seq, kind: Type.Literal("job"), job: JobInfo }),
    open({ seq: Seq, kind: Type.Literal("queued"), head: HeadName, item: PendingItem }),
    open({ seq: Seq, kind: Type.Literal("landed"), head: HeadName, change: Oid }),
    open({ seq: Seq, kind: Type.Literal("queue_cancelled"), change: Oid }),
    open({
      seq: Seq,
      kind: Type.Literal("effect"),
      runId: Type.String(),
      callId: Type.String(),
      state: literals(["intent", "expired", "signal", "result"]),
      tool: Type.String(),
      args: JsonValue,
    }),
    open({
      seq: Seq,
      kind: Type.Literal("effect"),
      runId: Type.String(),
      callId: Type.String(),
      state: Type.Literal("waiting"),
      waitId: Oid,
      tool: Type.String(),
      args: JsonValue,
      selection: Type.Optional(Selection),
      until: Type.Optional(Type.Number()),
    }),
    open({
      seq: Seq,
      kind: Type.Literal("stack"),
      head: HeadName,
      parent: HeadName,
      base: nullable(Oid),
    }),
    open({
      seq: Seq,
      kind: Type.Literal("fact"),
      key: Type.String(),
      value: Type.Optional(JsonValue),
    }),
    open({ seq: Seq, kind: Type.Literal("deleted") }),
    open({ seq: Seq, kind: Type.Literal("synced") }),
    open({ seq: Seq, kind: Type.Literal("text_delta"), ...Delta }),
    open({ seq: Seq, kind: Type.Literal("reasoning_delta"), ...Delta }),
    open({
      seq: Seq,
      kind: Type.Literal("tool_progress"),
      runId: Type.String(),
      callId: Type.String(),
      progress: ToolProgress,
    }),
    open({
      seq: Seq,
      kind: Type.Literal("diagnostic"),
      level: literals(["info", "warn", "error"]),
      owner: Type.String(),
      message: Type.String(),
    }),
    open({ seq: Seq, kind: Type.Literal("plugins_changed"), plugins: Type.Array(PluginInfo) }),
    open({
      seq: Seq,
      kind: Type.Literal("notification"),
      owner: Type.String(),
      title: Type.Optional(Type.String()),
      message: Type.String(),
      sound: Type.Boolean(),
    }),
    open({ seq: Seq, kind: Type.Literal("status_changed"), items: Type.Array(Type.String()) }),
  ]),
);
