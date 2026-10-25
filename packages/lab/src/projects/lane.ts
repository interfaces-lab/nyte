import type { PullRequestFact, SessionFact, WorktreeFact } from "./evidence.ts";

export type Thinking = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelChoice {
  readonly provider: string;
  readonly id: string;
  readonly thinking: Thinking;
}

export interface SkillRef {
  readonly name: string;
  readonly location: string;
}

export interface RoleRule {
  readonly model: ModelChoice;
  readonly skills: readonly SkillRef[];
}

export type Role = "author" | "worker" | "reviewer" | "babysitter" | "keeper";

export interface Budget {
  readonly attempts: number;
  readonly usd: number;
  readonly days: number;
}

export interface Limits {
  readonly workers: number;
  readonly watched: number;
  readonly dailyUsd: number;
  readonly perPullRequest: Budget;
  readonly pollPendingSeconds: number;
  readonly pollSettledSeconds: number;
}

export interface Remedy {
  readonly check: string;
  readonly step: string;
  readonly command: string;
  readonly commit: string;
}

export interface Trigger {
  readonly id: string;
  readonly when: {
    readonly source: "github";
    readonly event: "pull-request-opened";
    readonly branches: "lane";
  };
  readonly action: { readonly kind: "babysit"; readonly role: "babysitter" };
  readonly until: readonly ("merged" | "closed" | "ready")[];
  readonly budget: Budget;
}

export interface LaneRules {
  readonly roles: {
    readonly worker: RoleRule;
    readonly reviewer: RoleRule;
    readonly babysitter: RoleRule;
  };
  readonly checkout: { readonly from: string; readonly copyUncommitted: false };
  readonly commit: { readonly by: "reviewer"; readonly message: string; readonly branch: string };
  readonly pullRequest: {
    readonly by: "reviewer";
    readonly base: string;
    readonly gate: readonly string[];
    readonly merge: "ask";
    readonly restack: "ask";
  };
  readonly never: readonly string[];
  readonly remedies: readonly Remedy[];
  readonly asks: readonly { readonly workflow: string; readonly question: string }[];
  readonly triggers: readonly Trigger[];
  readonly limits: Limits;
  readonly decisions: readonly string[];
  readonly requires: {
    readonly cli: readonly string[];
    readonly mcp: readonly { readonly name: string; readonly url: string }[];
  };
}

export type Until =
  | { readonly kind: "standing" }
  | { readonly kind: "goal"; readonly by: string; readonly done: string };

export interface Lane {
  readonly id: string;
  readonly host: string;
  readonly name: string;
  readonly intent: string;
  readonly until: Until;
  readonly repository: string;
  readonly state: "active" | "paused" | "archived";
  readonly rules: LaneRules;
  readonly createdAt: number;
}

export interface Membership {
  readonly session: string;
  readonly lane: string;
  readonly role: Role;
  readonly joinedAt: number;
  readonly via: "started" | "dragged" | "trigger";
}

export interface WriterLease {
  readonly checkout: string;
  readonly session: string;
  readonly since: number;
  readonly until: number | null;
  readonly via: "isolated" | "handed" | "implicit";
}

export interface PullRequestLink {
  readonly session: string;
  readonly number: number;
  readonly head: string;
  readonly base: string;
  readonly via: "created" | "branch" | "adopted";
  readonly at: number;
}

export type CheckOutcome = "passed" | "failed" | "pending" | "skipped";

export interface ObservedCheck {
  readonly workflow: string;
  readonly name: string;
  readonly outcome: CheckOutcome;
  readonly runId: number | null;
  readonly step: string | null;
  readonly files: readonly string[];
}

export interface PullObservation {
  readonly number: number;
  readonly state: "OPEN" | "MERGED" | "CLOSED";
  readonly head: string;
  readonly headSha: string;
  readonly base: string;
  readonly baseSha: string;
  readonly checks: readonly ObservedCheck[];
  readonly unresolvedThreads: number;
  readonly mergeable: boolean;
}

export interface BaseObservation {
  readonly branch: string;
  readonly sha: string;
  readonly checks: readonly ObservedCheck[];
}

export interface Observation {
  readonly at: number;
  readonly pulls: readonly PullObservation[];
  readonly bases: readonly BaseObservation[];
}

export interface PullRequestWatch {
  readonly number: number;
  readonly lane: string;
  readonly owner: string;
  readonly author: string;
  readonly budget: Budget;
  readonly startedAt: number;
  readonly attempts: number;
  readonly spentUsd: number;
  readonly stop: { readonly reason: StopReason; readonly at: number } | null;
}

export type StopReason =
  | "merged"
  | "closed"
  | "budget"
  | "attempts"
  | "expired"
  | "pushed-by-someone-else";

export type EventKind =
  | "check-failed"
  | "checks-passed"
  | "pushed"
  | "thread-opened"
  | "base-moved"
  | "merged"
  | "closed";

export interface TriggerEvent {
  readonly key: string;
  readonly kind: EventKind;
  readonly pull: number | null;
  readonly branch: string;
  readonly subject: string;
  readonly check: ObservedCheck | null;
}

export type Decision =
  | { readonly kind: "ignore"; readonly reason: string }
  | { readonly kind: "wake"; readonly message: string }
  | { readonly kind: "route"; readonly to: string; readonly cause: string }
  | { readonly kind: "ask"; readonly question: string; readonly cause: string }
  | { readonly kind: "remedy"; readonly command: string; readonly commit: string }
  | { readonly kind: "stop"; readonly reason: StopReason };

export interface Dispatch {
  readonly key: string;
  readonly lane: string;
  readonly owner: string;
  readonly event: TriggerEvent;
  readonly decision: Decision;
  readonly at: number;
  readonly costUsd: number;
}

export interface CallFact {
  readonly session: string;
  readonly checkout: string;
  readonly at: number;
  readonly changed: boolean;
  readonly snapshot: string | null;
}

export interface DesignedSession {
  readonly id: string;
  readonly title: string;
  readonly role: Role;
  readonly parent: string | null;
  readonly model: string;
  readonly running: boolean;
  readonly costUsd: number;
  readonly contextTokens: number;
}

export interface World {
  readonly at: number;
  readonly sessions: readonly SessionFact[];
  readonly pullRequests: readonly PullRequestFact[];
  readonly designed: readonly DesignedSession[];
  readonly worktrees: readonly WorktreeFact[];
  readonly answered: readonly string[];
  readonly lanes: readonly Lane[];
  readonly memberships: readonly Membership[];
  readonly leases: readonly WriterLease[];
  readonly links: readonly PullRequestLink[];
  readonly pullRequestWatches: readonly PullRequestWatch[];
  readonly dispatches: readonly Dispatch[];
  readonly observation: Observation;
  readonly calls: readonly CallFact[];
  readonly kept: readonly string[];
}

export type Presence = "exists" | "partial" | "missing";

export interface RecordNote {
  readonly record: string;
  readonly presence: Presence;
  readonly where: string;
}

export type DesignedRecord =
  | "lanes"
  | "memberships"
  | "leases"
  | "links"
  | "pullRequestWatches"
  | "dispatches"
  | "observation"
  | "calls"
  | "kept";

export const RECORDS: Readonly<Record<DesignedRecord, RecordNote>> = {
  lanes: {
    record: "Lane, a host key-value entry kv/host/lanes/<lane>",
    presence: "partial",
    where: "the kv record kind exists, records.ts:303-319; nothing stores a lane",
  },
  memberships: {
    record: "the main head's agent, lane.<lane>, set by Head.configure",
    presence: "partial",
    where:
      "HeadRecord.selected.agent, records.ts:53-61, and agents with a prompt, tools and a pinned model, plugin.ts:116-126; no lane agents exist",
  },
  leases: {
    record: "the session family that owns a worktree; one session of it runs at a time",
    presence: "partial",
    where:
      "WorkspaceRecord.isolation.session names a worktree's owner, records.ts:230; nothing names a shared checkout's writer",
  },
  links: {
    record:
      "derived: the PR whose head is the family's worktree branch, else the URL its own gh pr create printed",
    presence: "partial",
    where:
      "WorkspaceRecord.isolation.branch and settled call outcomes in the log; github.ts:48-53 reads only the open folder's branch",
  },
  pullRequestWatches: {
    record:
      "derived from the lane's trigger, the PR's observations and its babysitter's wakes and spend",
    presence: "missing",
    where: "the app polls checks only for the open folder, github-account.ts:17",
  },
  dispatches: {
    record:
      "Dispatch, created only if absent; a wake is a send whose receipt id is the dispatch key",
    presence: "partial",
    where:
      "send receipts make start and send idempotent, records.ts:146-181; no record holds ignored, routed or asked events",
  },
  observation: {
    record: "the newest PullObservation and BaseObservation per repository, with a digest",
    presence: "missing",
    where: "GitHubPullRequest has no head SHA, run id or threads, github.ts:34-43",
  },
  calls: {
    record: "settled call events with changes, and run snapshots",
    presence: "exists",
    where: "tool-runner.ts:587-636; RunRecord.snapshot and lastSnapshot, records.ts:110-112",
  },
  kept: {
    record: "snapshot trees under refs/nyte/kept",
    presence: "exists",
    where: "packages/host/src/local/snapshots.ts:93",
  },
};

export type Stage =
  | "chat"
  | "worktree"
  | "snapshots"
  | "commits"
  | "pull-request"
  | "checks"
  | "review"
  | "ready"
  | "merged"
  | "cleaned";

export interface StageNote extends RecordNote {
  readonly stage: Stage;
  readonly label: string;
  readonly next: readonly Stage[];
  readonly by: string;
}

export const LIFECYCLE: readonly StageNote[] = [
  {
    stage: "chat",
    label: "Chat",
    next: ["worktree"],
    by: "the lane starts a worker, or you drag a chat in",
    record: "SessionRecord; its main head's agent, lane.<lane>, says which lane's rules it follows",
    presence: "partial",
    where: "records.ts:53-84 and agents, plugin.ts:116-126; no lane agents exist",
  },
  {
    stage: "worktree",
    label: "Worktree and branch",
    next: ["snapshots"],
    by: "isolation from origin/main with nothing copied in; the session takes the writer lease",
    record:
      "WorkspaceRecord.isolation {source, session, branch, base}, plus a WriterLease keyed by checkout root",
    presence: "partial",
    where: "records.ts:223-231 and delegation.ts:41-48, which copies uncommitted changes in",
  },
  {
    stage: "snapshots",
    label: "Snapshots",
    next: ["commits"],
    by: "every call that can write takes an after-snapshot, kept under refs/nyte/kept",
    record: "RunRecord.snapshot and lastSnapshot; settled call events with changes",
    presence: "exists",
    where: "records.ts:110-112, snapshots.ts:93, tool-runner.ts:587-636",
  },
  {
    stage: "commits",
    label: "Commits",
    next: ["pull-request", "snapshots"],
    by: "the reviewer commits in the worker's worktree after the lease is handed to it",
    record: "git only: the branch ahead of its base",
    presence: "partial",
    where: "no store record links a commit to the session that made it",
  },
  {
    stage: "pull-request",
    label: "Pull request",
    next: ["checks"],
    by: "the reviewer opens it with gh pr create; the family's worktree branch then names it",
    record:
      "derived link: the PR whose head is the family's worktree branch, else the URL its own gh pr create printed",
    presence: "partial",
    where:
      "isolation.branch and settled call outcomes exist; github.ts:48-53 reads only the open folder's branch",
  },
  {
    stage: "checks",
    label: "Checks",
    next: ["review", "snapshots"],
    by: "the watch observes them without a model; an own failure wakes the babysitter, an inherited one routes to the base",
    record: "PullObservation with head SHA, check runs, steps and files; Dispatch per event",
    presence: "missing",
    where: "GitHubCheck has no run id, step or head SHA, github.ts:25-29",
  },
  {
    stage: "review",
    label: "Review",
    next: ["ready", "snapshots"],
    by: "the lane's reviewer approved before the PR; GitHub review threads reach the babysitter as dispatches",
    record: "unresolved threads and review decision in the PullObservation",
    presence: "missing",
    where: "GitHubPullRequest has no reviews or comments, github.ts:34-43",
  },
  {
    stage: "ready",
    label: "Ready to merge",
    next: ["merged"],
    by: "every gate check passed on the head, no unresolved thread, mergeable: the watch asks you",
    record: "a Dispatch whose decision asks you to merge",
    presence: "missing",
    where: "nothing decides readiness today",
  },
  {
    stage: "merged",
    label: "Merged",
    next: ["cleaned"],
    by: "you merge; the watch sees it and stops",
    record: "PullObservation.state and PullRequestWatch.stop",
    presence: "missing",
    where: "nothing records a merge",
  },
  {
    stage: "cleaned",
    label: "Cleaned up",
    next: [],
    by: "release removes the worktree once its newest snapshot is kept and its branch merged",
    record: "releaseWorktree and the workspace record's removal",
    presence: "partial",
    where: "worktrees.ts:96-147 keeps every dirty folder, so 28.3 GB stay on disk",
  },
];
