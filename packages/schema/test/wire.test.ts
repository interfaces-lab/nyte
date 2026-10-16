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
  ForgetOutcomeSchema,
  FormatOutcomeSchema,
  GitCommitIdSchema,
  GitCommitViewSchema,
  GitFileSideSchema,
  GitFileSidesSchema,
  GitOutcomeSchema,
  GitRefsViewSchema,
  GitRevisionSchema,
  GitScopeSchema,
  GitStatusSchema,
  GitWriteSchema,
  HeadInfoSchema,
  HeadNameSchema,
  HostDescriptionSchema,
  HostIdSchema,
  HostViewWireSchema,
  HunkSchema,
  IdentityChallengeSchema,
  IntegrityReportSchema,
  JobEndSchema,
  JobIdSchema,
  JobKeySchema,
  JobStateSchema,
  JobViewSchema,
  JournalEntrySchema,
  JsonObjectSchema,
  JsonType,
  JsonValueSchema,
  LineStatSchema,
  LoginMethodSchema,
  MergeOutcomeSchema,
  ModelAccountSchema,
  MessageIdSchema,
  MessageSchema,
  MessageSourceSchema,
  ModelCatalogViewSchema,
  ModelInfoSchema,
  ModelRefSchema,
  ModelRequestSchema,
  MoveOptionsSchema,
  MoveOutcomeSchema,
  ObjectIdSchema,
  OutputFrameSchema,
  OutputFrameType,
  PageIdSchema,
  PageInfoSchema,
  PageOutcomeSchema,
  PageSnapshotSchema,
  PageViewSchema,
  ParentFilterSchema,
  PartIdSchema,
  PartStatusSchema,
  PartViewSchema,
  PatchEntrySchema,
  PatchEventSchema,
  PatchSetWireSchema,
  PlacementSchema,
  PluginCheckReportSchema,
  PluginLoadOutcomeSchema,
  PluginReplacementReportSchema,
  PositionSchema,
  PrincipalIdSchema,
  PrincipalViewWireSchema,
  PromptOverrideSchema,
  ProviderUsageSchema,
  ReceiptIdSchema,
  RefSchema,
  RefUpdateSchema,
  RemoveHeadOutcomeSchema,
  RemoveSessionOutcomeSchema,
  RepairPageSchema,
  RevisionSchema,
  RunEndSchema,
  RunEndType,
  RunIdSchema,
  RunViewSchema,
  ScanFrameSchema,
  ScheduleSchema,
  SdkErrorWireSchema,
  SearchFrameSchema,
  SendOptionsSchema,
  SeqSchema,
  SeqType,
  SessionCatalogViewSchema,
  SessionEventSchema,
  SessionIdSchema,
  SessionInfoSchema,
  SessionInfoType,
  SessionViewSchema,
  SetOutcomeSchema,
  SettingInfoSchema,
  SettingOutcomeSchema,
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
  WorkspaceIdSchema,
  WorkspaceInfoSchema,
  WorkspaceInspectionSchema,
  WorkspaceTargetSchema,
  McpViewSchema,
  McpChangeSchema,
  McpServerConfigSchema,
  OPERATIONS,
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
  ToolInfo,
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
  call: null,
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
      namespace: null,
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
  source: { kind: "child", session, end: "completed" },
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
  trusted: true,
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
  "connection.watch input": operation(OPERATIONS["connection.watch"].input, {}, 1),
  "connection.blob input": operation(OPERATIONS["connection.blob"].input, { id: blob }, {}),
  "connection.blob output": operation(
    OPERATIONS["connection.blob"].output,
    "aGk=",
    "not base64!",
    Uint8Array.of(104, 105),
  ),
  "models.list input": operation(OPERATIONS["models.list"].input, {}, 1),
  "models.accounts input": operation(
    OPERATIONS["models.accounts"].input,
    { provider: "test" },
    { provider: 1 },
  ),
  "models.accounts output": operation(OPERATIONS["models.accounts"].output, [], [{}]),
  "models.selectAccount input": operation(
    OPERATIONS["models.selectAccount"].input,
    { provider: "test", account: "work" },
    { provider: "test" },
  ),
  "models.selectAccount output": operation(OPERATIONS["models.selectAccount"].output, null, 0),
  "models.usage input": operation(OPERATIONS["models.usage"].input, {}, 1),
  "models.usage output": operation(OPERATIONS["models.usage"].output, [], [{}]),
  "models.refresh input": operation(
    OPERATIONS["models.refresh"].input,
    { provider: "test" },
    { provider: 1 },
  ),
  "models.refresh output": operation(OPERATIONS["models.refresh"].output, null, 0),
  "models.setDefault input": operation(
    OPERATIONS["models.setDefault"].input,
    { ref: modelRef },
    { ref: { provider: "test" } },
  ),
  "models.setDefault output": operation(
    OPERATIONS["models.setDefault"].output,
    { kind: "unknown-model" },
    { kind: "unset" },
  ),
  "models.verify input": operation(OPERATIONS["models.verify"].input, { provider: "test" }, {}),
  "models.verify output": operation(
    OPERATIONS["models.verify"].output,
    { kind: "failed", reason: "Expired." },
    { kind: "failed" },
  ),
  "models.login input": operation(
    OPERATIONS["models.login"].input,
    { provider: "test", method: { kind: "oauth" } },
    { provider: "test", method: { kind: "device" } },
  ),
  "models.login output": operation(OPERATIONS["models.login"].output, null, {}),
  "models.logout input": operation(
    OPERATIONS["models.logout"].input,
    { provider: "test" },
    { provider: null },
  ),
  "models.logout output": operation(OPERATIONS["models.logout"].output, null, false),
  "login.steps input": operation(OPERATIONS["login.steps"].input, { provider: "test" }, {}),
  "login.steps output": operation(
    OPERATIONS["login.steps"].output,
    { kind: "choose", message: "Pick.", options: [{ id: "a", label: "A" }] },
    { kind: "choose", message: "Pick." },
  ),
  "login.answer input": operation(
    OPERATIONS["login.answer"].input,
    { provider: "test", code: "123" },
    { provider: "test" },
  ),
  "login.answer output": operation(OPERATIONS["login.answer"].output, null, "done"),
  "settings.apply input": operation(
    OPERATIONS["settings.apply"].input,
    { id: "core/theme", value: { dark: [true] } },
    { id: "core/theme" },
  ),
  "workspaces.list input": operation(OPERATIONS["workspaces.list"].input, {}, 1),
  "workspaces.list output": operation(
    OPERATIONS["workspaces.list"].output,
    [workspaceInfo],
    [{ id: workspace }],
  ),
  "workspaces.inspect input": operation(
    OPERATIONS["workspaces.inspect"].input,
    { target: { kind: "local", path: "/repo" } },
    { target: { kind: "local" } },
  ),
  "workspaces.add input": operation(
    OPERATIONS["workspaces.add"].input,
    {
      target: { kind: "local", path: "/repo" },
      options: { projectResources: false, expect: { identity } },
    },
    { target: { kind: "local", path: "/repo" }, options: { expect: {} } },
  ),
  "workspaces.forget input": operation(
    OPERATIONS["workspaces.forget"].input,
    { id: workspace },
    { id: 1 },
  ),
  "sessions.watch input": operation(
    OPERATIONS["sessions.watch"].input,
    { parents: { kind: "roots" }, limit: 50 },
    { parents: { kind: "orphans" } },
  ),
  "sessions.watch output": operation(
    OPERATIONS["sessions.watch"].output,
    [sessionInfo],
    [{ id: session }],
  ),
  "sessions.create input": operation(
    OPERATIONS["sessions.create"].input,
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
  "sessions.create output": operation(OPERATIONS["sessions.create"].output, sessionInput, {}),
  "sessions.list input": operation(
    OPERATIONS["sessions.list"].input,
    { parents: { kind: "children", session }, cursor, limit: 10 },
    { cursor: 1 },
  ),
  "sessions.list output": operation(
    OPERATIONS["sessions.list"].output,
    { items: [sessionInfo], next: null },
    { items: [] },
  ),
  "session.info input": operation(OPERATIONS["session.info"].input, sessionInput, {}),
  "session.update input": operation(
    OPERATIONS["session.update"].input,
    { session, patch: { name: null, pinned: true, archived: false, workspace } },
    { session, patch: { pinned: "yes" } },
  ),
  "session.remove input": operation(OPERATIONS["session.remove"].input, sessionInput, {
    session: null,
  }),
  "session.stop input": operation(OPERATIONS["session.stop"].input, sessionInput, {}),
  "session.stop output": operation(
    OPERATIONS["session.stop"].output,
    { stopped: [run], withdrawn: [message] },
    { stopped: [run] },
  ),
  "session.command input": operation(
    OPERATIONS["session.command"].input,
    { session, name: "core/compact", args: { focus: ["tests"] } },
    { session, args: {} },
  ),
  "head.send input": operation(
    OPERATIONS["head.send"].input,
    { ...headInput, content: userContent, options: sendOptions },
    { ...headInput, content: 1 },
  ),
  "head.send output": operation(OPERATIONS["head.send"].output, { receipt, message }, { receipt }),
  "head.configure input": operation(
    OPERATIONS["head.configure"].input,
    { ...headInput, patch: { thinking: null } },
    { ...headInput, patch: { thinking: "huge" } },
  ),
  "head.view input": operation(
    OPERATIONS["head.view"].input,
    { ...headInput, options: { tail: 20 } },
    { session },
  ),
  "head.watch input": operation(
    OPERATIONS["head.watch"].input,
    { ...headInput, options: { tail: 20 }, after: asSeq(12) },
    { ...headInput, after: -1 },
  ),
  "head.watch output": operation(
    OPERATIONS["head.watch"].output,
    { kind: "revision", head, tip: null, revision },
    { kind: "revision", head, revision },
  ),
  "head.history input": operation(
    OPERATIONS["head.history"].input,
    { ...headInput, before: message, limit: 20 },
    { ...headInput, limit: 20 },
  ),
  "head.history output": operation(
    OPERATIONS["head.history"].output,
    [userMessage],
    [{ id: message }],
  ),
  "head.tree input": operation(OPERATIONS["head.tree"].input, headInput, { head }),
  "head.move input": operation(
    OPERATIONS["head.move"].input,
    {
      ...headInput,
      position: { kind: "commit", id: commit },
      options: { running: "stop" },
      id: receipt,
    },
    { ...headInput, position: { kind: "commit" } },
  ),
  "head.move output": operation(OPERATIONS["head.move"].output, { receipt }, {}),
  "head.compact input": operation(
    OPERATIONS["head.compact"].input,
    { ...headInput, instructions: "Keep the plan." },
    { ...headInput, instructions: 1 },
  ),
  "head.compact output": operation(
    OPERATIONS["head.compact"].output,
    { kind: "busy", run },
    { kind: "busy" },
  ),
  "heads.create input": operation(
    OPERATIONS["heads.create"].input,
    { session, name: head, input: { from: { kind: "start" } } },
    { session, input: {} },
  ),
  "heads.merge input": operation(
    OPERATIONS["heads.merge"].input,
    { session, name: head, options: { expect: revision } },
    { session, name: head, options: { expect: 1 } },
  ),
  "heads.remove input": operation(
    OPERATIONS["heads.remove"].input,
    { session, name: head },
    { name: head },
  ),
  "run.stop input": operation(OPERATIONS["run.stop"].input, { session, run }, { session }),
  "run.stop output": operation(OPERATIONS["run.stop"].output, settled, { kind: "settled" }),
  "run.settled input": operation(OPERATIONS["run.settled"].input, { session, run }, { run }),
  "receipt.status input": operation(
    OPERATIONS["receipt.status"].input,
    { session: null, receipt },
    { receipt },
  ),
  "receipt.status output": operation(
    OPERATIONS["receipt.status"].output,
    { kind: "settled", outcome: { kind: "applied" } },
    { kind: "settled" },
  ),
  "receipt.settled input": operation(
    OPERATIONS["receipt.settled"].input,
    { session, receipt },
    { session },
  ),
  "receipt.stop input": operation(
    OPERATIONS["receipt.stop"].input,
    { session: null, receipt },
    { session: 1, receipt },
  ),
  "receipt.stop output": operation(
    OPERATIONS["receipt.stop"].output,
    { kind: "requested" },
    { kind: "asked" },
  ),
  "receipt.landed input": operation(
    OPERATIONS["receipt.landed"].input,
    { session, receipt },
    { session, receipt: null },
  ),
  "receipt.landed output": operation(
    OPERATIONS["receipt.landed"].output,
    { kind: "landed", commit, run, replaced: null },
    { kind: "moved", revision },
  ),
  "parts.create input": operation(
    OPERATIONS["parts.create"].input,
    {
      session,
      kind: "ask/question",
      input: { state: { title: "Pick" }, placement: { kind: "modal" }, id: part },
    },
    { session, kind: "ask/question", input: { state: null } },
  ),
  "parts.create output": operation(OPERATIONS["parts.create"].output, { part }, { part: 1 }),
  "part.update input": operation(
    OPERATIONS["part.update"].input,
    { session, part, next: { title: "B" } },
    { session, part },
  ),
  "part.update output": operation(
    OPERATIONS["part.update"].output,
    { kind: "invalid", issues: [issue] },
    { kind: "invalid" },
  ),
  "part.act input": operation(
    OPERATIONS["part.act"].input,
    { session, part, action: "pick", input: null },
    { session, part, action: "pick" },
  ),
  "part.act output": operation(
    OPERATIONS["part.act"].output,
    { kind: "ok", output: null },
    { kind: "ok" },
  ),
  "part.answer input": operation(OPERATIONS["part.answer"].input, { session, part }, { part }),
  "part.answer output": operation(
    OPERATIONS["part.answer"].output,
    { action: "pick", input: { choice: "a" } },
    { input: 1 },
  ),
  "part.close input": operation(OPERATIONS["part.close"].input, { session, part }, { session }),
  "part.close output": operation(OPERATIONS["part.close"].output, null, {}),
  "workspace.info input": operation(OPERATIONS["workspace.info"].input, workspaceInput, {}),
  "workspace.watch input": operation(OPERATIONS["workspace.watch"].input, workspaceInput, {
    workspace: 1,
  }),
  "mcp.watch input": operation(OPERATIONS["mcp.watch"].input, workspaceInput, { workspace: 1 }),
  "mcp.reconnect input": operation(
    OPERATIONS["mcp.reconnect"].input,
    { workspace, server: "docs" },
    { workspace, server: 1 },
  ),
  "mcp.setEnabled input": operation(
    OPERATIONS["mcp.setEnabled"].input,
    { workspace, server: "docs", enabled: false },
    { workspace, server: "docs", enabled: "no" },
  ),
  "mcp.login input": operation(
    OPERATIONS["mcp.login"].input,
    { workspace, server: "docs" },
    { workspace },
  ),
  "mcp.login output": operation(OPERATIONS["mcp.login"].output, { login: "key" }, { login: 1 }),
  "mcp.logout input": operation(
    OPERATIONS["mcp.logout"].input,
    { workspace, server: "docs" },
    { server: "docs" },
  ),
  "mcp.add input": operation(
    OPERATIONS["mcp.add"].input,
    {
      workspace,
      server: "docs",
      config: { url: "https://docs.test/mcp", oauth: { clientId: "nyte", callbackPort: 8765 } },
      scope: "user",
    },
    { workspace, server: "docs", config: { url: "https://docs.test/mcp" }, scope: "global" },
  ),
  "mcp.remove input": operation(
    OPERATIONS["mcp.remove"].input,
    { workspace, server: "docs", scope: "project" },
    { workspace, server: "docs" },
  ),
  "workspace.update input": operation(
    OPERATIONS["workspace.update"].input,
    { workspace, patch: { projectResources: false } },
    { workspace, patch: { projectResources: "no" } },
  ),
  "workspace.update output": operation(
    OPERATIONS["workspace.update"].output,
    { kind: "missing" },
    { kind: "gone" },
  ),
  "workspace.reload input": operation(OPERATIONS["workspace.reload"].input, workspaceInput, {}),
  "workspace.reload output": operation(
    OPERATIONS["workspace.reload"].output,
    { kind: "updated" },
    {},
  ),
  "workspace.changes input": operation(
    OPERATIONS["workspace.changes"].input,
    { workspace, run },
    { workspace },
  ),
  "workspace.patches input": operation(
    OPERATIONS["workspace.patches"].input,
    { workspace, run, paths: ["a.ts"], options: { ignoreWhitespace: false } },
    { workspace, run, paths: "a.ts" },
  ),
  "workspace.files input": operation(OPERATIONS["workspace.files"].input, workspaceInput, {}),
  "workspace.git input": operation(OPERATIONS["workspace.git"].input, workspaceInput, {}),
  "workspace.browser input": operation(OPERATIONS["workspace.browser"].input, workspaceInput, {}),
  "jobs.start input": operation(
    OPERATIONS["jobs.start"].input,
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
  "jobs.start output": operation(
    OPERATIONS["jobs.start"].output,
    { ...jobView, key: asId<"job-key">("jk1") },
    jobView,
  ),
  "jobs.recover input": operation(
    OPERATIONS["jobs.recover"].input,
    { workspace, key: asId<"job-key">("jk1") },
    { workspace },
  ),
  "jobs.recover output": operation(
    OPERATIONS["jobs.recover"].output,
    { kind: "ended", end: { kind: "lost" } },
    { kind: "ended" },
  ),
  "jobs.list input": operation(OPERATIONS["jobs.list"].input, workspaceInput, {}),
  "jobs.list output": operation(OPERATIONS["jobs.list"].output, [jobView], [{ id: job }]),
  "jobs.watch input": operation(OPERATIONS["jobs.watch"].input, workspaceInput, {}),
  "jobs.watch output": operation(OPERATIONS["jobs.watch"].output, [], [1]),
  "job.write input": operation(OPERATIONS["job.write"].input, jobInput, { workspace }),
  "job.write output": operation(OPERATIONS["job.write"].output, null, 1),
  "job.output input": operation(OPERATIONS["job.output"].input, jobInput, { job }),
  "job.resize input": operation(
    OPERATIONS["job.resize"].input,
    { ...jobInput, size: { columns: 120, rows: 40 } },
    { ...jobInput, size: { columns: 120 } },
  ),
  "job.resize output": operation(
    OPERATIONS["job.resize"].output,
    { kind: "not-pty" },
    { kind: "shrunk" },
  ),
  "job.idle input": operation(OPERATIONS["job.idle"].input, jobInput, {}),
  "job.idle output": operation(OPERATIONS["job.idle"].output, true, "yes"),
  "job.stop input": operation(OPERATIONS["job.stop"].input, jobInput, {}),
  "job.stop output": operation(
    OPERATIONS["job.stop"].output,
    { kind: "settled", outcome: { kind: "lost" } },
    { kind: "settled" },
  ),
  "job.settled input": operation(OPERATIONS["job.settled"].input, jobInput, {}),
  "files.read input": operation(OPERATIONS["files.read"].input, pathInput, { workspace }),
  "files.bytes input": operation(OPERATIONS["files.bytes"].input, pathInput, { path: "a.ts" }),
  "files.bytes output": operation(OPERATIONS["files.bytes"].output, "", "%%", new Uint8Array()),
  "files.stat input": operation(OPERATIONS["files.stat"].input, pathInput, {}),
  "files.stat output": operation(
    OPERATIONS["files.stat"].output,
    { kind: "symlink", size: 4, version: fileVersion, target: "b.ts" },
    { kind: "socket", size: 4, version: fileVersion },
  ),
  "files.write input": operation(
    OPERATIONS["files.write"].input,
    { ...pathInput, options: { expect: "absent", parents: true } },
    { ...pathInput, options: { expect: 1 } },
  ),
  "files.remove input": operation(
    OPERATIONS["files.remove"].input,
    { ...pathInput, options: { expect: fileVersion } },
    { ...pathInput, options: { expect: null } },
  ),
  "files.batch input": operation(
    OPERATIONS["files.batch"].input,
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
  "files.batch output": operation(OPERATIONS["files.batch"].output, { receipt }, { receipt: null }),
  "files.format input": operation(
    OPERATIONS["files.format"].input,
    { ...pathInput, contents: "x" },
    pathInput,
  ),
  "files.scan input": operation(
    OPERATIONS["files.scan"].input,
    { workspace, directory: "src", ignored: "include" },
    { workspace, ignored: "all" },
  ),
  "files.find input": operation(
    OPERATIONS["files.find"].input,
    { workspace, query: "parser", limit: 5 },
    { workspace },
  ),
  "files.find output": operation(OPERATIONS["files.find"].output, [fileEntry], [{ path: "a.ts" }]),
  "files.search input": operation(
    OPERATIONS["files.search"].input,
    { workspace, query: "TODO" },
    { query: "TODO" },
  ),
  "files.watch input": operation(
    OPERATIONS["files.watch"].input,
    { workspace, paths: ["src"] },
    { workspace, paths: "src" },
  ),
  "files.watch output": operation(
    OPERATIONS["files.watch"].output,
    [{ path: "a.ts", version: null, kind: "removed" }],
    [{ path: "a.ts", kind: "removed" }],
  ),
  "files.upload input": operation(OPERATIONS["files.upload"].input, workspaceInput, {}),
  "git.status input": operation(OPERATIONS["git.status"].input, workspaceInput, {}),
  "git.watch input": operation(OPERATIONS["git.watch"].input, workspaceInput, {}),
  "git.changes input": operation(OPERATIONS["git.changes"].input, gitCompare, { workspace }),
  "git.watchChanges input": operation(OPERATIONS["git.watchChanges"].input, gitCompare, {
    workspace,
    scope: {},
  }),
  "git.patches input": operation(
    OPERATIONS["git.patches"].input,
    { ...gitCompare, paths: ["a.ts"] },
    gitCompare,
  ),
  "git.contents input": operation(
    OPERATIONS["git.contents"].input,
    { ...pathInput, scope: { kind: "staged" } },
    pathInput,
  ),
  "git.log input": operation(
    OPERATIONS["git.log"].input,
    { workspace, cursor, limit: 20 },
    { workspace, limit: "20" },
  ),
  "git.log output": operation(
    OPERATIONS["git.log"].output,
    {
      items: [{ id: gitCommit, subject: "Fix", author: "A", committedAt: 1, parents: [] }],
      next: cursor,
    },
    { items: [], next: 1 },
  ),
  "git.refs input": operation(OPERATIONS["git.refs"].input, workspaceInput, {}),
  "git.blame input": operation(OPERATIONS["git.blame"].input, pathInput, { workspace }),
  "git.stage input": operation(OPERATIONS["git.stage"].input, gitPaths, { workspace }),
  "git.unstage input": operation(OPERATIONS["git.unstage"].input, gitPaths, {
    workspace,
    paths: [1],
  }),
  "git.discard input": operation(OPERATIONS["git.discard"].input, gitPaths, { paths: [] }),
  "git.commit input": operation(
    OPERATIONS["git.commit"].input,
    {
      workspace,
      input: { message: "Fix the parser.", files: ["a.ts"] },
      options: { expect: gitRevision },
    },
    { workspace, input: { message: "Fix.", files: "some" } },
  ),
  "git.branch input": operation(
    OPERATIONS["git.branch"].input,
    { workspace, input: { name: "fix", checkout: true } },
    { workspace, input: { name: "fix" } },
  ),
  "git.push input": operation(
    OPERATIONS["git.push"].input,
    { workspace, input: { setUpstream: true } },
    { workspace, input: { setUpstream: "yes" } },
  ),
  "browser.open input": operation(
    OPERATIONS["browser.open"].input,
    { workspace, url: "https://a.b", id: "open-1" },
    { workspace, url: 1 },
  ),
  "browser.adopt input": operation(
    OPERATIONS["browser.adopt"].input,
    { workspace, id: page },
    { workspace },
  ),
  "browser.list input": operation(OPERATIONS["browser.list"].input, workspaceInput, {}),
  "browser.list output": operation(OPERATIONS["browser.list"].output, [pageInfo], [{ id: page }]),
  "browser.watch input": operation(OPERATIONS["browser.watch"].input, workspaceInput, {}),
  "browser.watch output": operation(OPERATIONS["browser.watch"].output, [], {}),
  "page.view input": operation(OPERATIONS["page.view"].input, pageInput, { page }),
  "page.watch input": operation(OPERATIONS["page.watch"].input, pageInput, { workspace }),
  "page.snapshot input": operation(
    OPERATIONS["page.snapshot"].input,
    { ...pageInput, ref: "e1" },
    { ...pageInput, ref: 1 },
  ),
  "page.navigate input": operation(
    OPERATIONS["page.navigate"].input,
    { ...pageInput, url: "https://a.b" },
    pageInput,
  ),
  "page.back input": operation(OPERATIONS["page.back"].input, pageInput, {}),
  "page.forward input": operation(OPERATIONS["page.forward"].input, pageInput, {}),
  "page.reload input": operation(OPERATIONS["page.reload"].input, pageInput, {}),
  "page.stopLoading input": operation(OPERATIONS["page.stopLoading"].input, pageInput, {}),
  "page.click input": operation(
    OPERATIONS["page.click"].input,
    { ...pageInput, ref: "e1", button: "middle", double: true, expect: documentRevision },
    { ...pageInput, ref: "e1", button: "side" },
  ),
  "page.type input": operation(
    OPERATIONS["page.type"].input,
    { ...pageInput, ref: "e1", text: "hi", clear: true, submit: false },
    { ...pageInput, ref: "e1" },
  ),
  "page.press input": operation(
    OPERATIONS["page.press"].input,
    { ...pageInput, key: "Enter" },
    pageInput,
  ),
  "page.scroll input": operation(
    OPERATIONS["page.scroll"].input,
    { ...pageInput, direction: "bottom", pages: 2 },
    { ...pageInput, direction: "left" },
  ),
  "page.wait input": operation(
    OPERATIONS["page.wait"].input,
    { ...pageInput, condition: { kind: "text", text: "Done", present: true } },
    { ...pageInput, condition: { kind: "idle" } },
  ),
  "page.console input": operation(
    OPERATIONS["page.console"].input,
    { ...pageInput, limit: 10, clear: true },
    { ...pageInput, clear: "yes" },
  ),
  "page.console output": operation(
    OPERATIONS["page.console"].output,
    [{ level: "error", text: "Boom.", at: 1 }],
    [{ level: "fatal", text: "Boom.", at: 1 }],
  ),
  "page.capture input": operation(OPERATIONS["page.capture"].input, pageInput, {}),
  "page.capture output": operation(
    OPERATIONS["page.capture"].output,
    "aGk=",
    1,
    Uint8Array.of(104, 105),
  ),
  "page.evaluate input": operation(
    OPERATIONS["page.evaluate"].input,
    { ...pageInput, expression: "document.title", options: { ref: "e1" } },
    pageInput,
  ),
  "page.evaluate output": operation(
    OPERATIONS["page.evaluate"].output,
    { kind: "value", value: { title: "A" } },
    { kind: "threw" },
  ),
  "page.close input": operation(OPERATIONS["page.close"].input, pageInput, {}),
  "page.close output": operation(OPERATIONS["page.close"].output, null, "closed"),
  "plugins.replace input": operation(
    OPERATIONS["plugins.replace"].input,
    { plugins: [{ path: "/plugins/maps.ts" }], scope: { session } },
    { plugins: [{ id: "maps" }] },
  ),
  "plugins.check input": operation(
    OPERATIONS["plugins.check"].input,
    { plugins: [{ path: "/plugins/maps.ts" }] },
    { plugins: ["/plugins/maps.ts"] },
  ),
  "principals.list input": operation(OPERATIONS["principals.list"].input, {}, 1),
  "principals.list output": operation(
    OPERATIONS["principals.list"].output,
    [{ id: principal, label: "Phone", authority: ["participant"], pairedAt: 1 }],
    [{ id: principal, label: "Phone", authority: "participant", pairedAt: 1 }],
  ),
  "principals.pair input": operation(
    OPERATIONS["principals.pair"].input,
    { authority: ["participant", "owner"], label: "Phone" },
    { authority: ["root"] },
  ),
  "principals.pair output": operation(
    OPERATIONS["principals.pair"].output,
    { code: "123-456", expiresAt: 1 },
    { code: "123-456" },
  ),
  "principals.revoke input": operation(
    OPERATIONS["principals.revoke"].input,
    { id: principal },
    {},
  ),
  "principals.revoke output": operation(OPERATIONS["principals.revoke"].output, null, true),
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
  ModelAccountSchema: sample(
    ModelAccountSchema,
    { provider: "test", id: "work", label: "Work", method: { kind: "oauth" }, active: true },
    { provider: "test", id: "work", label: "Work", method: { kind: "oauth" } },
  ),
  ProviderUsageSchema: sample(
    ProviderUsageSchema,
    {
      provider: "test",
      name: "Test",
      account: null,
      state: {
        kind: "ready",
        limits: [{ label: "5h", used: 25, limit: 100, resetsAt: null }],
        observedAt: 1_000,
        stale: false,
        error: null,
      },
    },
    { provider: "test", name: "Test", account: null, state: { kind: "unavailable" } },
  ),
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
  McpChangeSchema: sample(
    McpChangeSchema,
    { kind: "invalid", message: "docs needs a url." },
    { kind: "invalid" },
  ),
  McpServerConfigSchema: sample(
    McpServerConfigSchema,
    {
      command: "npx",
      args: ["-y", "server-files", "."],
      env: { TOKEN: "${TOKEN}" },
      exposure: "direct",
      toolExposure: { "delete_*": "hidden" },
    },
    { command: "npx", exposure: "everywhere" },
  ),
  McpViewSchema: sample(
    McpViewSchema,
    {
      servers: [
        {
          name: "docs",
          scope: "user",
          path: "/home/me/.nyte/mcp.json",
          override: null,
          transport: { kind: "http", url: "https://docs.test/mcp" },
          exposure: "code",
          description: null,
          state: {
            kind: "connected",
            tools: [{ name: "search", description: "Search the docs.", exposure: "model" }],
          },
        },
        {
          name: "files",
          scope: "project",
          path: "/repo/.nyte/mcp.json",
          override: null,
          transport: { kind: "stdio", command: "npx", args: ["-y", "server-files"] },
          exposure: "hidden",
          description: "Project files",
          state: { kind: "failed", message: "files failed to connect", stderr: null },
        },
      ],
      issues: [{ severity: "error", path: ["mcpServers", "bad"], message: "bad needs a url." }],
    },
    { servers: [{ name: "docs", state: { kind: "asleep" } }], issues: [] },
  ),
  WorkspaceInfoSchema: sample(
    WorkspaceInfoSchema,
    {
      id: workspace,
      target: { kind: "local", path: "/repo" },
      identity,
      availability: { kind: "available" },
      projectResources: true,
      trusted: true,
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
      seq: asSeq(4),
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
  PrincipalViewWireSchema: sample(
    PrincipalViewWireSchema,
    { id: principal, label: "Phone", authority: ["participant"], pairedAt: 1 },
    { id: principal, label: "Phone", authority: {}, pairedAt: 1 },
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
    const exported = readdirSync(wire)
      .filter((file) => file.endsWith(".ts"))
      .flatMap((file) =>
        [
          ...readFileSync(new URL(file, wire), "utf8").matchAll(/^export const (\w+Schema)\b/gm),
        ].map((match) => match[1]),
      );
    const named = Object.keys(cases).filter((name) => !Object.hasOwn(operations, name));

    expect(named.toSorted()).toEqual(exported.toSorted());
  });

  it("covers every operation's input and output", () => {
    const covered = new Set(Object.values(cases).map((entry) => entry.schema));
    const missing = Object.entries(OPERATIONS).flatMap(([name, row]) =>
      covered.has(row.input) && covered.has(row.output) ? [] : [name],
    );

    expect(missing).toEqual([]);
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

  it("round-trips a live part status holding an early answer and rejects an answer without an action (§48i)", async () => {
    const status: PartStatus = {
      kind: "live",
      run: null,
      answer: { action: "answer", input: { choice: "yes" } },
    };
    const wire: unknown = JSON.parse(JSON.stringify(status));

    expect(await PartStatusSchema["~standard"].validate(wire)).toEqual({ value: status });
    expect(
      (await PartStatusSchema["~standard"].validate({ ...status, answer: { input: null } })).issues
        ?.length,
    ).toBeGreaterThan(0);
  });

  it("round-trips a tool's namespace through JSON, null or named, and rejects one that is neither (§48d)", async () => {
    const named: ToolInfo = {
      ...catalog.tools[0],
      name: "linear_search",
      owner: "mcp",
      namespace: "mcp/linear",
    };

    for (const info of [catalog.tools[0], named]) {
      const wire: unknown = JSON.parse(JSON.stringify(info));

      expect(await ToolInfoSchema["~standard"].validate(wire)).toEqual({ value: info });
    }

    const unnamed = {
      name: named.name,
      owner: named.owner,
      description: named.description,
      parameters: named.parameters,
      output: named.output,
      exposure: named.exposure,
    };

    expect((await ToolInfoSchema["~standard"].validate(unnamed)).issues?.length).toBeGreaterThan(0);
    expect(
      (await ToolInfoSchema["~standard"].validate({ ...named, namespace: 7 })).issues?.length,
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
