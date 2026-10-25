import { Type } from "typebox";
import type { Static, TProperties, TSchema } from "typebox";

function record<P extends TProperties>(properties: P) {
  return Type.ReadonlyObject(Type.Object(properties));
}

function list<T extends TSchema>(item: T) {
  return Type.Immutable(Type.Array(item));
}

const Text = Type.String();

const Count = Type.Number();

const MaybeText = Type.Union([Type.String(), Type.Null()]);

const MaybeCount = Type.Union([Type.Number(), Type.Null()]);

const Texts = list(Type.String());

export const TraceType = Type.Union([
  record({ kind: Type.Literal("session"), id: Text }),
  record({ kind: Type.Literal("pull-request"), number: Count }),
  record({ kind: Type.Literal("worktree"), path: Text }),
]);

export type Trace = Static<typeof TraceType>;

export const BaselineIdType = Type.Union([
  Type.Literal("hand-skills"),
  Type.Literal("restated-rules"),
  Type.Literal("subagent-share"),
  Type.Literal("child-steering"),
  Type.Literal("opus-ci-polling"),
  Type.Literal("opus-sleep-turns"),
  Type.Literal("pr-to-merge"),
  Type.Literal("red-prs"),
  Type.Literal("ci-never-green"),
  Type.Literal("unattributed-calls"),
  Type.Literal("shared-checkout-writers"),
  Type.Literal("worktree-disk"),
  Type.Literal("copied-files"),
  Type.Literal("hand-recovery"),
]);

export type BaselineId = Static<typeof BaselineIdType>;

const UnitType = Type.Union([
  Type.Literal("messages"),
  Type.Literal("prompts"),
  Type.Literal("percent"),
  Type.Literal("usd"),
  Type.Literal("turns"),
  Type.Literal("hours"),
  Type.Literal("prs"),
  Type.Literal("runs"),
  Type.Literal("calls"),
  Type.Literal("chats"),
  Type.Literal("gigabytes"),
  Type.Literal("files"),
]);

const BaselineType = record({
  id: BaselineIdType,
  source: Type.Union([Type.Literal("store"), Type.Literal("github"), Type.Literal("disk")]),
  label: Text,
  value: Count,
  unit: UnitType,
  detail: Text,
  query: Text,
});

export type Baseline = Static<typeof BaselineType>;

const SessionFactType = record({
  id: Text,
  title: MaybeText,
  parent: MaybeText,
  folder: MaybeText,
  isolation: Type.Union([record({ branch: Text, base: Text }), Type.Null()]),
  createdAt: Count,
  lastActivityAt: Count,
  archived: Type.Boolean(),
  runs: Count,
  running: Type.Boolean(),
  costUsd: Count,
  models: Texts,
  contextTokens: Count,
  humanMessages: Count,
  skills: Texts,
  opened: list(Count),
});

export type SessionFact = Static<typeof SessionFactType>;

const CheckStateType = Type.Union([
  Type.Literal("passed"),
  Type.Literal("failed"),
  Type.Literal("pending"),
  Type.Literal("skipped"),
]);

export type CheckState = Static<typeof CheckStateType>;

const CheckFailureType = record({ step: Text, files: Texts, message: Text });

export type CheckFailure = Static<typeof CheckFailureType>;

const CheckFactType = record({
  workflow: Text,
  name: Text,
  state: CheckStateType,
  runId: MaybeCount,
  failure: Type.Union([CheckFailureType, Type.Null()]),
});

export type CheckFact = Static<typeof CheckFactType>;

const PullRequestFactType = record({
  number: Count,
  title: Text,
  state: Type.Union([Type.Literal("OPEN"), Type.Literal("MERGED"), Type.Literal("CLOSED")]),
  base: Text,
  head: Text,
  headSha: Text,
  createdAt: Count,
  mergedAt: MaybeCount,
  closedAt: MaybeCount,
  openedBy: MaybeText,
  checks: list(CheckFactType),
});

export type PullRequestFact = Static<typeof PullRequestFactType>;

const WorktreeFactType = record({
  path: Text,
  branch: MaybeText,
  head: Text,
  owner: MaybeText,
  base: MaybeText,
  ahead: Count,
  merged: Type.Boolean(),
  bytes: Count,
  uncommitted: record({ snapshot: MaybeText, own: Texts, copied: Texts, unknown: Texts }),
});

export type WorktreeFact = Static<typeof WorktreeFactType>;

const FileLossType = record({ path: Text, added: Count, removed: Count, whole: Type.Boolean() });

export type FileLoss = Static<typeof FileLossType>;

const RecoveryAskType = record({
  session: Text,
  at: Count,
  ask: Type.Union([Type.Literal("redo"), Type.Literal("split")]),
  runs: Count,
  costUsd: Count,
  minutes: Count,
});

export type RecoveryAsk = Static<typeof RecoveryAskType>;

const RestoredFileType = record({
  path: Text,
  differingLines: Count,
  laterEdit: Type.Union([
    record({ session: Text, at: Count, removed: Count, added: Count }),
    Type.Null(),
  ]),
});

export type RestoredFile = Static<typeof RestoredFileType>;

const CiFixFactType = record({
  session: Text,
  title: Text,
  model: Text,
  requests: Count,
  minutes: Count,
  recordedUsd: Count,
  atSolUsd: Count,
});

export type CiFixFact = Static<typeof CiFixFactType>;

const PriceFactType = record({
  model: Text,
  input: Count,
  output: Count,
  cacheRead: Count,
  cacheWrite: Count,
  source: Text,
});

export type PriceFact = Static<typeof PriceFactType>;

export const EvidenceType = record({
  exportedAt: Count,
  observedAt: Count,
  sources: record({ store: Text, repository: Text, github: Text, head: Text, originMain: Text }),
  window: record({ from: Count, to: Count }),
  baselines: list(BaselineType),
  sessions: list(SessionFactType),
  pullRequests: list(PullRequestFactType),
  base: record({ branch: Text, sha: Text, at: Count, checks: list(CheckFactType) }),
  worktrees: list(WorktreeFactType),
  checkout: record({
    folder: Text,
    workspaces: Texts,
    chats: Count,
    changedFiles: Count,
    writersAtWipe: Texts,
    runningAtWipe: Texts,
    writersNow: Texts,
  }),
  incident: record({
    session: Text,
    run: Text,
    call: Text,
    at: Count,
    command: Text,
    recorded: record({ paths: Count, unattributed: Type.Boolean() }),
    before: Text,
    after: Text,
    keptIn: Text,
    lost: list(FileLossType),
    asked: list(RecoveryAskType),
    restored: list(RestoredFileType),
    restoreDirectory: Text,
  }),
  ciFixes: list(CiFixFactType),
  prices: list(PriceFactType),
});

export type Evidence = Static<typeof EvidenceType>;

export const CheckResultType = record({
  id: Text,
  title: Text,
  pass: Type.Boolean(),
  detail: Text,
  sql: MaybeText,
});

export type CheckResult = Static<typeof CheckResultType>;
