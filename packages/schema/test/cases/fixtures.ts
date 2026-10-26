import { asId, asSeq, writePatch } from "../../src/index.ts";
import type {
  BackgroundItem,
  Configuration,
  ContextView,
  DurableEvent,
  Execution,
  Failure,
  FileChange,
  HeadInfo,
  Hunk,
  Message,
  ModelInfo,
  ModelRef,
  PageSnapshot,
  PartStatus,
  PatchEntry,
  RunEnd,
  RunView,
  Schema,
  SendOptions,
  SessionCatalogView,
  SessionEvent,
  SessionInfo,
  SettingInfo,
  ToolOutcome,
  TurnInfo,
  Usage,
  UserContent,
  ValidationIssue,
  WaitTarget,
} from "../../src/index.ts";

export type Case = {
  readonly schema: Schema<unknown>;
  readonly good: unknown;
  readonly bad: unknown;
  readonly decoded?: unknown;
};

export function sample<T>(schema: Schema<T>, good: NoInfer<T>, bad: unknown): Case {
  return { schema, good, bad };
}

export function operation(
  schema: Schema<unknown>,
  good: unknown,
  bad: unknown,
  decoded?: unknown,
): Case {
  return { schema, good, bad, decoded };
}

export const session = asId<"session">("s1");

export const head = asId<"head">("main");

export const run = asId<"run">("r1");

export const call = asId<"call">("c1");

export const message = asId<"message">("m1");

export const turn = asId<"turn">("t1");

export const commit = asId<"commit">("k1");

export const object = asId<"object">("o1");

export const blob = asId<"blob">("b1");

export const part = asId<"part">("p1");

export const receipt = asId<"receipt">("rc1");

export const job = asId<"job">("j1");

export const workspace = asId<"workspace">("w1");

export const page = asId<"page">("pg1");

export const host = asId<"host">("h1");

export const principal = asId<"principal">("local");

export const snapshot = asId<"snapshot">("sn1");

export const gitCommit = asId<"git-commit">("abc123");

export const gitRevision = asId<"git-revision">("gr1");

export const fileVersion = asId<"file-version">("fv1");

export const documentRevision = asId<"document-revision">("dr1");

export const revision = asId<"revision">("rv1");

export const generation = asId<"catalog-generation">("g1");

export const cursor = asId<"cursor">("cur1");

export const identity = asId<"environment-identity">("ei1");

export const usage: Usage = {
  input: 10,
  output: 5,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: null,
  total: 15,
  cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 },
};

export const modelRef: ModelRef = { provider: "anthropic", id: "claude" };

export const configuration: Configuration = {
  kind: "exact",
  model: modelRef,
  thinking: "low",
  agent: null,
  settings: { "core/x": { nested: [1, "two", null, true] } },
  settingsVersion: "v1",
};

export const runView: RunView = {
  id: run,
  head,
  startedAt: 1,
  attempt: 0,
  origin: { kind: "input", message },
};

export const runEnd: RunEnd = { kind: "completed", usage };

export const failure: Failure = { class: "network", message: "Offline.", retryAfterMs: 1000 };

export const waitTarget: WaitTarget = { kind: "run", session, run, deadline: 5 };

export const execution: Execution = {
  kind: "live",
  run: runView,
  phase: "responding",
  stopping: false,
};

export const issue: ValidationIssue = {
  severity: "error",
  path: ["a", 0],
  message: "Bad.",
  source: { plugin: "p", file: "f.ts", line: 3 },
};

export const headInfo: HeadInfo = {
  name: head,
  tip: { kind: "commit", id: commit },
  stack: { parent: head, base: { kind: "start" }, stale: false },
  execution,
  unread: true,
};

export const sessionInfo: SessionInfo = {
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

export const settingInfo: SettingInfo = {
  id: "core/theme",
  owner: "core",
  scope: "host",
  label: "Theme",
  schema: { enum: ["dark", "light"] },
  choices: [{ value: "dark", label: "Dark", badge: "new" }],
  value: "dark",
  from: "default",
};

export const catalog: SessionCatalogView = {
  commands: [
    {
      name: "review",
      owner: "core",
      side: "core",
      title: "Review",
      description: "Reviews.",
      takesText: true,
      completes: true,
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

export const contextView: ContextView = { tokens: 100, window: 200000, lastRequest: usage };

export const fileChange: FileChange = {
  path: "a.ts",
  status: "renamed",
  added: 1,
  removed: 2,
  from: "b.ts",
};

export const toolOutcome: ToolOutcome = {
  kind: "ok",
  content: [
    { kind: "text", text: "done" },
    { kind: "file", blob, mime: "image/png" },
  ],
  output: { rows: 2 },
  parts: [part],
};

export const background: BackgroundItem = {
  kind: "job",
  id: "j1",
  title: "npm test",
  state: "working",
  startedBy: call,
};

export const userContent: UserContent = [
  { kind: "text", text: "hi" },
  { kind: "file", blob, mime: "image/png", name: "a.png" },
  { kind: "reference", path: "src/a.ts" },
];

export const partStatus: PartStatus = { kind: "waiting", run, on: { kind: "part", part } };

export const hunk: Hunk = {
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

export const patchEntry: PatchEntry = {
  path: "a.ts",
  status: "modified",
  digest: "d1",
  kind: "text",
  added: 1,
  removed: 0,
  patch: writePatch("a.ts", "modified", [hunk]),
};

export const pageSnapshot: PageSnapshot = {
  revision: documentRevision,
  nodes: [{ ref: "e1", role: "button", name: "Go", editable: false, depth: 2 }],
};

export const modelInfo: ModelInfo = {
  ref: modelRef,
  name: "Claude",
  reasoning: true,
  thinking: ["off", "high"],
  defaultThinking: "high",
  fast: null,
  contextWindow: 200000,
  compactAt: 160000,
  maxOutput: 64000,
  input: ["text", "image"],
  capabilities: { steer: true },
  cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
};

export const sendOptions: SendOptions = {
  delivery: "queue",
  replace: message,
  running: "stop",
  abandoned: { summarize: { instructions: "Short." } },
  expect: revision,
  position: { kind: "before", message },
  source: { kind: "user" },
  id: receipt,
};

export const userMessage: Extract<Message, { readonly kind: "user" }> = {
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

export const partMessage: Message = {
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

export const touched = { count: 1, paths: ["a.ts"] };

export const turnInfo: TurnInfo = {
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

export const events = {
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
    {
      seq: asSeq(27),
      at: 1,
      head,
      kind: "request",
      model: modelRef,
      usage,
      context: contextView,
      step: "plugin",
    },
  ],
  changes: [
    { seq: asSeq(28), at: 1, head: null, kind: "changes", files: [fileChange] },
    {
      seq: asSeq(28),
      at: 1,
      head: null,
      kind: "changes",
      change: "merged",
      files: [fileChange],
      cleared: ["b.ts"],
    },
  ],
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

export const durableEvent: DurableEvent = {
  head,
  kind: "head",
  from: commit,
  to: null,
  reason: "removed",
};

export const sessionInput = { session };

export const headInput = { session, head };

export const workspaceInput = { workspace };

export const jobInput = { workspace, job };

export const pageInput = { workspace, page };

export const pathInput = { workspace, path: "a.ts" };

export const workspaceInfo = {
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
  isolation: null,
};

export const jobView = {
  id: job,
  command: "npm test",
  title: "Tests",
  session: null,
  pty: null,
  state: { kind: "running" },
  startedAt: 1,
  endedAt: null,
  tail: "",
  foreground: false,
};

export const pageInfo = { id: page, url: "https://a.b", title: "A", holders: 1 };

export const fileEntry = { path: "a.ts", kind: "file", size: 3, version: fileVersion };

export const gitCompare = {
  workspace,
  scope: { kind: "worktree" },
  options: { ignoreWhitespace: true },
};

export const gitPaths = { workspace, paths: ["a.ts"], options: { expect: gitRevision } };

export const settled = { kind: "settled", outcome: runEnd };
