import { readFileSync, readdirSync } from "node:fs";
import { Validator } from "@cfworker/json-schema";
import { HasCodec } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  ActivationSchema,
  AddOutcomeSchema,
  AdvanceReportSchema,
  AgentInfoSchema,
  AuthoritySchema,
  AvailabilitySchema,
  BackgroundItemSchema,
  BatchOutcomeSchema,
  BlameViewSchema,
  BlobIdSchema,
  BrowserAdoptInputSchema,
  BrowserListInputSchema,
  BrowserListOutputSchema,
  BrowserOpenInputSchema,
  BrowserWatchInputSchema,
  BrowserWatchOutputSchema,
  CallIdSchema,
  CapabilityWireSchema,
  CatalogGenerationSchema,
  ChangeSetSchema,
  CommandInfoSchema,
  CommandOutcomeSchema,
  CommitBodySchema,
  CommitIdSchema,
  ConfigurationPatchSchema,
  ConfigurationSchema,
  ConfigureOutcomeSchema,
  ConnectionBlobInputSchema,
  ConnectionBlobOutputSchema,
  ConnectionWatchInputSchema,
  ConsoleEntrySchema,
  ContextViewSchema,
  CreateHeadOutcomeSchema,
  CredentialSourceWireSchema,
  CursorSchema,
  DecodedObjectViewSchema,
  DeliverySchema,
  DiffOptionsSchema,
  DocumentRevisionSchema,
  DurableEventSchema,
  EndReasonSchema,
  EnvironmentIdentitySchema,
  ExecutionCoverageSchema,
  ExecutionSchema,
  FailureSchema,
  FileChangeSchema,
  FileDocumentSchema,
  FileEntryViewSchema,
  FileEventSchema,
  FileStatusSchema,
  FileVersionSchema,
  FilesBatchInputSchema,
  FilesBatchOutputSchema,
  FilesBytesInputSchema,
  FilesBytesOutputSchema,
  FilesFindInputSchema,
  FilesFindOutputSchema,
  FilesFormatInputSchema,
  FilesReadInputSchema,
  FilesRemoveInputSchema,
  FilesScanInputSchema,
  FilesSearchInputSchema,
  FilesStatInputSchema,
  FilesStatOutputSchema,
  FilesUploadInputSchema,
  FilesWatchInputSchema,
  FilesWatchOutputSchema,
  FilesWriteInputSchema,
  ForgetOutcomeSchema,
  FormatOutcomeSchema,
  GitBlameInputSchema,
  GitBranchInputSchema,
  GitChangesInputSchema,
  GitCommitIdSchema,
  GitCommitInputSchema,
  GitCommitViewSchema,
  GitContentsInputSchema,
  GitDiscardInputSchema,
  GitFileSideSchema,
  GitFileSidesSchema,
  GitLogInputSchema,
  GitLogOutputSchema,
  GitOutcomeSchema,
  GitPatchesInputSchema,
  GitPushInputSchema,
  GitRefsInputSchema,
  GitRefsViewSchema,
  GitRevisionSchema,
  GitScopeSchema,
  GitStageInputSchema,
  GitStatusInputSchema,
  GitStatusSchema,
  GitUnstageInputSchema,
  GitWatchChangesInputSchema,
  GitWatchInputSchema,
  GitWriteSchema,
  HeadCompactInputSchema,
  HeadCompactOutputSchema,
  HeadConfigureInputSchema,
  HeadHistoryInputSchema,
  HeadHistoryOutputSchema,
  HeadInfoSchema,
  HeadMoveInputSchema,
  HeadMoveOutputSchema,
  HeadNameSchema,
  HeadSendInputSchema,
  HeadSendOutputSchema,
  HeadTreeInputSchema,
  HeadViewInputSchema,
  HeadWatchInputSchema,
  HeadWatchOutputSchema,
  HeadsCreateInputSchema,
  HeadsMergeInputSchema,
  HeadsRemoveInputSchema,
  HostDescriptionSchema,
  HostIdSchema,
  HostViewWireSchema,
  HunkSchema,
  IdentityChallengeSchema,
  IntegrityReportSchema,
  JobCloseInputSchema,
  JobCloseOutputSchema,
  JobEndSchema,
  JobIdSchema,
  JobIdleInputSchema,
  JobIdleOutputSchema,
  JobKeySchema,
  JobOutputInputSchema,
  JobResizeInputSchema,
  JobResizeOutputSchema,
  JobSettledInputSchema,
  JobStateSchema,
  JobStopInputSchema,
  JobStopOutputSchema,
  JobViewSchema,
  JobWriteInputSchema,
  JobWriteOutputSchema,
  JobsListInputSchema,
  JobsListOutputSchema,
  JobsRecoverInputSchema,
  JobsRecoverOutputSchema,
  JobsStartInputSchema,
  JobsStartOutputSchema,
  JobsWatchInputSchema,
  JobsWatchOutputSchema,
  JournalEntrySchema,
  JsonObjectSchema,
  JsonType,
  JsonValueSchema,
  LineStatSchema,
  LoginAnswerInputSchema,
  LoginAnswerOutputSchema,
  LoginMethodSchema,
  LoginStepsInputSchema,
  LoginStepsOutputSchema,
  MergeOutcomeSchema,
  MessageIdSchema,
  MessageSchema,
  MessageSourceSchema,
  ModelCatalogViewSchema,
  ModelInfoSchema,
  ModelRefSchema,
  ModelRequestSchema,
  ModelsListInputSchema,
  ModelsLoginInputSchema,
  ModelsLoginOutputSchema,
  ModelsLogoutInputSchema,
  ModelsLogoutOutputSchema,
  ModelsRefreshInputSchema,
  ModelsRefreshOutputSchema,
  ModelsSetDefaultInputSchema,
  ModelsSetDefaultOutputSchema,
  ModelsVerifyInputSchema,
  ModelsVerifyOutputSchema,
  MoveOptionsSchema,
  MoveOutcomeSchema,
  ObjectIdSchema,
  OutputFrameSchema,
  OutputFrameType,
  PageBackInputSchema,
  PageCaptureInputSchema,
  PageCaptureOutputSchema,
  PageClickInputSchema,
  PageCloseInputSchema,
  PageCloseOutputSchema,
  PageConsoleInputSchema,
  PageConsoleOutputSchema,
  PageEvaluateInputSchema,
  PageEvaluateOutputSchema,
  PageForwardInputSchema,
  PageIdSchema,
  PageInfoSchema,
  PageNavigateInputSchema,
  PageOutcomeSchema,
  PagePressInputSchema,
  PageReloadInputSchema,
  PageScrollInputSchema,
  PageSnapshotInputSchema,
  PageSnapshotSchema,
  PageStopLoadingInputSchema,
  PageTypeInputSchema,
  PageViewInputSchema,
  PageViewSchema,
  PageWaitInputSchema,
  PageWatchInputSchema,
  ParentFilterSchema,
  PartActInputSchema,
  PartActOutputSchema,
  PartAnswerInputSchema,
  PartAnswerOutputSchema,
  PartCloseInputSchema,
  PartCloseOutputSchema,
  PartIdSchema,
  PartStatusSchema,
  PartUpdateInputSchema,
  PartUpdateOutputSchema,
  PartViewSchema,
  PartsCreateInputSchema,
  PartsCreateOutputSchema,
  PatchEntrySchema,
  PatchEventSchema,
  PatchSetWireSchema,
  PlacementSchema,
  PluginCheckReportSchema,
  PluginLoadOutcomeSchema,
  PluginReplacementReportSchema,
  PluginsCheckInputSchema,
  PluginsReplaceInputSchema,
  PositionSchema,
  PrincipalIdSchema,
  PrincipalViewWireSchema,
  PrincipalsListInputSchema,
  PrincipalsListOutputSchema,
  PrincipalsPairInputSchema,
  PrincipalsPairOutputSchema,
  PrincipalsRevokeInputSchema,
  PrincipalsRevokeOutputSchema,
  PromptOverrideSchema,
  PruneReportSchema,
  ReceiptIdSchema,
  ReceiptLandedInputSchema,
  ReceiptLandedOutputSchema,
  ReceiptSettledInputSchema,
  ReceiptStatusInputSchema,
  ReceiptStatusOutputSchema,
  ReceiptStopInputSchema,
  ReceiptStopOutputSchema,
  RefSchema,
  RefUpdateSchema,
  RemoveHeadOutcomeSchema,
  RemoveSessionOutcomeSchema,
  RepairPageSchema,
  RevisionSchema,
  RunEndSchema,
  RunEndType,
  RunIdSchema,
  RunSettledInputSchema,
  RunStopInputSchema,
  RunStopOutputSchema,
  RunViewSchema,
  ScanFrameSchema,
  ScheduleSchema,
  SdkErrorWireSchema,
  SearchFrameSchema,
  SendOptionsSchema,
  SeqSchema,
  SeqType,
  SessionCatalogViewSchema,
  SessionCommandInputSchema,
  SessionEventSchema,
  SessionIdSchema,
  SessionInfoInputSchema,
  SessionInfoSchema,
  SessionInfoType,
  SessionRemoveInputSchema,
  SessionStopInputSchema,
  SessionStopOutputSchema,
  SessionUpdateInputSchema,
  SessionViewSchema,
  SessionsCreateInputSchema,
  SessionsCreateOutputSchema,
  SessionsListInputSchema,
  SessionsListOutputSchema,
  SessionsWatchInputSchema,
  SessionsWatchOutputSchema,
  SetOutcomeSchema,
  SettingInfoSchema,
  SettingOutcomeSchema,
  SettingsApplyInputSchema,
  SkillInfoSchema,
  SnapshotIdSchema,
  SubmissionSchema,
  SubmitDraftSchema,
  ThinkingSchema,
  ToolCallSchema,
  ToolClassSchema,
  ToolContentSchema,
  ToolInfoSchema,
  ToolOutcomeSchema,
  ToolPartStateSchema,
  ToolProgressSchema,
  TreeNodeSchema,
  TreeViewSchema,
  TurnIdSchema,
  TurnInfoSchema,
  UpdateOutcomeSchema,
  UsageSchema,
  UserContentSchema,
  UserStatusSchema,
  ValidationIssueSchema,
  ViewOptionsSchema,
  WaitOutcomeSchema,
  WaitTargetSchema,
  WorkspaceBrowserInputSchema,
  WorkspaceChangesInputSchema,
  WorkspaceFilesInputSchema,
  WorkspaceGitInputSchema,
  WorkspaceIdSchema,
  WorkspaceInfoInputSchema,
  WorkspaceInfoSchema,
  WorkspaceInspectionSchema,
  WorkspacePatchesInputSchema,
  WorkspaceReloadInputSchema,
  WorkspaceReloadOutputSchema,
  WorkspaceTargetSchema,
  WorkspaceUpdateInputSchema,
  WorkspaceUpdateOutputSchema,
  WorkspaceWatchInputSchema,
  WorkspacesAddInputSchema,
  WorkspacesForgetInputSchema,
  WorkspacesInspectInputSchema,
  WorkspacesListInputSchema,
  WorkspacesListOutputSchema,
  WriteOutcomeSchema,
  actOutcomeSchema,
  asId,
  asSeq,
  idSchema,
  isJson,
  pagedSchema,
  stopOutcomeSchema,
} from "../src/index.ts";
import type {
  ActOutcome,
  BackgroundItem,
  Configuration,
  ContextView,
  DurableEvent,
  Execution,
  FileChange,
  HeadInfo,
  Hunk,
  IdentityChallenge,
  Json,
  Message,
  ModelInfo,
  ModelRef,
  Paged,
  PageSnapshot,
  PartStatus,
  PatchEntry,
  RunEnd,
  RunView,
  Schema,
  SendOptions,
  SessionCatalogView,
  SessionEvent,
  SessionId,
  SessionInfo,
  SettingInfo,
  StopOutcome,
  ToolOutcome,
  TurnInfo,
  Usage,
  UserContent,
  ValidationIssue,
  WaitTarget,
} from "../src/index.ts";
import type { Failure } from "../src/model/index.ts";

type Case = {
  readonly schema: Schema<unknown>;
  readonly good: unknown;
  readonly bad: unknown;
  readonly decoded?: unknown;
};

function sample<T>(schema: Schema<T>, good: NoInfer<T>, bad: unknown): Case {
  return { schema, good, bad };
}

function operation(schema: Schema<unknown>, good: unknown, bad: unknown, decoded?: unknown): Case {
  return { schema, good, bad, decoded };
}

function ids(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value.flatMap(ids);
  if (typeof value !== "object" || value === null) return [];

  return Object.entries(value).flatMap(([key, entry]) =>
    key === "$id" && typeof entry === "string" ? [entry] : ids(entry),
  );
}

const session = asId<"session">("s1");
const head = asId<"head">("main");
const run = asId<"run">("r1");
const call = asId<"call">("c1");
const message = asId<"message">("m1");
const turn = asId<"turn">("t1");
const commit = asId<"commit">("k1");
const object = asId<"object">("o1");
const blob = asId<"blob">("b1");
const part = asId<"part">("p1");
const receipt = asId<"receipt">("rc1");
const job = asId<"job">("j1");
const workspace = asId<"workspace">("w1");
const page = asId<"page">("pg1");
const host = asId<"host">("h1");
const principal = asId<"principal">("local");
const snapshot = asId<"snapshot">("sn1");
const gitCommit = asId<"git-commit">("abc123");
const gitRevision = asId<"git-revision">("gr1");
const fileVersion = asId<"file-version">("fv1");
const documentRevision = asId<"document-revision">("dr1");
const revision = asId<"revision">("rv1");
const generation = asId<"catalog-generation">("g1");
const cursor = asId<"cursor">("cur1");
const identity = asId<"environment-identity">("ei1");

const usage: Usage = {
  input: 10,
  output: 5,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: null,
  total: 15,
  cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 },
};
const modelRef: ModelRef = { provider: "anthropic", id: "claude" };
const configuration: Configuration = {
  kind: "exact",
  model: modelRef,
  thinking: "low",
  agent: null,
  settings: { "core/x": { nested: [1, "two", null, true] } },
  settingsVersion: "v1",
};
const runView: RunView = {
  id: run,
  head,
  startedAt: 1,
  attempt: 0,
  configuration,
  origin: { kind: "input", message },
};
const runEnd: RunEnd = { kind: "completed", usage };
const failure: Failure = { class: "network", message: "Offline.", retryAfterMs: 1000 };
const waitTarget: WaitTarget = { kind: "run", session, run, deadline: 5 };
const execution: Execution = { kind: "live", run: runView, phase: "responding", stopping: false };
const issue: ValidationIssue = {
  severity: "error",
  path: ["a", 0],
  message: "Bad.",
  source: { plugin: "p", file: "f.ts", line: 3 },
};
const headInfo: HeadInfo = {
  name: head,
  tip: { kind: "commit", id: commit },
  stack: { parent: head, base: { kind: "start" }, stale: false },
  execution,
  unread: true,
};
const sessionInfo: SessionInfo = {
  id: session,
  name: null,
  parent: null,
  workspace,
  pinned: false,
  archived: false,
  activation: { kind: "unavailable", reason: "unreachable", workspace },
  heads: [headInfo],
  createdAt: 1,
  lastActivityAt: 2,
};
const settingInfo: SettingInfo = {
  id: "core/theme",
  owner: "core",
  scope: "host",
  label: "Theme",
  schema: { enum: ["dark", "light"] },
  choices: [{ value: "dark", label: "Dark", badge: "new" }],
  value: "dark",
  from: "default",
};
const catalog: SessionCatalogView = {
  commands: [
    {
      name: "core/compact",
      owner: "core",
      side: "core",
      title: "Compact",
      description: "Compacts.",
      arguments: { type: "string" },
      category: "context",
      keywords: ["summary"],
    },
  ],
  settings: [settingInfo],
  skills: [{ name: "pdf", owner: "user", description: "Reads PDFs.", location: "/skills/pdf" }],
  agents: [{ id: "review", owner: "user", description: null, model: modelRef, mode: "subagent" }],
  tools: [
    {
      name: "read",
      owner: "environment",
      description: "Reads a file.",
      parameters: { type: "object" },
      output: null,
      exposure: "model",
    },
  ],
};
const contextView: ContextView = { tokens: 100, window: 200000, lastRequest: usage };
const fileChange: FileChange = {
  path: "a.ts",
  status: "renamed",
  added: 1,
  removed: 2,
  from: "b.ts",
};
const toolOutcome: ToolOutcome = {
  kind: "ok",
  content: [
    { kind: "text", text: "done" },
    { kind: "file", blob, mime: "image/png" },
  ],
  output: { rows: 2 },
  parts: [part],
};
const background: BackgroundItem = {
  kind: "job",
  id: "j1",
  title: "npm test",
  state: "working",
  startedBy: call,
};
const userContent: UserContent = [
  { kind: "text", text: "hi" },
  { kind: "file", blob, mime: "image/png", name: "a.png" },
  { kind: "reference", path: "src/a.ts" },
];
const partStatus: PartStatus = { kind: "waiting", run, on: { kind: "part", part } };
const hunk: Hunk = {
  oldStart: 1,
  oldLines: 1,
  newStart: 1,
  newLines: 2,
  header: null,
  lines: [
    { kind: "context", text: "a" },
    { kind: "add", text: "b", noNewline: true },
  ],
};
const patchEntry: PatchEntry = {
  path: "a.ts",
  status: "modified",
  digest: "d1",
  kind: "text",
  added: 1,
  removed: 0,
  hunks: [hunk],
};
const pageSnapshot: PageSnapshot = {
  revision: documentRevision,
  nodes: [{ ref: "e1", role: "button", name: "Go", editable: false, depth: 2 }],
};
const modelInfo: ModelInfo = {
  ref: modelRef,
  name: "Claude",
  reasoning: true,
  thinking: ["off", "high"],
  fast: null,
  contextWindow: 200000,
  compactAt: 160000,
  maxOutput: 64000,
  input: ["text", "image"],
  cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
};
const sendOptions: SendOptions = {
  delivery: "queue",
  replace: message,
  running: "stop",
  abandoned: { summarize: { instructions: "Short." } },
  expect: revision,
  position: { kind: "before", message },
  source: { kind: "user" },
  configuration,
  id: receipt,
};
const userMessage: Message = {
  id: message,
  turn,
  at: 1,
  kind: "user",
  content: "hi",
  source: { kind: "child", session },
  delivery: "steer",
  status: { kind: "landed", commit, run, replaced: { previous: message, stopped: null } },
  siblings: { index: 0, count: 1, ids: [commit] },
};
const partMessage: Message = {
  id: message,
  turn,
  at: 2,
  kind: "part",
  part,
  partKind: "text",
  role: "answer",
  state: { markdown: "Hello.", signature: null },
  version: 3,
  status: { kind: "settled", commit, endedAt: 4 },
};
const touched = { count: 1, paths: ["a.ts"] };
const turnInfo: TurnInfo = {
  id: turn,
  run,
  prompt: message,
  state: { kind: "waiting", on: waitTarget },
  startedAt: 1,
  endedAt: null,
  steps: 2,
  thinkingOnly: false,
  summary: {
    byClass: {
      read: touched,
      list: touched,
      edit: touched,
      shell: touched,
      delegate: touched,
      custom: touched,
    },
    failed: 0,
    stopped: 0,
    added: 1,
    removed: 0,
  },
};

const events = {
  commit: [
    {
      seq: asSeq(1),
      at: 1,
      head,
      kind: "commit",
      id: commit,
      parent: null,
      run,
      body: {
        kind: "user",
        message,
        content: userContent,
        source: { kind: "user" },
        delivery: "steer",
        siblings: [],
      },
    },
    {
      seq: asSeq(2),
      at: 1,
      head,
      kind: "commit",
      id: commit,
      parent: commit,
      run,
      body: { kind: "part", part },
    },
    {
      seq: asSeq(3),
      at: 1,
      head,
      kind: "commit",
      id: commit,
      parent: commit,
      run: null,
      body: { kind: "compaction", part, replaces: [commit] },
    },
  ],
  head: [{ seq: asSeq(4), at: 1, head, kind: "head", from: null, to: commit, reason: "created" }],
  seen: [{ seq: asSeq(5), at: 1, head, kind: "seen", principal, commit: null }],
  input: [
    {
      seq: asSeq(6),
      at: 1,
      head,
      kind: "input",
      message,
      change: "admitted",
      content: "hi",
      source: { kind: "shell" },
      delivery: "attach",
      schedule: { kind: "attached" },
      covered: true,
      configuration,
      replaced: null,
    },
    {
      seq: asSeq(7),
      at: 1,
      head,
      kind: "input",
      message,
      change: "scheduled",
      schedule: { kind: "joined", run },
      position: 0,
    },
    { seq: asSeq(8), at: 1, head, kind: "input", message, change: "landed", commit, run: null },
    { seq: asSeq(9), at: 1, head, kind: "input", message, change: "withdrawn" },
    { seq: asSeq(10), at: 1, head, kind: "input", message, change: "superseded", by: message },
  ],
  run: [
    { seq: asSeq(11), at: 1, head, kind: "run", run, change: "started", view: runView },
    { seq: asSeq(12), at: 1, head, kind: "run", run, change: "phase", phase: "executing" },
    {
      seq: asSeq(13),
      at: 1,
      head,
      kind: "run",
      run,
      change: "waiting",
      on: { kind: "timer", until: 9 },
    },
    {
      seq: asSeq(14),
      at: 1,
      head,
      kind: "run",
      run,
      change: "retrying",
      attempt: 1,
      until: 9,
      reason: "overloaded",
    },
    { seq: asSeq(15), at: 1, head, kind: "run", run, change: "stopping" },
    {
      seq: asSeq(16),
      at: 1,
      head,
      kind: "run",
      run,
      change: "ended",
      end: { kind: "failed", failure },
    },
  ],
  part: [
    {
      seq: asSeq(17),
      at: 1,
      head,
      kind: "part",
      part,
      change: "created",
      partKind: "maps/places",
      placement: { kind: "panel", side: "right" },
      state: { markdown: "", signature: null },
      version: 0,
      run,
      owner: "maps",
    },
    {
      seq: asSeq(18),
      at: 1,
      head,
      kind: "part",
      part,
      change: "updated",
      state: [1, 2],
      version: 1,
    },
    { seq: asSeq(19), at: 1, head, kind: "part", part, change: "settled", commit, endedAt: 3 },
    { seq: asSeq(20), at: 1, head: null, kind: "part", part, change: "failed", failure },
    { seq: asSeq(21), at: 1, head: null, kind: "part", part, change: "closed" },
    { seq: asSeq(21), at: 1, head: null, kind: "part", part, change: "waiting", call },
  ],
  call: [
    {
      seq: asSeq(22),
      at: 1,
      head,
      kind: "call",
      call,
      part,
      change: "intent",
      name: "read",
      args: { path: "a.ts" },
      class: { kind: "read", path: "a.ts" },
    },
    {
      seq: asSeq(23),
      at: 1,
      head,
      kind: "call",
      call,
      part,
      change: "waiting",
      on: { kind: "job", job },
    },
    {
      seq: asSeq(24),
      at: 1,
      head,
      kind: "call",
      call,
      part,
      change: "settled",
      outcome: toolOutcome,
      changes: { added: 1, removed: 0, paths: ["a.ts"] },
    },
  ],
  background: [{ seq: asSeq(25), at: 1, head, kind: "background", item: background }],
  configured: [
    { seq: asSeq(26), at: 1, head, kind: "configured", selected: configuration, effective: null },
  ],
  request: [
    { seq: asSeq(27), at: 1, head, kind: "request", usage, context: contextView, step: "plugin" },
  ],
  changes: [{ seq: asSeq(28), at: 1, head: null, kind: "changes", files: [fileChange] }],
  session: [{ seq: asSeq(29), at: 1, head: null, kind: "session", info: sessionInfo }],
  activation: [
    { seq: asSeq(30), at: 1, head: null, kind: "activation", activation: { kind: "active" } },
  ],
  catalog: [{ seq: asSeq(31), at: 1, head: null, kind: "catalog", catalog }],
} satisfies {
  readonly [Kind in SessionEvent["kind"]]: readonly Extract<
    SessionEvent,
    { readonly kind: Kind }
  >[];
};

const durableEvent: DurableEvent = {
  head,
  kind: "head",
  from: commit,
  to: null,
  reason: "removed",
};

const sessionInput = { session };
const headInput = { session, head };
const workspaceInput = { workspace };
const jobInput = { workspace, job };
const pageInput = { workspace, page };
const pathInput = { workspace, path: "a.ts" };
const workspaceInfo = {
  id: workspace,
  target: { kind: "local", path: "/repo" },
  identity,
  availability: { kind: "available" },
  projectResources: true,
  projectSources: [],
  addedBy: principal,
  sessions: 0,
  writers: [],
};
const jobView = {
  id: job,
  command: "npm test",
  title: "Tests",
  session: null,
  pty: null,
  state: { kind: "running" },
  startedAt: 1,
  endedAt: null,
  tail: "",
};
const pageInfo = { id: page, url: "https://a.b", title: "A", holders: 1 };
const fileEntry = { path: "a.ts", kind: "file", size: 3, version: fileVersion };
const gitCompare = { workspace, scope: { kind: "worktree" }, options: { ignoreWhitespace: true } };
const gitPaths = { workspace, paths: ["a.ts"], options: { expect: gitRevision } };
const settled = { kind: "settled", outcome: runEnd };

const operations = {
  ConnectionWatchInputSchema: operation(ConnectionWatchInputSchema, {}, 1),
  ConnectionBlobInputSchema: operation(ConnectionBlobInputSchema, { id: blob }, {}),
  ConnectionBlobOutputSchema: operation(
    ConnectionBlobOutputSchema,
    "aGk=",
    "not base64!",
    Uint8Array.of(104, 105),
  ),
  ModelsListInputSchema: operation(ModelsListInputSchema, {}, 1),
  ModelsRefreshInputSchema: operation(
    ModelsRefreshInputSchema,
    { provider: "test" },
    { provider: 1 },
  ),
  ModelsRefreshOutputSchema: operation(ModelsRefreshOutputSchema, null, 0),
  ModelsSetDefaultInputSchema: operation(
    ModelsSetDefaultInputSchema,
    { ref: modelRef },
    { ref: { provider: "test" } },
  ),
  ModelsSetDefaultOutputSchema: operation(
    ModelsSetDefaultOutputSchema,
    { kind: "unknown-model" },
    { kind: "unset" },
  ),
  ModelsVerifyInputSchema: operation(ModelsVerifyInputSchema, { provider: "test" }, {}),
  ModelsVerifyOutputSchema: operation(
    ModelsVerifyOutputSchema,
    { kind: "failed", reason: "Expired." },
    { kind: "failed" },
  ),
  ModelsLoginInputSchema: operation(
    ModelsLoginInputSchema,
    { provider: "test", method: { kind: "oauth" } },
    { provider: "test", method: { kind: "device" } },
  ),
  ModelsLoginOutputSchema: operation(ModelsLoginOutputSchema, null, {}),
  ModelsLogoutInputSchema: operation(
    ModelsLogoutInputSchema,
    { provider: "test" },
    { provider: null },
  ),
  ModelsLogoutOutputSchema: operation(ModelsLogoutOutputSchema, null, false),
  LoginStepsInputSchema: operation(LoginStepsInputSchema, { provider: "test" }, {}),
  LoginStepsOutputSchema: operation(
    LoginStepsOutputSchema,
    { kind: "choose", message: "Pick.", options: [{ id: "a", label: "A" }] },
    { kind: "choose", message: "Pick." },
  ),
  LoginAnswerInputSchema: operation(
    LoginAnswerInputSchema,
    { provider: "test", code: "123" },
    { provider: "test" },
  ),
  LoginAnswerOutputSchema: operation(LoginAnswerOutputSchema, null, "done"),
  SettingsApplyInputSchema: operation(
    SettingsApplyInputSchema,
    { id: "core/theme", value: { dark: [true] } },
    { id: "core/theme" },
  ),
  WorkspacesListInputSchema: operation(WorkspacesListInputSchema, {}, 1),
  WorkspacesListOutputSchema: operation(
    WorkspacesListOutputSchema,
    [workspaceInfo],
    [{ id: workspace }],
  ),
  WorkspacesInspectInputSchema: operation(
    WorkspacesInspectInputSchema,
    { target: { kind: "local", path: "/repo" } },
    { target: { kind: "local" } },
  ),
  WorkspacesAddInputSchema: operation(
    WorkspacesAddInputSchema,
    {
      target: { kind: "local", path: "/repo" },
      options: { projectResources: false, expect: { identity } },
    },
    { target: { kind: "local", path: "/repo" }, options: { expect: {} } },
  ),
  WorkspacesForgetInputSchema: operation(WorkspacesForgetInputSchema, { id: workspace }, { id: 1 }),
  SessionsWatchInputSchema: operation(
    SessionsWatchInputSchema,
    { parents: { kind: "roots" }, limit: 50 },
    { parents: { kind: "orphans" } },
  ),
  SessionsWatchOutputSchema: operation(SessionsWatchOutputSchema, [sessionInfo], [{ id: session }]),
  SessionsCreateInputSchema: operation(
    SessionsCreateInputSchema,
    {
      id: session,
      name: "Parser",
      workspace,
      parent: session,
      configuration: { thinking: "high" },
      prompt: { kind: "layer", text: "Be brief.", order: 2 },
    },
    { prompt: { kind: "append", text: "x" } },
  ),
  SessionsCreateOutputSchema: operation(SessionsCreateOutputSchema, sessionInput, {}),
  SessionsListInputSchema: operation(
    SessionsListInputSchema,
    { parents: { kind: "children", session }, cursor, limit: 10 },
    { cursor: 1 },
  ),
  SessionsListOutputSchema: operation(
    SessionsListOutputSchema,
    { items: [sessionInfo], next: null },
    { items: [] },
  ),
  SessionInfoInputSchema: operation(SessionInfoInputSchema, sessionInput, {}),
  SessionUpdateInputSchema: operation(
    SessionUpdateInputSchema,
    { session, patch: { name: null, pinned: true, archived: false, workspace } },
    { session, patch: { pinned: "yes" } },
  ),
  SessionRemoveInputSchema: operation(SessionRemoveInputSchema, sessionInput, { session: null }),
  SessionStopInputSchema: operation(SessionStopInputSchema, sessionInput, {}),
  SessionStopOutputSchema: operation(
    SessionStopOutputSchema,
    { stopped: [run], withdrawn: [message] },
    { stopped: [run] },
  ),
  SessionCommandInputSchema: operation(
    SessionCommandInputSchema,
    { session, name: "core/compact", args: { focus: ["tests"] } },
    { session, args: {} },
  ),
  HeadSendInputSchema: operation(
    HeadSendInputSchema,
    { ...headInput, content: userContent, options: sendOptions },
    { ...headInput, content: 1 },
  ),
  HeadSendOutputSchema: operation(HeadSendOutputSchema, { receipt, message }, { receipt }),
  HeadConfigureInputSchema: operation(
    HeadConfigureInputSchema,
    { ...headInput, patch: { thinking: null } },
    { ...headInput, patch: { thinking: "huge" } },
  ),
  HeadViewInputSchema: operation(
    HeadViewInputSchema,
    { ...headInput, options: { tail: 20 } },
    { session },
  ),
  HeadWatchInputSchema: operation(
    HeadWatchInputSchema,
    { ...headInput, options: { tail: 20 }, after: asSeq(12) },
    { ...headInput, after: -1 },
  ),
  HeadWatchOutputSchema: operation(
    HeadWatchOutputSchema,
    { kind: "revision", head, revision },
    { kind: "revision", head },
  ),
  HeadHistoryInputSchema: operation(
    HeadHistoryInputSchema,
    { ...headInput, before: message, limit: 20 },
    { ...headInput, limit: 20 },
  ),
  HeadHistoryOutputSchema: operation(HeadHistoryOutputSchema, [userMessage], [{ id: message }]),
  HeadTreeInputSchema: operation(HeadTreeInputSchema, headInput, { head }),
  HeadMoveInputSchema: operation(
    HeadMoveInputSchema,
    {
      ...headInput,
      position: { kind: "commit", id: commit },
      options: { running: "stop" },
      id: receipt,
    },
    { ...headInput, position: { kind: "commit" } },
  ),
  HeadMoveOutputSchema: operation(HeadMoveOutputSchema, { receipt }, {}),
  HeadCompactInputSchema: operation(
    HeadCompactInputSchema,
    { ...headInput, instructions: "Keep the plan." },
    { ...headInput, instructions: 1 },
  ),
  HeadCompactOutputSchema: operation(
    HeadCompactOutputSchema,
    { kind: "busy", run },
    { kind: "busy" },
  ),
  HeadsCreateInputSchema: operation(
    HeadsCreateInputSchema,
    { session, name: head, input: { from: { kind: "start" } } },
    { session, input: {} },
  ),
  HeadsMergeInputSchema: operation(
    HeadsMergeInputSchema,
    { session, name: head, options: { expect: revision } },
    { session, name: head, options: { expect: 1 } },
  ),
  HeadsRemoveInputSchema: operation(
    HeadsRemoveInputSchema,
    { session, name: head },
    { name: head },
  ),
  RunStopInputSchema: operation(RunStopInputSchema, { session, run }, { session }),
  RunStopOutputSchema: operation(RunStopOutputSchema, settled, { kind: "settled" }),
  RunSettledInputSchema: operation(RunSettledInputSchema, { session, run }, { run }),
  ReceiptStatusInputSchema: operation(
    ReceiptStatusInputSchema,
    { session: null, receipt },
    { receipt },
  ),
  ReceiptStatusOutputSchema: operation(
    ReceiptStatusOutputSchema,
    { kind: "settled", outcome: { kind: "applied" } },
    { kind: "settled" },
  ),
  ReceiptSettledInputSchema: operation(
    ReceiptSettledInputSchema,
    { session, receipt },
    { session },
  ),
  ReceiptStopInputSchema: operation(
    ReceiptStopInputSchema,
    { session: null, receipt },
    { session: 1, receipt },
  ),
  ReceiptStopOutputSchema: operation(
    ReceiptStopOutputSchema,
    { kind: "requested" },
    { kind: "asked" },
  ),
  ReceiptLandedInputSchema: operation(
    ReceiptLandedInputSchema,
    { session, receipt },
    { session, receipt: null },
  ),
  ReceiptLandedOutputSchema: operation(
    ReceiptLandedOutputSchema,
    { kind: "landed", commit, run, replaced: null },
    { kind: "moved", revision },
  ),
  PartsCreateInputSchema: operation(
    PartsCreateInputSchema,
    {
      session,
      kind: "ask/question",
      input: { state: { title: "Pick" }, placement: { kind: "modal" }, id: part },
    },
    { session, kind: "ask/question", input: { state: null } },
  ),
  PartsCreateOutputSchema: operation(PartsCreateOutputSchema, { part }, { part: 1 }),
  PartUpdateInputSchema: operation(
    PartUpdateInputSchema,
    { session, part, next: { title: "B" } },
    { session, part },
  ),
  PartUpdateOutputSchema: operation(
    PartUpdateOutputSchema,
    { kind: "invalid", issues: [issue] },
    { kind: "invalid" },
  ),
  PartActInputSchema: operation(
    PartActInputSchema,
    { session, part, action: "pick", input: null },
    { session, part, action: "pick" },
  ),
  PartActOutputSchema: operation(PartActOutputSchema, { kind: "ok", output: null }, { kind: "ok" }),
  PartAnswerInputSchema: operation(PartAnswerInputSchema, { session, part }, { part }),
  PartAnswerOutputSchema: operation(
    PartAnswerOutputSchema,
    { action: "pick", input: { choice: "a" } },
    { input: 1 },
  ),
  PartCloseInputSchema: operation(PartCloseInputSchema, { session, part }, { session }),
  PartCloseOutputSchema: operation(PartCloseOutputSchema, null, {}),
  WorkspaceInfoInputSchema: operation(WorkspaceInfoInputSchema, workspaceInput, {}),
  WorkspaceWatchInputSchema: operation(WorkspaceWatchInputSchema, workspaceInput, { workspace: 1 }),
  WorkspaceUpdateInputSchema: operation(
    WorkspaceUpdateInputSchema,
    { workspace, patch: { projectResources: false } },
    { workspace, patch: { projectResources: "no" } },
  ),
  WorkspaceUpdateOutputSchema: operation(
    WorkspaceUpdateOutputSchema,
    { kind: "missing" },
    { kind: "gone" },
  ),
  WorkspaceReloadInputSchema: operation(WorkspaceReloadInputSchema, workspaceInput, {}),
  WorkspaceReloadOutputSchema: operation(WorkspaceReloadOutputSchema, { kind: "updated" }, {}),
  WorkspaceChangesInputSchema: operation(
    WorkspaceChangesInputSchema,
    { workspace, run },
    { workspace },
  ),
  WorkspacePatchesInputSchema: operation(
    WorkspacePatchesInputSchema,
    { workspace, run, paths: ["a.ts"], options: { ignoreWhitespace: false } },
    { workspace, run, paths: "a.ts" },
  ),
  WorkspaceFilesInputSchema: operation(WorkspaceFilesInputSchema, workspaceInput, {}),
  WorkspaceGitInputSchema: operation(WorkspaceGitInputSchema, workspaceInput, {}),
  WorkspaceBrowserInputSchema: operation(WorkspaceBrowserInputSchema, workspaceInput, {}),
  JobsStartInputSchema: operation(
    JobsStartInputSchema,
    {
      workspace,
      command: "npm test",
      session,
      title: "Tests",
      pty: { columns: 80, rows: 24 },
      id: job,
    },
    { workspace, pty: { columns: 80 } },
  ),
  JobsStartOutputSchema: operation(
    JobsStartOutputSchema,
    { ...jobView, key: asId<"job-key">("jk1") },
    jobView,
  ),
  JobsRecoverInputSchema: operation(
    JobsRecoverInputSchema,
    { workspace, key: asId<"job-key">("jk1") },
    { workspace },
  ),
  JobsRecoverOutputSchema: operation(
    JobsRecoverOutputSchema,
    { kind: "ended", end: { kind: "lost" } },
    { kind: "ended" },
  ),
  JobsListInputSchema: operation(JobsListInputSchema, workspaceInput, {}),
  JobsListOutputSchema: operation(JobsListOutputSchema, [jobView], [{ id: job }]),
  JobsWatchInputSchema: operation(JobsWatchInputSchema, workspaceInput, {}),
  JobsWatchOutputSchema: operation(JobsWatchOutputSchema, [], [1]),
  JobWriteInputSchema: operation(JobWriteInputSchema, jobInput, { workspace }),
  JobWriteOutputSchema: operation(JobWriteOutputSchema, null, 1),
  JobOutputInputSchema: operation(JobOutputInputSchema, jobInput, { job }),
  JobResizeInputSchema: operation(
    JobResizeInputSchema,
    { ...jobInput, size: { columns: 120, rows: 40 } },
    { ...jobInput, size: { columns: 120 } },
  ),
  JobResizeOutputSchema: operation(JobResizeOutputSchema, { kind: "not-pty" }, { kind: "shrunk" }),
  JobIdleInputSchema: operation(JobIdleInputSchema, jobInput, {}),
  JobIdleOutputSchema: operation(JobIdleOutputSchema, true, "yes"),
  JobStopInputSchema: operation(JobStopInputSchema, jobInput, {}),
  JobStopOutputSchema: operation(
    JobStopOutputSchema,
    { kind: "settled", outcome: { kind: "lost" } },
    { kind: "settled" },
  ),
  JobSettledInputSchema: operation(JobSettledInputSchema, jobInput, {}),
  JobCloseInputSchema: operation(JobCloseInputSchema, jobInput, {}),
  JobCloseOutputSchema: operation(JobCloseOutputSchema, null, []),
  FilesReadInputSchema: operation(FilesReadInputSchema, pathInput, { workspace }),
  FilesBytesInputSchema: operation(FilesBytesInputSchema, pathInput, { path: "a.ts" }),
  FilesBytesOutputSchema: operation(FilesBytesOutputSchema, "", "%%", new Uint8Array()),
  FilesStatInputSchema: operation(FilesStatInputSchema, pathInput, {}),
  FilesStatOutputSchema: operation(
    FilesStatOutputSchema,
    { kind: "symlink", size: 4, version: fileVersion, target: "b.ts" },
    { kind: "socket", size: 4, version: fileVersion },
  ),
  FilesWriteInputSchema: operation(
    FilesWriteInputSchema,
    { ...pathInput, options: { expect: "absent", parents: true } },
    { ...pathInput, options: { expect: 1 } },
  ),
  FilesRemoveInputSchema: operation(
    FilesRemoveInputSchema,
    { ...pathInput, options: { expect: fileVersion } },
    { ...pathInput, options: { expect: null } },
  ),
  FilesBatchInputSchema: operation(
    FilesBatchInputSchema,
    {
      workspace,
      id: receipt,
      entries: [
        { kind: "put", path: "a.ts", contents: "x", expect: "absent" },
        { kind: "remove", path: "b.ts", expect: fileVersion },
      ],
    },
    { workspace, entries: [{ kind: "move", path: "a.ts" }] },
  ),
  FilesBatchOutputSchema: operation(FilesBatchOutputSchema, { receipt }, { receipt: null }),
  FilesFormatInputSchema: operation(
    FilesFormatInputSchema,
    { ...pathInput, contents: "x" },
    pathInput,
  ),
  FilesScanInputSchema: operation(
    FilesScanInputSchema,
    { workspace, directory: "src", ignored: "include" },
    { workspace, ignored: "all" },
  ),
  FilesFindInputSchema: operation(
    FilesFindInputSchema,
    { workspace, query: "parser", limit: 5 },
    { workspace },
  ),
  FilesFindOutputSchema: operation(FilesFindOutputSchema, [fileEntry], [{ path: "a.ts" }]),
  FilesSearchInputSchema: operation(
    FilesSearchInputSchema,
    { workspace, query: "TODO" },
    { query: "TODO" },
  ),
  FilesWatchInputSchema: operation(
    FilesWatchInputSchema,
    { workspace, paths: ["src"] },
    { workspace, paths: "src" },
  ),
  FilesWatchOutputSchema: operation(
    FilesWatchOutputSchema,
    [{ path: "a.ts", version: null, kind: "removed" }],
    [{ path: "a.ts", kind: "removed" }],
  ),
  FilesUploadInputSchema: operation(FilesUploadInputSchema, workspaceInput, {}),
  GitStatusInputSchema: operation(GitStatusInputSchema, workspaceInput, {}),
  GitWatchInputSchema: operation(GitWatchInputSchema, workspaceInput, {}),
  GitChangesInputSchema: operation(GitChangesInputSchema, gitCompare, { workspace }),
  GitWatchChangesInputSchema: operation(GitWatchChangesInputSchema, gitCompare, {
    workspace,
    scope: {},
  }),
  GitPatchesInputSchema: operation(
    GitPatchesInputSchema,
    { ...gitCompare, paths: ["a.ts"] },
    gitCompare,
  ),
  GitContentsInputSchema: operation(
    GitContentsInputSchema,
    { ...pathInput, scope: { kind: "staged" } },
    pathInput,
  ),
  GitLogInputSchema: operation(
    GitLogInputSchema,
    { workspace, cursor, limit: 20 },
    { workspace, limit: "20" },
  ),
  GitLogOutputSchema: operation(
    GitLogOutputSchema,
    {
      items: [{ id: gitCommit, subject: "Fix", author: "A", committedAt: 1, parents: [] }],
      next: cursor,
    },
    { items: [], next: 1 },
  ),
  GitRefsInputSchema: operation(GitRefsInputSchema, workspaceInput, {}),
  GitBlameInputSchema: operation(GitBlameInputSchema, pathInput, { workspace }),
  GitStageInputSchema: operation(GitStageInputSchema, gitPaths, { workspace }),
  GitUnstageInputSchema: operation(GitUnstageInputSchema, gitPaths, { workspace, paths: [1] }),
  GitDiscardInputSchema: operation(GitDiscardInputSchema, gitPaths, { paths: [] }),
  GitCommitInputSchema: operation(
    GitCommitInputSchema,
    {
      workspace,
      input: { message: "Fix the parser.", files: ["a.ts"] },
      options: { expect: gitRevision },
    },
    { workspace, input: { message: "Fix.", files: "some" } },
  ),
  GitBranchInputSchema: operation(
    GitBranchInputSchema,
    { workspace, input: { name: "fix", checkout: true } },
    { workspace, input: { name: "fix" } },
  ),
  GitPushInputSchema: operation(
    GitPushInputSchema,
    { workspace, input: { setUpstream: true } },
    { workspace, input: { setUpstream: "yes" } },
  ),
  BrowserOpenInputSchema: operation(
    BrowserOpenInputSchema,
    { workspace, url: "https://a.b", id: "open-1" },
    { workspace, url: 1 },
  ),
  BrowserAdoptInputSchema: operation(
    BrowserAdoptInputSchema,
    { workspace, id: page },
    { workspace },
  ),
  BrowserListInputSchema: operation(BrowserListInputSchema, workspaceInput, {}),
  BrowserListOutputSchema: operation(BrowserListOutputSchema, [pageInfo], [{ id: page }]),
  BrowserWatchInputSchema: operation(BrowserWatchInputSchema, workspaceInput, {}),
  BrowserWatchOutputSchema: operation(BrowserWatchOutputSchema, [], {}),
  PageViewInputSchema: operation(PageViewInputSchema, pageInput, { page }),
  PageWatchInputSchema: operation(PageWatchInputSchema, pageInput, { workspace }),
  PageSnapshotInputSchema: operation(
    PageSnapshotInputSchema,
    { ...pageInput, ref: "e1" },
    { ...pageInput, ref: 1 },
  ),
  PageNavigateInputSchema: operation(
    PageNavigateInputSchema,
    { ...pageInput, url: "https://a.b" },
    pageInput,
  ),
  PageBackInputSchema: operation(PageBackInputSchema, pageInput, {}),
  PageForwardInputSchema: operation(PageForwardInputSchema, pageInput, {}),
  PageReloadInputSchema: operation(PageReloadInputSchema, pageInput, {}),
  PageStopLoadingInputSchema: operation(PageStopLoadingInputSchema, pageInput, {}),
  PageClickInputSchema: operation(
    PageClickInputSchema,
    { ...pageInput, ref: "e1", button: "middle", double: true, expect: documentRevision },
    { ...pageInput, ref: "e1", button: "side" },
  ),
  PageTypeInputSchema: operation(
    PageTypeInputSchema,
    { ...pageInput, ref: "e1", text: "hi", clear: true, submit: false },
    { ...pageInput, ref: "e1" },
  ),
  PagePressInputSchema: operation(PagePressInputSchema, { ...pageInput, key: "Enter" }, pageInput),
  PageScrollInputSchema: operation(
    PageScrollInputSchema,
    { ...pageInput, direction: "bottom", pages: 2 },
    { ...pageInput, direction: "left" },
  ),
  PageWaitInputSchema: operation(
    PageWaitInputSchema,
    { ...pageInput, condition: { kind: "text", text: "Done", present: true } },
    { ...pageInput, condition: { kind: "idle" } },
  ),
  PageConsoleInputSchema: operation(
    PageConsoleInputSchema,
    { ...pageInput, limit: 10, clear: true },
    { ...pageInput, clear: "yes" },
  ),
  PageConsoleOutputSchema: operation(
    PageConsoleOutputSchema,
    [{ level: "error", text: "Boom.", at: 1 }],
    [{ level: "fatal", text: "Boom.", at: 1 }],
  ),
  PageCaptureInputSchema: operation(PageCaptureInputSchema, pageInput, {}),
  PageCaptureOutputSchema: operation(PageCaptureOutputSchema, "aGk=", 1, Uint8Array.of(104, 105)),
  PageEvaluateInputSchema: operation(
    PageEvaluateInputSchema,
    { ...pageInput, expression: "document.title", options: { ref: "e1" } },
    pageInput,
  ),
  PageEvaluateOutputSchema: operation(
    PageEvaluateOutputSchema,
    { kind: "value", value: { title: "A" } },
    { kind: "threw" },
  ),
  PageCloseInputSchema: operation(PageCloseInputSchema, pageInput, {}),
  PageCloseOutputSchema: operation(PageCloseOutputSchema, null, "closed"),
  PluginsReplaceInputSchema: operation(
    PluginsReplaceInputSchema,
    { plugins: [{ path: "/plugins/maps.ts" }], scope: { session } },
    { plugins: [{ id: "maps" }] },
  ),
  PluginsCheckInputSchema: operation(
    PluginsCheckInputSchema,
    { plugins: [{ path: "/plugins/maps.ts" }] },
    { plugins: ["/plugins/maps.ts"] },
  ),
  PrincipalsListInputSchema: operation(PrincipalsListInputSchema, {}, 1),
  PrincipalsListOutputSchema: operation(
    PrincipalsListOutputSchema,
    [{ id: principal, label: "Phone", authority: ["participant"], pairedAt: 1, lastSeenAt: 2 }],
    [{ id: principal, label: "Phone", authority: "participant", pairedAt: 1, lastSeenAt: 2 }],
  ),
  PrincipalsPairInputSchema: operation(
    PrincipalsPairInputSchema,
    { authority: ["participant", "owner"], label: "Phone" },
    { authority: ["root"] },
  ),
  PrincipalsPairOutputSchema: operation(
    PrincipalsPairOutputSchema,
    { code: "123-456", expiresAt: 1 },
    { code: "123-456" },
  ),
  PrincipalsRevokeInputSchema: operation(PrincipalsRevokeInputSchema, { id: principal }, {}),
  PrincipalsRevokeOutputSchema: operation(PrincipalsRevokeOutputSchema, null, true),
} satisfies Record<string, Case>;

const cases = {
  ...operations,
  PromptOverrideSchema: sample(
    PromptOverrideSchema,
    { kind: "replace", text: "You are terse." },
    { kind: "layer" },
  ),
  SessionIdSchema: sample(SessionIdSchema, session, 42),
  HeadNameSchema: sample(HeadNameSchema, head, null),
  RunIdSchema: sample(RunIdSchema, run, 1),
  CallIdSchema: sample(CallIdSchema, call, {}),
  MessageIdSchema: sample(MessageIdSchema, message, []),
  TurnIdSchema: sample(TurnIdSchema, turn, true),
  CommitIdSchema: sample(CommitIdSchema, commit, 1),
  ObjectIdSchema: sample(ObjectIdSchema, object, 1),
  BlobIdSchema: sample(BlobIdSchema, blob, 1),
  PartIdSchema: sample(PartIdSchema, part, 1),
  ReceiptIdSchema: sample(ReceiptIdSchema, receipt, 1),
  JobIdSchema: sample(JobIdSchema, job, 1),
  JobKeySchema: sample(JobKeySchema, asId<"job-key">("jk1"), 1),
  WorkspaceIdSchema: sample(WorkspaceIdSchema, workspace, 1),
  PageIdSchema: sample(PageIdSchema, page, 1),
  HostIdSchema: sample(HostIdSchema, host, 1),
  PrincipalIdSchema: sample(PrincipalIdSchema, principal, 1),
  SnapshotIdSchema: sample(SnapshotIdSchema, snapshot, 1),
  GitCommitIdSchema: sample(GitCommitIdSchema, gitCommit, 1),
  GitRevisionSchema: sample(GitRevisionSchema, gitRevision, 1),
  FileVersionSchema: sample(FileVersionSchema, fileVersion, 1),
  DocumentRevisionSchema: sample(DocumentRevisionSchema, documentRevision, 1),
  RevisionSchema: sample(RevisionSchema, asId<"revision">(""), 1),
  CatalogGenerationSchema: sample(CatalogGenerationSchema, generation, 1),
  CursorSchema: sample(CursorSchema, cursor, 1),
  SeqSchema: sample(SeqSchema, asSeq(7), -1),
  EnvironmentIdentitySchema: sample(EnvironmentIdentitySchema, identity, 1),
  JsonValueSchema: sample(JsonValueSchema, { a: [1, "b", null, false, { c: {} }] }, undefined),
  JsonObjectSchema: sample(JsonObjectSchema, { type: "object", properties: {} }, [1]),
  ParentFilterSchema: sample(
    ParentFilterSchema,
    { kind: "children", session },
    { kind: "children" },
  ),
  CapabilityWireSchema: sample(
    CapabilityWireSchema,
    { kind: "unavailable", retry: "manual", reason: "No git." },
    { kind: "unavailable", reason: "x" },
  ),
  IdentityChallengeSchema: sample(
    IdentityChallengeSchema,
    { hostId: asId<"host">("h1"), nonce: "n", signature: "s", publicKey: "k" },
    { nonce: "n", signature: "s", publicKey: "k" },
  ),
  HostDescriptionSchema: sample(
    HostDescriptionSchema,
    { name: "mac", platform: "darwin", version: "0.1.0" },
    {},
  ),
  ValidationIssueSchema: sample(ValidationIssueSchema, issue, { ...issue, severity: "fatal" }),
  FailureSchema: sample(FailureSchema, failure, { class: "boom", message: "x" }),
  SdkErrorWireSchema: sample(
    SdkErrorWireSchema,
    { code: "invalid", message: "Bad input.", hostId: host, issues: [issue], correlation: null },
    { code: "teapot", message: "x", hostId: null, issues: [], correlation: null },
  ),
  ModelRefSchema: sample(ModelRefSchema, modelRef, { provider: "x" }),
  ThinkingSchema: sample(ThinkingSchema, "xhigh", "extreme"),
  UsageSchema: sample(UsageSchema, usage, { ...usage, cost: null }),
  ContextViewSchema: sample(ContextViewSchema, contextView, { tokens: 1, window: 2 }),
  LoginMethodSchema: sample(LoginMethodSchema, { kind: "oauth" }, { kind: "device" }),
  ModelInfoSchema: sample(ModelInfoSchema, modelInfo, { ...modelInfo, input: ["audio"] }),
  ModelCatalogViewSchema: sample(
    ModelCatalogViewSchema,
    {
      generation,
      default: modelRef,
      providers: [
        {
          id: "anthropic",
          name: "Anthropic",
          credential: "configured",
          methods: [{ kind: "oauth" }, { kind: "key" }],
          limits: [{ label: "5h", used: 1, limit: 10, resetsAt: null }],
          models: [modelInfo],
        },
      ],
    },
    { generation, default: null },
  ),
  ConfigurationPatchSchema: sample(
    ConfigurationPatchSchema,
    { model: modelRef, thinking: null, agent: null, settings: { k: [1] } },
    { thinking: "huge" },
  ),
  ConfigurationSchema: sample(ConfigurationSchema, configuration, {
    ...configuration,
    kind: "patch",
  }),
  DeliverySchema: sample(DeliverySchema, "attach", "later"),
  UserContentSchema: sample(UserContentSchema, userContent, [{ kind: "file", blob }]),
  PositionSchema: sample(PositionSchema, { kind: "commit", id: commit }, { kind: "commit" }),
  MessageSourceSchema: sample(
    MessageSourceSchema,
    { kind: "action", label: "Fix", command: "fix" },
    { kind: "action" },
  ),
  ScheduleSchema: sample(
    ScheduleSchema,
    { kind: "next-turn", reason: "idle" },
    { kind: "next-turn", reason: "soon" },
  ),
  ToolClassSchema: sample(
    ToolClassSchema,
    { kind: "delegate", child: session, role: "task", title: null },
    { kind: "delegate", role: "read" },
  ),
  ToolContentSchema: sample(
    ToolContentSchema,
    { kind: "file", blob, mime: "image/png", name: "a.png" },
    { kind: "file", mime: "x" },
  ),
  ToolOutcomeSchema: sample(ToolOutcomeSchema, toolOutcome, { kind: "ok", content: [] }),
  ToolProgressSchema: sample(
    ToolProgressSchema,
    { text: "Reading", fraction: 0.5, detail: { step: 1 } },
    { fraction: "half" },
  ),
  EndReasonSchema: sample(EndReasonSchema, "host-lost", "crashed"),
  JobEndSchema: sample(
    JobEndSchema,
    { kind: "exited", code: null, reason: "terminated" },
    { kind: "running" },
  ),
  JobStateSchema: sample(JobStateSchema, { kind: "running" }, { kind: "exited", code: 0 }),
  JobViewSchema: sample(
    JobViewSchema,
    {
      id: job,
      command: "npm test",
      title: "Tests",
      session,
      pty: { columns: 80, rows: 24, shell: "login" },
      state: { kind: "lost" },
      startedAt: 1,
      endedAt: null,
      tail: "ok",
    },
    { id: job, command: "npm test" },
  ),
  OutputFrameSchema: sample(
    OutputFrameSchema,
    { kind: "exit", code: 0 },
    { kind: "bytes", data: "not base64!" },
  ),
  RunViewSchema: sample(RunViewSchema, runView, {
    ...runView,
    origin: { kind: "continuation", from: "user" },
  }),
  RunEndSchema: sample(RunEndSchema, runEnd, { kind: "failed" }),
  WaitTargetSchema: sample(WaitTargetSchema, waitTarget, { kind: "run", session, deadline: 5 }),
  ExecutionSchema: sample(ExecutionSchema, execution, { kind: "live", run: runView }),
  BackgroundItemSchema: sample(BackgroundItemSchema, background, {
    ...background,
    state: "paused",
  }),
  WaitOutcomeSchema: sample(
    WaitOutcomeSchema,
    {
      kind: "all",
      outcomes: [
        { kind: "run", session, run, end: runEnd },
        { kind: "job", job, end: { kind: "lost" } },
        { kind: "part", part, answer: { action: "pick", input: { choice: "a" } } },
        { kind: "all", outcomes: [{ kind: "deadline" }, { kind: "input", message }] },
      ],
    },
    { kind: "all", outcomes: [{ kind: "later" }] },
  ),
  PlacementSchema: sample(
    PlacementSchema,
    { kind: "sidebar/weather", city: "Oslo", days: [1, 2] },
    { kind: 1 },
  ),
  PartStatusSchema: sample(PartStatusSchema, partStatus, { kind: "live" }),
  PartViewSchema: sample(
    PartViewSchema,
    {
      id: part,
      partKind: "ask/question",
      placement: { kind: "modal" },
      state: { title: "Pick" },
      version: 1,
      status: { kind: "live", run: null },
      owner: "ask",
    },
    { id: part, partKind: "x" },
  ),
  ToolPartStateSchema: sample(
    ToolPartStateSchema,
    {
      call,
      name: "bash",
      args: { command: "ls" },
      class: { kind: "shell", command: "ls", description: "List." },
      phase: "settled",
      outcome: toolOutcome,
      changes: null,
    },
    { call, name: "bash", args: null, class: { kind: "custom", label: "x" }, phase: "done" },
  ),
  FileStatusSchema: sample(FileStatusSchema, "conflicted", "moved"),
  FileChangeSchema: sample(FileChangeSchema, fileChange, { path: "a.ts", status: "added" }),
  FileEntryViewSchema: sample(
    FileEntryViewSchema,
    { path: "src", kind: "directory", size: null, version: null },
    { path: "src", kind: "socket", size: null, version: null },
  ),
  FileEventSchema: sample(
    FileEventSchema,
    { path: "a.ts", version: fileVersion, kind: "modified" },
    { path: "a.ts", version: null, kind: "renamed" },
  ),
  ScanFrameSchema: sample(
    ScanFrameSchema,
    { kind: "entries", entries: [{ path: "a.ts", kind: "file", size: 3, version: fileVersion }] },
    { kind: "incomplete", reason: "tired" },
  ),
  SearchFrameSchema: sample(
    SearchFrameSchema,
    { kind: "match", path: "a.ts", line: 1, column: 2, text: "x" },
    { kind: "truncated" },
  ),
  FormatOutcomeSchema: sample(
    FormatOutcomeSchema,
    { kind: "formatted", contents: "x\n" },
    { kind: "formatted" },
  ),
  WriteOutcomeSchema: sample(
    WriteOutcomeSchema,
    { kind: "stale", current: null },
    { kind: "saved" },
  ),
  BatchOutcomeSchema: sample(
    BatchOutcomeSchema,
    { kind: "partial", applied: ["a"], remaining: ["b"], reason: "Disk full." },
    { kind: "partial", applied: ["a"] },
  ),
  FileDocumentSchema: sample(
    FileDocumentSchema,
    { kind: "large", path: "big.bin", size: 9, version: fileVersion },
    { kind: "huge", path: "x" },
  ),
  GitStatusSchema: sample(
    GitStatusSchema,
    {
      kind: "repository",
      root: "/repo",
      head: gitCommit,
      branch: "main",
      upstream: { name: "origin/main", ahead: 1, behind: 0 },
      revision: gitRevision,
      staged: [fileChange],
      unstaged: [],
      untracked: ["new.ts"],
      conflicts: [],
    },
    { kind: "repository", root: "/repo" },
  ),
  GitCommitViewSchema: sample(
    GitCommitViewSchema,
    { id: gitCommit, subject: "Fix", author: "A", committedAt: 1, parents: [gitCommit] },
    { id: gitCommit },
  ),
  GitRefsViewSchema: sample(
    GitRefsViewSchema,
    {
      current: null,
      branches: [{ name: "main", commit: gitCommit, upstream: null }],
      remotes: ["origin"],
    },
    { current: null },
  ),
  GitFileSideSchema: sample(
    GitFileSideSchema,
    { kind: "truncated", head: "abc" },
    { kind: "text" },
  ),
  GitFileSidesSchema: sample(
    GitFileSidesSchema,
    { path: "a.ts", old: { kind: "absent" }, new: { kind: "binary" } },
    { path: "a.ts", old: { kind: "absent" } },
  ),
  BlameViewSchema: sample(
    BlameViewSchema,
    { path: "a.ts", lines: [{ line: 1, commit: gitCommit, author: "A", at: 1 }] },
    { path: "a.ts", lines: [{ line: 1 }] },
  ),
  GitScopeSchema: sample(GitScopeSchema, { kind: "branch", base: "main" }, { kind: "branch" }),
  DiffOptionsSchema: sample(
    DiffOptionsSchema,
    { ignoreWhitespace: true },
    { ignoreWhitespace: "yes" },
  ),
  LineStatSchema: sample(LineStatSchema, { kind: "text", added: 1, removed: 2 }, { kind: "text" }),
  ChangeSetSchema: sample(
    ChangeSetSchema,
    { revision: snapshot, files: [{ path: "a.ts", status: "added", stat: { kind: "unknown" } }] },
    { revision: snapshot, files: [{ path: "a.ts" }] },
  ),
  HunkSchema: sample(HunkSchema, hunk, {
    ...hunk,
    lines: [{ kind: "add", text: "b", noNewline: false }],
  }),
  PatchEntrySchema: sample(PatchEntrySchema, patchEntry, {
    path: "a.ts",
    status: "modified",
    kind: "binary",
  }),
  PatchSetWireSchema: sample(
    PatchSetWireSchema,
    {
      revision: gitRevision,
      entries: {
        "a.ts": { ...patchEntry, fresh: true },
        "b.png": { path: "b.png", status: "added", digest: "d2", kind: "binary", fresh: false },
      },
    },
    { revision: gitRevision, entries: { "a.ts": patchEntry } },
  ),
  GitWriteSchema: sample(GitWriteSchema, { expect: gitRevision }, { expect: 1 }),
  GitOutcomeSchema: sample(GitOutcomeSchema, { kind: "busy", runs: [run] }, { kind: "busy" }),
  PageInfoSchema: sample(
    PageInfoSchema,
    { id: page, url: "https://a.b", title: "A", holders: 1 },
    { id: page },
  ),
  PageViewSchema: sample(
    PageViewSchema,
    {
      id: page,
      url: "https://a.b",
      title: "A",
      loading: false,
      revision: documentRevision,
      canGoBack: true,
      canGoForward: false,
    },
    { id: page, url: "https://a.b" },
  ),
  PageSnapshotSchema: sample(PageSnapshotSchema, pageSnapshot, {
    revision: documentRevision,
    nodes: [{ ref: "e1" }],
  }),
  ConsoleEntrySchema: sample(
    ConsoleEntrySchema,
    { level: "warn", text: "x", at: 1 },
    { level: "debug", text: "x", at: 1 },
  ),
  PageOutcomeSchema: sample(
    PageOutcomeSchema,
    { kind: "applied", snapshot: pageSnapshot },
    { kind: "refused", reason: "nope" },
  ),
  AvailabilitySchema: sample(
    AvailabilitySchema,
    { kind: "unavailable", reason: "unsupported" },
    { kind: "unavailable" },
  ),
  WorkspaceTargetSchema: sample(
    WorkspaceTargetSchema,
    { kind: "sandbox", locator: { image: "node", size: 2 } },
    { kind: "sandbox" },
  ),
  ActivationSchema: sample(
    ActivationSchema,
    { kind: "unavailable", reason: "unreachable", workspace },
    { kind: "unavailable", reason: "unreachable" },
  ),
  AddOutcomeSchema: sample(AddOutcomeSchema, { kind: "stale", identity }, { kind: "added" }),
  ForgetOutcomeSchema: sample(
    ForgetOutcomeSchema,
    { kind: "busy", sessions: [session] },
    { kind: "busy" },
  ),
  WorkspaceInspectionSchema: sample(
    WorkspaceInspectionSchema,
    {
      target: { kind: "local", path: "/repo" },
      identity,
      availability: { kind: "available" },
      projectSources: ["AGENTS.md"],
      registered: null,
    },
    { target: { kind: "local" }, identity },
  ),
  WorkspaceInfoSchema: sample(
    WorkspaceInfoSchema,
    {
      id: workspace,
      target: { kind: "local", path: "/repo" },
      identity,
      availability: { kind: "available" },
      projectResources: true,
      projectSources: [],
      addedBy: principal,
      sessions: 2,
      writers: [run],
    },
    { id: workspace },
  ),
  HeadInfoSchema: sample(HeadInfoSchema, headInfo, { ...headInfo, tip: null }),
  SessionInfoSchema: sample(SessionInfoSchema, sessionInfo, { ...sessionInfo, heads: [{}] }),
  CommandInfoSchema: sample(CommandInfoSchema, catalog.commands[0], {
    name: "x",
    owner: "y",
    side: "server",
  }),
  SettingInfoSchema: sample(SettingInfoSchema, settingInfo, { ...settingInfo, from: "user" }),
  SkillInfoSchema: sample(SkillInfoSchema, catalog.skills[0], { name: "pdf" }),
  AgentInfoSchema: sample(AgentInfoSchema, catalog.agents[0], {
    id: "x",
    owner: "y",
    description: null,
    model: null,
    mode: "any",
  }),
  ToolInfoSchema: sample(ToolInfoSchema, catalog.tools[0], { name: "read", parameters: "object" }),
  SessionCatalogViewSchema: sample(SessionCatalogViewSchema, catalog, { commands: [] }),
  CommandOutcomeSchema: sample(
    CommandOutcomeSchema,
    { kind: "invalid", issues: [issue] },
    { kind: "sent" },
  ),
  UpdateOutcomeSchema: sample(UpdateOutcomeSchema, { kind: "busy", runs: [run] }, { kind: "busy" }),
  RemoveSessionOutcomeSchema: sample(
    RemoveSessionOutcomeSchema,
    { kind: "has-children", children: [session] },
    { kind: "has-children" },
  ),
  ViewOptionsSchema: sample(ViewOptionsSchema, { tail: 50 }, { tail: "all" }),
  UserStatusSchema: sample(
    UserStatusSchema,
    { kind: "unsent", attempts: 2, retrying: { at: 3, reason: "Offline." } },
    { kind: "pending", covered: true },
  ),
  MessageSchema: sample(MessageSchema, userMessage, { ...partMessage, role: "aside" }),
  TurnInfoSchema: sample(TurnInfoSchema, turnInfo, { ...turnInfo, summary: { failed: 0 } }),
  SessionViewSchema: sample(
    SessionViewSchema,
    {
      revision,
      activation: { kind: "active" },
      messages: [userMessage, partMessage],
      parts: [
        {
          id: part,
          partKind: "status",
          placement: { kind: "status", priority: 1 },
          state: null,
          version: 0,
          status: { kind: "live", run },
          owner: null,
        },
      ],
      turns: [turnInfo],
      execution: { kind: "idle", lastRun: { id: run, end: { kind: "stopped" }, endedAt: 5 } },
      background: [background],
      configuration: { selected: null, effective: configuration },
      context: contextView,
      heads: [headInfo],
      changes: [fileChange],
      catalog,
    },
    { revision, messages: [] },
  ),
  TreeNodeSchema: sample(
    TreeNodeSchema,
    {
      id: commit,
      parent: null,
      depth: 0,
      branch: false,
      active: true,
      heads: [head],
      kind: "branchSummary",
      partKind: null,
      preview: "x",
      at: 1,
      run: null,
    },
    { id: commit, kind: "merge" },
  ),
  TreeViewSchema: sample(
    TreeViewSchema,
    { revision, tip: { kind: "start" }, nodes: [] },
    { revision, nodes: [] },
  ),
  CreateHeadOutcomeSchema: sample(
    CreateHeadOutcomeSchema,
    { kind: "created", basedOn: { kind: "start" } },
    { kind: "created" },
  ),
  MergeOutcomeSchema: sample(
    MergeOutcomeSchema,
    { kind: "diverged", base: { kind: "commit", id: commit } },
    { kind: "merged" },
  ),
  RemoveHeadOutcomeSchema: sample(RemoveHeadOutcomeSchema, { kind: "busy", run }, { kind: "busy" }),
  MoveOutcomeSchema: sample(
    MoveOutcomeSchema,
    {
      kind: "moved",
      revision,
      position: { kind: "start" },
      summary: message,
      handback: userContent,
    },
    { kind: "moved", revision },
  ),
  MoveOptionsSchema: sample(
    MoveOptionsSchema,
    { running: "refuse", abandoned: "keep", expect: revision },
    { abandoned: "drop" },
  ),
  SendOptionsSchema: sample(SendOptionsSchema, sendOptions, { delivery: "later" }),
  ConfigureOutcomeSchema: sample(
    ConfigureOutcomeSchema,
    { kind: "configured", selected: configuration, revision },
    { kind: "configured", revision },
  ),
  AuthoritySchema: sample(AuthoritySchema, "maintenance", "admin"),
  ExecutionCoverageSchema: sample(
    ExecutionCoverageSchema,
    { kind: "sessions", sessions: [session] },
    { kind: "sessions" },
  ),
  AdvanceReportSchema: sample(
    AdvanceReportSchema,
    { kind: "waiting", until: null },
    { kind: "retry" },
  ),
  RepairPageSchema: sample(
    RepairPageSchema,
    { runnable: [{ session, head }], next: cursor },
    { runnable: [{ session }], next: null },
  ),
  PruneReportSchema: sample(
    PruneReportSchema,
    { objects: 3, bytes: 0, retained: 2 },
    { objects: 3 },
  ),
  PrincipalViewWireSchema: sample(
    PrincipalViewWireSchema,
    { id: principal, label: "Phone", authority: ["participant"], pairedAt: 1, lastSeenAt: null },
    { id: principal, label: "Phone", authority: {}, pairedAt: 1, lastSeenAt: null },
  ),
  PluginLoadOutcomeSchema: sample(
    PluginLoadOutcomeSchema,
    { kind: "kept-previous", id: "maps", issues: [issue] },
    { kind: "failed", id: "maps", issues: [] },
  ),
  PluginCheckReportSchema: sample(
    PluginCheckReportSchema,
    { plugins: [{ kind: "activated", id: "maps", issues: [] }], collisions: [issue] },
    { plugins: [] },
  ),
  PluginReplacementReportSchema: sample(
    PluginReplacementReportSchema,
    { generation, plugins: [] },
    { plugins: [] },
  ),
  DecodedObjectViewSchema: sample(
    DecodedObjectViewSchema,
    { id: object, kind: "commit", parent: commit, body: { kind: "part" }, at: 1 },
    { id: object, kind: "commit" },
  ),
  IntegrityReportSchema: sample(
    IntegrityReportSchema,
    { ok: false, issues: [{ ref: "heads/main", object: null, message: "Missing." }] },
    { ok: "no" },
  ),
  HostViewWireSchema: sample(
    HostViewWireSchema,
    {
      id: host,
      link: { kind: "reconnecting", since: 1, attempts: 2 },
      name: "mac",
      platform: "darwin",
      version: "0.1.0",
      catalog: generation,
      plugins: [{ id: "parts", source: "builtin", path: null, issues: [issue] }],
      settings: [settingInfo],
      authority: ["participant", "owner"],
      principal,
      operations: [
        {
          name: "session.send",
          kind: "receipt",
          authority: "participant",
          input: { type: "object" },
          output: { type: "string" },
        },
      ],
    },
    { id: host, link: { kind: "connected" }, authority: [] },
  ),
  CredentialSourceWireSchema: sample(
    CredentialSourceWireSchema,
    { kind: "pairing", code: "123-456" },
    { kind: "custom" },
  ),
  JournalEntrySchema: sample(
    JournalEntrySchema,
    { id: receipt, session, head, content: "hi", options: sendOptions, at: 1 },
    { id: receipt, session },
  ),
  SettingOutcomeSchema: sample(
    SettingOutcomeSchema,
    { kind: "invalid", issues: [issue] },
    { kind: "invalid" },
  ),
  SubmissionSchema: sample(
    SubmissionSchema,
    {
      content: "hi",
      source: { kind: "user" },
      delivery: "steer",
      configuration: { thinking: "high", settings: {} },
      replace: null,
    },
    { content: "hi", source: { kind: "user" }, delivery: "steer" },
  ),
  ModelRequestSchema: sample(
    ModelRequestSchema,
    {
      model: modelRef,
      thinking: "off",
      step: "summary",
      attempt: 0,
      options: { sampling: { temperature: 0.2 }, headers: { "x-a": "b" } },
    },
    { model: modelRef, thinking: "off", step: "plugin" },
  ),
  ToolCallSchema: sample(
    ToolCallSchema,
    { call, name: "read", args: { path: "a" }, class: { kind: "read", path: "a" } },
    { call, name: "read" },
  ),
  SubmitDraftSchema: sample(
    SubmitDraftSchema,
    { content: userContent, delivery: "queue", session },
    { content: "hi", delivery: "queue" },
  ),
  CommitBodySchema: sample(
    CommitBodySchema,
    { kind: "branchSummary", part, replaces: [commit] },
    { kind: "branchSummary", part },
  ),
  DurableEventSchema: sample(DurableEventSchema, durableEvent, {
    kind: "head",
    from: null,
    to: null,
    reason: "moved",
  }),
  SessionEventSchema: sample(SessionEventSchema, events.run[0], { ...durableEvent, at: 1 }),
  PatchEventSchema: sample(
    PatchEventSchema,
    { kind: "patch", part, progress: { text: "Half.", fraction: 0.5 } },
    { kind: "patch", part },
  ),
  RefSchema: sample(
    RefSchema,
    { name: "sessions/s1/heads/main", target: object, revision },
    { name: "x", target: null },
  ),
  RefUpdateSchema: sample(
    RefUpdateSchema,
    { name: "sessions/s1/heads/main", target: object, expect: "absent", event: durableEvent },
    { name: "x", target: null, expect: 1 },
  ),
  SetOutcomeSchema: sample(
    SetOutcomeSchema,
    { kind: "set", seq: asSeq(3), revisions: [revision] },
    { kind: "set", seq: 1.5, revisions: [] },
  ),
} satisfies Record<string, Case>;

const paged: Schema<Paged<SessionInfo>> = pagedSchema(SessionInfoType);
const stopped: Schema<StopOutcome<RunEnd>> = stopOutcomeSchema(RunEndType);
const acted: Schema<ActOutcome<Json>> = actOutcomeSchema(JsonType);

const factories = {
  "pagedSchema(SessionInfoType)": sample(
    paged,
    { items: [sessionInfo], next: cursor },
    { items: [{}], next: null },
  ),
  "stopOutcomeSchema(RunEndType)": sample(
    stopped,
    { kind: "settled", outcome: runEnd },
    { kind: "settled" },
  ),
  "actOutcomeSchema(JsonType)": sample(
    acted,
    { kind: "ok", output: { picked: [1] } },
    { kind: "ok" },
  ),
} satisfies Record<string, Case>;

const wire = new URL("../src/wire/", import.meta.url);

describe("wire schemas", () => {
  it("covers every exported schema", () => {
    const exported = readdirSync(wire).flatMap((file) =>
      [...readFileSync(new URL(file, wire), "utf8").matchAll(/^export const (\w+Schema)\b/gm)].map(
        (match) => match[1],
      ),
    );

    expect(Object.keys(cases).toSorted()).toEqual(exported.toSorted());
  });

  it.each(Object.entries({ ...cases, ...factories }))(
    "%s validates, rejects and emits loadable JSON Schema",
    async (_name, { schema, good, bad, decoded }) => {
      const json = schema["~standard"].jsonSchema.input({ target: "draft-2020-12" });
      const validator = new Validator(structuredClone(json), "2020-12");
      const found = ids(json);

      expect(await schema["~standard"].validate(good)).toEqual({ value: decoded ?? good });
      expect((await schema["~standard"].validate(bad)).issues?.length).toBeGreaterThan(0);
      expect(validator.validate(good).valid).toBe(true);
      if (isJson(bad)) expect(validator.validate(bad).valid).toBe(false);
      expect(new Set(found).size).toBe(found.length);
    },
  );

  it("types ids and seqs without codecs, so validating them runs no codec", async () => {
    const valid = await SessionIdSchema["~standard"].validate("s9");
    const decoded: SessionId | undefined = valid.issues === undefined ? valid.value : undefined;

    expect(HasCodec(idSchema<"session">())).toBe(false);
    expect(HasCodec(SeqType)).toBe(false);
    expect(HasCodec(OutputFrameType)).toBe(true);
    expect(decoded).toBe("s9");
    expect((await SeqSchema["~standard"].validate(1.5)).issues?.length).toBeGreaterThan(0);
  });

  it("returns what passes the check as TypeBox's typed Decode: the value itself without a codec", async () => {
    const [commit] = events.commit;
    const valid = await SessionEventSchema["~standard"].validate(commit);

    const kind: SessionEvent["kind"] | undefined =
      valid.issues === undefined ? valid.value.kind : undefined;

    expect(valid.issues === undefined ? valid.value : undefined).toBe(commit);
    expect(kind).toBe("commit");
  });

  it("carries output bytes as base64", async () => {
    expect(await OutputFrameSchema["~standard"].validate({ kind: "bytes", data: "aGk=" })).toEqual({
      value: { kind: "bytes", data: Uint8Array.of(104, 105) },
    });
  });

  it("accepts one session event of every durable kind and change", async () => {
    const all: readonly SessionEvent[] = Object.values(events).flat();

    for (const event of all) {
      expect(await SessionEventSchema["~standard"].validate(event)).toEqual({ value: event });
    }
    expect(new Set(all.map((event) => event.kind)).size).toBe(Object.keys(events).length);
  });

  it("round-trips a part waiting event through JSON and rejects one without a call id (§42ac)", async () => {
    const event: SessionEvent = {
      seq: asSeq(30),
      at: 1,
      head: null,
      kind: "part",
      part,
      change: "waiting",
      call,
    };

    const wire: unknown = JSON.parse(JSON.stringify(event));

    expect(await SessionEventSchema["~standard"].validate(wire)).toEqual({ value: event });
    expect(
      (await SessionEventSchema["~standard"].validate({ ...event, call: 7 })).issues?.length,
    ).toBeGreaterThan(0);
  });

  it("round-trips an identity challenge with its host id and rejects one without it (§43k)", async () => {
    const challenge: IdentityChallenge = {
      hostId: asId("h1"),
      nonce: "n1",
      signature: "sig",
      publicKey: "key",
    };

    const wire: unknown = JSON.parse(JSON.stringify(challenge));

    expect(await IdentityChallengeSchema["~standard"].validate(wire)).toEqual({ value: challenge });
    expect(
      (await IdentityChallengeSchema["~standard"].validate({ ...challenge, hostId: 1 })).issues
        ?.length,
    ).toBeGreaterThan(0);
  });

  it("keeps an exact configuration whole where a patch is also accepted", async () => {
    expect(await SendOptionsSchema["~standard"].validate({ configuration })).toEqual({
      value: { configuration },
    });
    expect(isJson({ a: [1, null, { b: "c" }] })).toBe(true);
    expect(isJson(undefined)).toBe(false);
  });
});
