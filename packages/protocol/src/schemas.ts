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
  Failure as FailureType,
  FailureClass as FailureClassType,
  ImageContent as ImageContentType,
  JsonValue as JsonValueType,
  Message as MessageType,
  ProviderCheckpointMaterial as ProviderCheckpointMaterialType,
  Skill as SkillType,
  StopReason as StopReasonType,
  SystemMessage as SystemMessageType,
  TextContent as TextContentType,
  ThinkingContent as ThinkingContentType,
  Tool as ToolType,
  ToolCall as ToolCallType,
  ToolResultMessage as ToolResultMessageType,
  Usage as UsageType,
  UserMessage as UserMessageType,
} from "@nyte-ai/schema";
import { Type, Unsafe } from "typebox";
import { HeadName } from "./names.ts";
import { list, literals, nullable, open, optional, strict, typed } from "./schema-helpers.ts";
import { ToolOutcome, ToolReason, ToolState } from "./tool-state.ts";
import type {
  Choice as ChoiceType,
  Selection as SelectionType,
  SelectionReply as SelectionReplyType,
} from "./ui.ts";
import type {
  Actor as ActorType,
  Commit as CommitType,
  CommitBody as CommitBodyType,
  MessageSource as MessageSourceType,
  ModelRef as ModelRefType,
  RunOrigin as RunOriginType,
  RunPhase as RunPhaseType,
  ToolClass as ToolClassType,
  ToolProgress as ToolProgressType,
  TreeId as TreeIdType,
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
  JobInfo as JobInfoType,
  JobReport as JobReportType,
  MoveOutcome as MoveOutcomeType,
  Page,
  ParkedCall as ParkedCallType,
  PendingItem as PendingItemType,
  RedeliverOutcome as RedeliverOutcomeType,
  ReplyOutcome as ReplyOutcomeType,
  RunConfig as RunConfigType,
  RunDiff as RunDiffType,
  RunInfo as RunInfoType,
  RunRevert as RunRevertType,
  SendReceipt as SendReceiptType,
  SessionEvent as SessionEventType,
  SessionId as SessionIdType,
  SessionInfo as SessionInfoType,
  SessionParent as SessionParentType,
  SessionActivationState as SessionActivationStateType,
  SessionMetadata as SessionMetadataType,
  SessionSnapshot as SessionSnapshotType,
  WorkspaceRef as WorkspaceRefType,
} from "./sdk.ts";
import type {
  ContextStatus as ContextStatusType,
  FileChange as FileChangeType,
  FileDiff as FileDiffType,
  ToolTurnPart as ToolTurnPartType,
  Turn as TurnType,
  TurnPart as TurnPartType,
  TurnToolClass as TurnToolClassType,
  UserTurnPart as UserTurnPartType,
} from "./views.ts";
import type {
  MentionFile as MentionFileType,
  ModelInfo as ModelInfoType,
  ProviderAuthStatus as ProviderAuthStatusType,
  VcsBranchOutcome as VcsBranchOutcomeType,
  VcsCommitOutcome as VcsCommitOutcomeType,
  VcsCommitTarget as VcsCommitTargetType,
  VcsContents as VcsContentsType,
  VcsDiff as VcsDiffType,
  VcsDiscardOutcome as VcsDiscardOutcomeType,
  VcsFile as VcsFileType,
  VcsFileKind as VcsFileKindType,
  VcsHead as VcsHeadType,
  VcsIndexFile as VcsIndexFileType,
  VcsLog as VcsLogType,
  VcsPathsOutcome as VcsPathsOutcomeType,
  VcsPushOutcome as VcsPushOutcomeType,
  VcsRefs as VcsRefsType,
  VcsScope as VcsScopeType,
  VcsSnapshot as VcsSnapshotType,
  VcsWorktreeFile as VcsWorktreeFileType,
  WorkspaceInfo as WorkspaceInfoType,
  WorkspaceSelectInput as WorkspaceSelectInputType,
  WorkspaceSelectOutcome as WorkspaceSelectOutcomeType,
  WorkspaceSelection as WorkspaceSelectionType,
  WorkspaceTarget as WorkspaceTargetType,
} from "./workspace.ts";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Non-empty is the whole `SessionId` brand invariant, so the check earns the type. */
export const SessionId = Unsafe<SessionIdType>({ type: "string", minLength: 1 });

export const Oid = Type.String({ minLength: 1 });

/** A git tree hash, SHA-1 or SHA-256; the pattern is the whole `TreeId` brand invariant. */
export const TreeId = Unsafe<TreeIdType>({
  type: "string",
  pattern: "^([0-9a-f]{40}|[0-9a-f]{64})$",
});

export const Seq = Type.Integer({ minimum: 0 });

export { HeadName };

export { list, optional, strict, typed };

export { ToolOutcome, ToolReason, ToolState };

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

const ToolKind = literals([
  "read",
  "edit",
  "delete",
  "move",
  "search",
  "execute",
  "fetch",
  "think",
  "other",
]);

const GrammarVariants = open({
  openai_lark: Type.Optional(Type.String()),
  openai_regex: Type.Optional(Type.String()),
});

const ConstrainedSamplingConfig = Type.Union([
  open({ type: Type.Literal("json_schema"), strict: literals(["prefer", "require"]) }),
  open({ type: Type.Literal("grammar"), variants: GrammarVariants }),
]);

/** A tool as the model sees it. `parameters` is any JSON Schema object. */
export const Tool = typed<ToolType>()(
  open({
    name: Type.String(),
    description: Type.String(),
    parameters: open({}),
    kind: Type.Optional(ToolKind),
    constrainedSampling: Type.Optional(
      Type.Union([Type.Literal(false), ConstrainedSamplingConfig]),
    ),
  }),
);

export const SystemMessage = typed<SystemMessageType>()(
  open({
    role: Type.Literal("system"),
    content: Type.Union([Type.String(), Type.Array(TextContent)]),
    sections: Type.Optional(Type.Record(Type.String(), nullable(Type.String()))),
    toolsAdded: Type.Optional(Type.Array(Tool)),
    toolsRemoved: Type.Optional(Type.Array(open({ name: Type.String() }))),
    timestamp: Type.Number(),
  }),
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
    structuredContent: Type.Optional(JsonValue),
    title: Type.Optional(Type.String()),
    usage: Type.Optional(Usage),
    addedToolNames: Type.Optional(Type.Array(Type.String())),
    isError: Type.Boolean(),
    timestamp: Type.Number(),
  }),
);

export const Message = typed<MessageType>()(
  Type.Union([SystemMessage, UserMessage, AssistantMessage, ToolResultMessage]),
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

export const MessageSource = typed<MessageSourceType>()(
  strict({ kind: Type.Literal("action"), label: Type.String() }),
);

const CheckpointBody = open({
  kind: Type.Literal("checkpoint"),
  summary: Type.String(),
  retainedTail: Type.Array(Message),
  systemMessage: Type.Optional(SystemMessage),
  material: Type.Optional(ProviderCheckpointMaterial),
  tokensBefore: Type.Number(),
  usage: Type.Optional(Usage),
});

const SummaryBody = open({
  kind: Type.Literal("summary"),
  text: Type.String(),
  usage: Type.Optional(Usage),
});

const UsageBody = open({
  kind: Type.Literal("usage"),
  operation: Type.String(),
  provider: Type.String(),
  model: Type.String(),
  usage: Usage,
  note: Type.Optional(Type.String()),
});

const ConfigBody = open({
  kind: Type.Literal("config"),
  model: Type.Optional(ModelRef),
  thinkingLevel: Type.Optional(Type.String()),
  agent: Type.Optional(Type.String()),
});

const JobEnd = Type.Union([
  open({ kind: Type.Literal("completed") }),
  open({ kind: Type.Literal("failed"), reason: Type.String() }),
  open({ kind: Type.Literal("cancelled") }),
  open({ kind: Type.Literal("interrupted") }),
]);

export const JobInfo = typed<JobInfoType>()(
  open({
    id: Type.String(),
    head: HeadName,
    origin: Type.Union([
      open({ kind: Type.Literal("run"), runId: Type.String(), callId: Type.String() }),
      open({ kind: Type.Literal("user") }),
    ]),
    command: Type.String(),
    output: Type.String(),
    isBackgrounded: Type.Boolean(),
    phase: Type.Union([open({ kind: Type.Literal("running") }), ...JobEnd.anyOf]),
    startedAt: Type.Number(),
    updatedAt: Type.Number(),
  }),
);

const DelegateRequest = Type.Union([
  open({ kind: Type.Literal("commit"), oid: Oid }),
  open({ kind: Type.Literal("change"), oid: Oid }),
]);

export const RunOrigin = typed<RunOriginType>()(
  Type.Union([
    open({ kind: Type.Literal("user") }),
    open({ kind: Type.Literal("continuation"), session: SessionId, request: DelegateRequest }),
  ]),
);

export const JobReport = typed<JobReportType>()(
  Type.Union([
    open({
      kind: Type.Literal("command"),
      id: Type.String(),
      command: Type.String(),
      end: JobEnd,
      output: Type.String(),
    }),
    open({
      kind: Type.Literal("delegate"),
      session: SessionId,
      title: Type.String(),
      request: DelegateRequest,
      end: JobEnd,
      report: Type.Union([
        open({ kind: Type.Literal("text"), text: Type.String(), commit: Oid }),
        open({ kind: Type.Literal("none") }),
      ]),
    }),
  ]),
);

const UserCommitMessageBody = open({
  kind: Type.Literal("message"),
  message: UserMessage,
  agent: Type.Optional(Type.String()),
  source: Type.Optional(MessageSource),
});

const AssistantCommitMessageBody = open({
  kind: Type.Literal("message"),
  message: AssistantMessage,
});

const ToolResultCommitMessageBody = open({
  kind: Type.Literal("message"),
  message: ToolResultMessage,
});

const SystemCommitMessageBody = open({
  kind: Type.Literal("message"),
  message: SystemMessage,
});

export const CommitBody = typed<CommitBodyType>()(
  Type.Union([
    UserCommitMessageBody,
    AssistantCommitMessageBody,
    ToolResultCommitMessageBody,
    SystemCommitMessageBody,
    open({ kind: Type.Literal("completion"), job: JobReport }),
    CheckpointBody,
    SummaryBody,
    UsageBody,
    ConfigBody,
  ]),
);

export const FailureClass = typed<FailureClassType>()(
  Type.Union([
    Type.Literal("rate_limit"),
    Type.Literal("auth"),
    Type.Literal("quota"),
    Type.Literal("context_window"),
    Type.Literal("overloaded"),
    Type.Literal("network"),
    Type.Literal("aborted"),
    Type.Literal("provider"),
    Type.Literal("runner"),
  ]),
);

export const Failure = typed<FailureType>()(
  open({
    class: FailureClass,
    message: Type.String(),
    retryAfterMs: Type.Optional(Type.Number({ minimum: 0 })),
  }),
);

const OneChild = open({ kind: Type.Literal("one"), session: SessionId });

export const TurnToolClass = typed<TurnToolClassType>()(
  Type.Union([
    open({ kind: Type.Literal("file_edit"), path: Type.String() }),
    open({ kind: Type.Literal("file_write"), path: Type.String() }),
    open({
      kind: Type.Literal("file_patch"),
      op: Type.Union([Type.Literal("edit"), Type.Literal("write")]),
      path: Type.String(),
      added: Type.Integer({ minimum: 0 }),
      removed: Type.Integer({ minimum: 0 }),
      patch: Type.String(),
    }),
    open({ kind: Type.Literal("file_read"), path: Type.String() }),
    open({ kind: Type.Literal("list"), path: Type.String() }),
    open({
      kind: Type.Literal("shell"),
      command: Type.String(),
      description: Type.Optional(Type.String()),
      facts: Type.Optional(
        open({
          durationMs: Type.Number({ minimum: 0 }),
          truncated: Type.Boolean(),
          fullOutputPath: Type.Optional(Type.String()),
        }),
      ),
    }),
    open({
      kind: Type.Literal("delegate"),
      role: Type.Literal("create"),
      title: Type.String(),
      target: OneChild,
    }),
    open({
      kind: Type.Literal("delegate"),
      role: literals(["send", "read", "stop"]),
      target: OneChild,
    }),
    open({ kind: Type.Literal("custom"), label: Type.String() }),
  ]),
);

export const ToolClass = typed<ToolClassType>()(
  Type.Union([
    TurnToolClass,
    open({
      kind: Type.Literal("delegate"),
      role: Type.Literal("await"),
      target: open({
        kind: Type.Literal("many"),
        sessions: Unsafe<readonly [SessionIdType, ...SessionIdType[]]>(
          Type.Array(SessionId, { minItems: 1 }),
        ),
        mode: literals(["any", "all"]),
      }),
    }),
  ]),
);

const CommitBase = {
  kind: Type.Literal("commit"),
  parent: nullable(Oid),
  change: Type.Optional(Oid),
  key: Type.Optional(Type.String()),
  run: Type.Optional(Type.String()),
  at: Type.Number(),
  author: Type.Optional(Actor),
};

const CommitStart = Type.Union([
  open({ kind: Type.Literal("none") }),
  open({ kind: Type.Literal("run"), tree: nullable(TreeId) }),
]);

const CommitOutcome = Type.Union([
  open({ kind: Type.Literal("ok") }),
  open({ kind: Type.Literal("failed"), failure: Failure }),
]);

export const Commit = typed<CommitType>()(
  Type.Intersect([
    open(CommitBase),
    Type.Union([
      open({
        body: UserCommitMessageBody,
        start: CommitStart,
        calls: Type.Optional(Type.Never()),
        outcome: Type.Optional(Type.Never()),
        call: Type.Optional(Type.Never()),
        tree: Type.Optional(Type.Never()),
        failure: Type.Optional(Type.Never()),
        imports: Type.Optional(Type.Never()),
      }),
      open({
        body: AssistantCommitMessageBody,
        calls: Type.Record(Type.String(), ToolClass),
        outcome: CommitOutcome,
        start: Type.Optional(Type.Never()),
        call: Type.Optional(Type.Never()),
        tree: Type.Optional(Type.Never()),
        failure: Type.Optional(Type.Never()),
        imports: Type.Optional(Type.Never()),
      }),
      open({
        body: ToolResultCommitMessageBody,
        call: ToolClass,
        tree: nullable(TreeId),
        settlement: Type.Optional(ToolOutcome),
        start: Type.Optional(Type.Never()),
        calls: Type.Optional(Type.Never()),
        outcome: Type.Optional(Type.Never()),
        failure: Type.Optional(Type.Never()),
        imports: Type.Optional(Type.Never()),
      }),
      open({
        body: SystemCommitMessageBody,
        start: Type.Optional(Type.Never()),
        calls: Type.Optional(Type.Never()),
        outcome: Type.Optional(Type.Never()),
        call: Type.Optional(Type.Never()),
        tree: Type.Optional(Type.Never()),
        failure: Type.Optional(Type.Never()),
        imports: Type.Optional(Type.Never()),
      }),
      open({
        body: open({ kind: Type.Literal("completion"), job: JobReport }),
        start: CommitStart,
        calls: Type.Optional(Type.Never()),
        outcome: Type.Optional(Type.Never()),
        call: Type.Optional(Type.Never()),
        tree: Type.Optional(Type.Never()),
        failure: Type.Optional(Type.Never()),
        imports: Type.Optional(Type.Never()),
      }),
      open({
        body: CheckpointBody,
        start: Type.Optional(Type.Never()),
        calls: Type.Optional(Type.Never()),
        outcome: Type.Optional(Type.Never()),
        call: Type.Optional(Type.Never()),
        tree: Type.Optional(Type.Never()),
        failure: Type.Optional(Type.Never()),
        imports: Type.Optional(Type.Never()),
      }),
      open({
        body: SummaryBody,
        imports: Type.Array(Oid),
        start: Type.Optional(Type.Never()),
        calls: Type.Optional(Type.Never()),
        outcome: Type.Optional(Type.Never()),
        call: Type.Optional(Type.Never()),
        tree: Type.Optional(Type.Never()),
        failure: Type.Optional(Type.Never()),
      }),
      open({
        body: UsageBody,
        start: Type.Optional(Type.Never()),
        calls: Type.Optional(Type.Never()),
        outcome: Type.Optional(Type.Never()),
        call: Type.Optional(Type.Never()),
        tree: Type.Optional(Type.Never()),
        failure: Type.Optional(Type.Never()),
        imports: Type.Optional(Type.Never()),
      }),
      open({
        body: ConfigBody,
        start: Type.Optional(Type.Never()),
        calls: Type.Optional(Type.Never()),
        outcome: Type.Optional(Type.Never()),
        call: Type.Optional(Type.Never()),
        tree: Type.Optional(Type.Never()),
        failure: Type.Optional(Type.Never()),
        imports: Type.Optional(Type.Never()),
      }),
    ]),
  ]),
);

export const RunPhase = typed<RunPhaseType>()(
  Type.Union([
    open({ kind: Type.Literal("respond") }),
    open({ kind: Type.Literal("tools") }),
    open({ kind: Type.Literal("waiting") }),
    open({
      kind: Type.Literal("retry"),
      at: Type.Number(),
      retries: Type.Integer({ minimum: 1 }),
      failure: Failure,
    }),
    open({ kind: Type.Literal("done") }),
    open({ kind: Type.Literal("aborted") }),
    open({ kind: Type.Literal("failed"), failure: Failure }),
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

export const WorkspaceRef = typed<WorkspaceRefType>()(
  open({
    kind: Type.String({ minLength: 1 }),
    id: Type.String({ minLength: 1 }),
    cwd: Type.String({ minLength: 1 }),
  }),
);

export const ActivationRequirement = typed<ActivationRequirementType>()(
  Type.Union([
    open({
      kind: Type.Literal("workspace_trust"),
      cwd: Type.String({ minLength: 1 }),
    }),
    open({
      kind: Type.Literal("workspace_unavailable"),
      workspace: WorkspaceRef,
      reason: Type.Union([Type.Literal("unsupported"), Type.Literal("unreachable")]),
    }),
  ]),
);

export const SessionActivationState = typed<SessionActivationStateType>()(
  Type.Union([
    open({ kind: Type.Literal("active") }),
    open({ kind: Type.Literal("inactive") }),
    open({
      kind: Type.Literal("requires"),
      requirement: ActivationRequirement,
    }),
    open({ kind: Type.Literal("failed"), error: Type.String() }),
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
    origin: RunOrigin,
    root: Type.String(),
    phase: RunPhase,
    startedAt: Type.Number(),
    attempts: Type.Number(),
    config: RunConfig,
    abortRequested: Type.Optional(Type.Literal(true)),
    awaitingReply: Type.Optional(Type.Literal(true)),
    question: Type.Optional(Type.String()),
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
    workspace: WorkspaceRef,
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
    delivery: literals(["steer", "next"]),
    at: Type.Number(),
    content: UserContent,
    author: Type.Optional(Actor),
    key: Type.Optional(Type.String()),
    source: Type.Optional(MessageSource),
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
    at: Type.Number(),
    key: Type.Optional(Type.String()),
    source: Type.Optional(MessageSource),
  }),
);

export const ToolTurnPart = typed<ToolTurnPartType>()(
  open({
    kind: Type.Literal("tool"),
    callId: Type.String(),
    at: Type.Number(),
    class: TurnToolClass,
    state: ToolState,
    output: Type.Optional(Type.String()),
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
      at: Type.Number(),
    }),
    open({
      kind: Type.Literal("thinking"),
      commit: Oid,
      contentIndex: Type.Number(),
      text: Type.String(),
      at: Type.Number(),
    }),
    ToolTurnPart,
  ]),
);

export const Turn = typed<TurnType>()(
  Type.Union([
    open({
      kind: Type.Literal("turn"),
      id: Oid,
      run: Type.Union([
        open({ kind: Type.Literal("run"), id: Type.String() }),
        open({ kind: Type.Literal("none") }),
      ]),
      parts: Type.Array(TurnPart),
      failure: Type.Optional(Failure),
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
  open({
    path: Type.String(),
    added: Type.Integer({ minimum: 0 }),
    removed: Type.Integer({ minimum: 0 }),
  }),
);

export const FileDiff = typed<FileDiffType>()(
  Type.Union([
    open({
      path: Type.String(),
      kind: literals(["added", "modified", "deleted"]),
      added: Type.Integer({ minimum: 0 }),
      removed: Type.Integer({ minimum: 0 }),
      patch: Type.String(),
    }),
    open({
      path: Type.String(),
      from: Type.String(),
      kind: Type.Literal("renamed"),
      added: Type.Integer({ minimum: 0 }),
      removed: Type.Integer({ minimum: 0 }),
      patch: Type.String(),
    }),
  ]),
);

const sessionMetadata = {
  session: SessionInfo,
  head: HeadName,
  config: RunConfig,
  context: ContextStatus,
  usage: Usage,
};

export const SessionMetadata = typed<SessionMetadataType>()(open(sessionMetadata));

export const SessionSnapshot = typed<SessionSnapshotType>()(
  open({
    ...sessionMetadata,
    seq: Seq,
    tip: nullable(Oid),
    transcript: Type.Array(Turn),
    pending: Type.Array(PendingItem),
    run: Type.Optional(RunInfo),
    compaction: Type.Optional(CompactionInfo),
    parked: Type.Optional(Type.Array(ParkedCall)),
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

export const RunDiff = typed<RunDiffType>()(
  Type.Union([
    open({ kind: Type.Literal("tree"), from: TreeId, to: TreeId, files: list(FileDiff) }),
    open({ kind: Type.Literal("recorded"), files: list(FileDiff) }),
    open({ kind: Type.Literal("not_found") }),
  ]),
);

export const RunRevert = typed<RunRevertType>()(
  Type.Union([
    open({ kind: Type.Literal("reverted"), files: list(Type.String()) }),
    open({ kind: Type.Literal("busy"), run: RunInfo }),
    open({ kind: Type.Literal("conflict"), paths: list(Type.String()) }),
    open({ kind: Type.Literal("no_tree") }),
    open({ kind: Type.Literal("not_found") }),
    open({ kind: Type.Literal("failed"), reason: Type.String() }),
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
  open({
    name: Type.String(),
    owner: Type.String(),
    description: Type.String(),
    selection: Type.Optional(Type.Union([Type.Literal("run"), Type.Literal("insert")])),
  }),
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

export const WorkspaceSelection = typed<WorkspaceSelectionType>()(
  Type.Union([
    open({ kind: Type.Literal("home") }),
    open({ kind: Type.Literal("project"), workspace: WorkspaceInfo }),
  ]),
);

export const WorkspaceSelectInput = typed<WorkspaceSelectInputType>()(
  Type.Union([
    strict({ kind: Type.Literal("home") }),
    strict({ kind: Type.Literal("project"), path: Type.String() }),
  ]),
);

export const WorkspaceSelectOutcome = typed<WorkspaceSelectOutcomeType>()(
  Type.Union([
    open({ kind: Type.Literal("opened"), selection: WorkspaceSelection }),
    open({ kind: Type.Literal("unavailable"), path: Type.String() }),
    open({ kind: Type.Literal("untrusted"), path: Type.String() }),
    open({ kind: Type.Literal("failed"), message: Type.String() }),
  ]),
);

export const WorkspaceTarget = typed<WorkspaceTargetType>()(
  Type.Union([
    strict({ kind: Type.Literal("workspace") }),
    strict({ kind: Type.Literal("session"), sessionId: SessionId }),
  ]),
);

export const WorkspaceFileDocument = Type.Union([
  strict({
    kind: Type.Literal("text"),
    path: NonEmptyString,
    contents: Type.String(),
    version: NonEmptyString,
  }),
  strict({
    kind: Type.Literal("binary"),
    path: NonEmptyString,
    size: Type.Integer({ minimum: 0 }),
  }),
  strict({
    kind: Type.Literal("too_large"),
    path: NonEmptyString,
    size: Type.Integer({ minimum: 0 }),
  }),
]);

export const WorkspaceFileSaveOutcome = Type.Union([
  open({ kind: Type.Literal("saved"), version: NonEmptyString }),
  open({ kind: Type.Literal("conflict") }),
]);

const workspaceGlobPatterns = Type.Optional(
  Type.Array(Type.String({ minLength: 1, maxLength: 256 }), { maxItems: 20 }),
);

export const WorkspaceSearchSchema = strict({
  query: Type.String({ minLength: 1, maxLength: 1000 }),
  caseSensitive: Type.Optional(Type.Boolean()),
  wholeWord: Type.Optional(Type.Boolean()),
  regex: Type.Optional(Type.Boolean()),
  include: workspaceGlobPatterns,
  exclude: workspaceGlobPatterns,
  maxMatches: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
  drafts: Type.Optional(
    Type.Array(
      strict({
        path: NonEmptyString,
        contents: Type.String({ maxLength: 200_000 }),
      }),
      { maxItems: 10 },
    ),
  ),
});

export const WorkspaceSearchMatch = open({
  line: Type.Integer({ minimum: 1 }),
  column: Type.Integer({ minimum: 1 }),
  length: Type.Integer({ minimum: 0 }),
  snippet: Type.String(),
  snippetColumn: Type.Integer({ minimum: 1 }),
});

const WorkspaceSearchFile = open({
  path: NonEmptyString,
  displayPath: NonEmptyString,
  source: literals(["disk", "draft"]),
  matches: list(WorkspaceSearchMatch),
});

export const WorkspaceSearchResult = open({
  files: list(WorkspaceSearchFile),
  matchCount: Type.Integer({ minimum: 0 }),
  truncated: Type.Boolean(),
  skipped: Type.Null(),
});

export const WorkspaceBlameLine = open({
  line: Type.Integer({ minimum: 1 }),
  originalLine: Type.Integer({ minimum: 1 }),
  commit: NonEmptyString,
  author: Type.String(),
  authorMail: Type.String(),
  authorTime: Type.Integer(),
  summary: Type.String(),
  contents: Type.String(),
  uncommitted: Type.Boolean(),
});

export const WorkspaceBlameResult = Type.Union([
  open({
    kind: Type.Literal("blame"),
    path: NonEmptyString,
    lines: list(WorkspaceBlameLine),
    truncated: Type.Boolean(),
  }),
  open({ kind: Type.Literal("unsupported"), message: Type.String() }),
  open({ kind: Type.Literal("error"), message: Type.String() }),
]);

export const WorkspaceFormatInput = strict({
  path: NonEmptyString,
  contents: Type.String({ maxLength: 2_000_000 }),
  version: NonEmptyString,
});

export const WorkspaceFormatResult = Type.Union([
  open({
    kind: Type.Literal("formatted"),
    contents: Type.String(),
    version: NonEmptyString,
    formatter: literals(["prettier", "biome", "oxfmt"]),
  }),
  open({ kind: Type.Literal("conflict") }),
  open({ kind: Type.Literal("unsupported"), message: Type.String() }),
  open({ kind: Type.Literal("error"), message: Type.String() }),
]);

/** A commit-ish a caller names. A leading `-` would read as a git option. */
export const Revision = Type.String({
  minLength: 1,
  maxLength: 256,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._/^~@{}-]*$",
});

export const VcsScope = typed<VcsScopeType>()(
  Type.Union([
    strict({ kind: Type.Literal("worktree") }),
    strict({ kind: Type.Literal("staged") }),
    strict({ kind: Type.Literal("unstaged") }),
    strict({ kind: Type.Literal("commit"), oid: Revision }),
    strict({ kind: Type.Literal("branch"), base: Revision }),
  ]),
);

const VcsFileKind = typed<VcsFileKindType>()(
  literals(["added", "modified", "deleted", "renamed", "untracked", "conflicted"]),
);

export const VcsFile = typed<VcsFileType>()(
  Type.Union([
    open({
      path: Type.String(),
      kind: literals(["added", "modified", "deleted", "untracked", "conflicted"]),
    }),
    open({ path: Type.String(), kind: Type.Literal("renamed"), from: Type.String() }),
  ]),
);

const VcsIndexFile = typed<VcsIndexFileType>()(
  Type.Union([
    open({
      path: Type.String(),
      kind: literals(["added", "modified", "deleted", "conflicted"]),
    }),
    open({ path: Type.String(), kind: Type.Literal("renamed"), from: Type.String() }),
  ]),
);

const VcsWorktreeFile = typed<VcsWorktreeFileType>()(
  open({
    path: Type.String(),
    kind: literals(["modified", "deleted", "untracked", "conflicted"]),
  }),
);

export const VcsHead = typed<VcsHeadType>()(
  Type.Union([
    open({
      kind: Type.Literal("unborn"),
      branch: Type.String(),
      oid: Type.Optional(Type.Never()),
      upstream: Type.Optional(Type.Never()),
      base: Type.Optional(Type.Never()),
    }),
    open({
      kind: Type.Literal("detached"),
      oid: Revision,
      branch: Type.Optional(Type.Never()),
      upstream: Type.Optional(Type.Never()),
      base: Type.Optional(Type.Never()),
    }),
    open({
      kind: Type.Literal("attached"),
      oid: Revision,
      branch: Type.String(),
      upstream: nullable(
        open({
          name: Type.String(),
          ahead: Type.Integer({ minimum: 0 }),
          behind: Type.Integer({ minimum: 0 }),
        }),
      ),
      base: nullable(open({ name: Type.String(), source: literals(["reflog", "default"]) })),
    }),
  ]),
);

export const VcsSnapshot = typed<VcsSnapshotType>()(
  Type.Union([
    open({ kind: Type.Literal("none") }),
    open({
      kind: Type.Literal("repository"),
      root: Type.String(),
      revision: Type.String(),
      head: VcsHead,
      staged: list(VcsIndexFile),
      unstaged: list(VcsWorktreeFile),
    }),
  ]),
);

export const VcsDiff = typed<VcsDiffType>()(
  Type.Intersect([
    open({ path: Type.String(), status: VcsFileKind }),
    Type.Union([
      open({
        kind: Type.Literal("text"),
        added: Type.Integer({ minimum: 0 }),
        removed: Type.Integer({ minimum: 0 }),
        patch: Type.String(),
        binary: Type.Optional(Type.Never()),
      }),
      open({
        kind: Type.Literal("binary"),
        patch: Type.String(),
        added: Type.Optional(Type.Never()),
        removed: Type.Optional(Type.Never()),
        binary: Type.Optional(Type.Never()),
      }),
    ]),
  ]),
);

const VcsSide = Type.Union([
  open({
    kind: Type.Literal("absent"),
    text: Type.Optional(Type.Never()),
    head: Type.Optional(Type.Never()),
  }),
  open({
    kind: Type.Literal("text"),
    text: Type.String(),
    head: Type.Optional(Type.Never()),
  }),
  open({
    kind: Type.Literal("truncated"),
    head: Type.String(),
    text: Type.Optional(Type.Never()),
  }),
  open({
    kind: Type.Literal("binary"),
    text: Type.Optional(Type.Never()),
    head: Type.Optional(Type.Never()),
  }),
]);

export const VcsContents = typed<VcsContentsType>()(
  open({
    path: Type.String(),
    old: VcsSide,
    new: VcsSide,
    binary: Type.Optional(Type.Never()),
    truncated: Type.Optional(Type.Never()),
  }),
);

export const VcsLog = typed<VcsLogType>()(
  open({
    commits: list(
      open({
        oid: Type.String(),
        subject: Type.String(),
        author: Type.String(),
        committedAt: Type.Number(),
      }),
    ),
    hasMore: Type.Boolean(),
  }),
);

export const VcsRefs = typed<VcsRefsType>()(
  open({ local: list(Type.String()), remote: list(Type.String()) }),
);

export const VcsCommitTarget = typed<VcsCommitTargetType>()(
  Type.Union([
    strict({ kind: Type.Literal("staged") }),
    strict({ kind: Type.Literal("all") }),
    strict({
      kind: Type.Literal("paths"),
      paths: Unsafe<readonly [string, ...string[]]>(
        Type.Array(NonEmptyString, { minItems: 1, maxItems: 1000 }),
      ),
    }),
  ]),
);

const VcsFailed = open({ kind: Type.Literal("failed"), reason: Type.String() });

const VcsStale = open({ kind: Type.Literal("stale") });

export const VcsPathsOutcome = typed<VcsPathsOutcomeType>()(
  Type.Union([
    open({
      kind: Type.Literal("applied"),
      paths: list(Type.String()),
      skipped: list(open({ path: Type.String(), reason: Type.String() })),
    }),
    VcsFailed,
    VcsStale,
  ]),
);

export const VcsDiscardOutcome = typed<VcsDiscardOutcomeType>()(
  Type.Union([VcsPathsOutcome, open({ kind: Type.Literal("busy"), run: RunInfo })]),
);

export const VcsCommitOutcome = typed<VcsCommitOutcomeType>()(
  Type.Union([
    open({ kind: Type.Literal("committed"), oid: Type.String(), summary: Type.String() }),
    open({ kind: Type.Literal("nothing_to_commit") }),
    VcsFailed,
    VcsStale,
  ]),
);

export const VcsBranchOutcome = typed<VcsBranchOutcomeType>()(
  Type.Union([
    open({ kind: Type.Literal("created") }),
    open({ kind: Type.Literal("exists") }),
    open({ kind: Type.Literal("invalid_name"), reason: Type.String() }),
    VcsFailed,
    VcsStale,
  ]),
);

export const VcsPushOutcome = typed<VcsPushOutcomeType>()(
  Type.Union([
    open({ kind: Type.Literal("pushed"), remote: Type.String(), branch: Type.String() }),
    open({ kind: Type.Literal("up_to_date") }),
    open({ kind: Type.Literal("no_upstream"), branch: Type.String() }),
    open({ kind: Type.Literal("rejected"), reason: Type.String() }),
    VcsFailed,
    VcsStale,
  ]),
);

export const MentionFile = typed<MentionFileType>()(
  open({
    path: Type.String(),
    url: Type.String(),
    displayPath: Type.String(),
    label: Type.String(),
  }),
);

export const ModelInfo = typed<ModelInfoType>()(
  open({
    id: Type.String(),
    provider: Type.String(),
    name: Type.String(),
    contextWindow: Type.Number(),
    cost: open({
      input: Type.Number(),
      output: Type.Number(),
      cacheRead: Type.Number(),
      cacheWrite: Type.Number(),
    }),
    thinkingLevels: Type.Array(ThinkingLevel),
  }),
);

export const ProviderAuthStatus = typed<ProviderAuthStatusType>()(
  open({
    model: open({ provider: Type.String(), id: Type.String() }),
    auth: Type.Union([
      open({
        kind: Type.Literal("ready"),
        source: Type.String(),
        detail: Type.Optional(Type.String()),
      }),
      open({
        kind: Type.Literal("unverified"),
        source: Type.String(),
        detail: Type.Optional(Type.String()),
      }),
      open({ kind: Type.Literal("unconfigured"), message: Type.String() }),
      open({ kind: Type.Literal("rejected"), message: Type.String() }),
      open({ kind: Type.Literal("unreachable"), message: Type.String() }),
    ]),
  }),
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
    open({ seq: Seq, kind: Type.Literal("config_queued"), head: HeadName, change: Oid }),
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
