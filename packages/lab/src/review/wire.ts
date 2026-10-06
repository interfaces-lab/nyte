/**
 * What the lab's review core and the Review page exchange. The core validates
 * every request against these schemas and the page validates every reply, so
 * neither side trusts the other's JSON.
 */
import { schemas } from "@nyte-ai/protocol";
import { Type, type Static } from "typebox";

const Oid = Type.String({ pattern: "^[0-9a-f]{40}$" });

export const GuideSectionSchema = Type.Object({
  title: Type.String({ minLength: 1 }),
  explanation: Type.String({ minLength: 1 }),
  /** Changed files, or directories ending in `/` that stand for every changed file under them. */
  paths: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
});

export type GuideSection = Static<typeof GuideSectionSchema>;

/** What `publish_guide` takes, and what a finished brief carries. */
export const GuideSchema = Type.Object({
  base: Oid,
  head: Oid,
  sections: Type.Array(GuideSectionSchema, { minItems: 1, maxItems: 10 }),
});

export type Guide = Static<typeof GuideSchema>;

export const CommitSchema = Type.Object({
  oid: Oid,
  short: Type.String(),
  subject: Type.String(),
  author: Type.String(),
  at: Type.Number(),
  parents: Type.Array(Type.String()),
  /** The message past its subject line; empty for most commits. */
  body: Type.String(),
});

export type Commit = Static<typeof CommitSchema>;

const fileChangeFields = {
  path: Type.String(),
  previousPath: Type.Optional(Type.String()),
  status: Type.Union([
    Type.Literal("added"),
    Type.Literal("modified"),
    Type.Literal("deleted"),
    Type.Literal("renamed"),
  ]),
  added: Type.Number(),
  removed: Type.Number(),
  binary: Type.Boolean(),
  /** The file's blob before and after, `old..new`: a reviewed mark keeps it and goes stale when it changes. */
  blobs: Type.String(),
};

export const FileChangeSchema = Type.Object(fileChangeFields);

export type FileChange = Static<typeof FileChangeSchema>;

export const BriefStatusSchema = Type.Union([
  Type.Literal("running"),
  Type.Literal("done"),
  Type.Literal("failed"),
]);

/** One head's brief: the call that wrote its guide, or is writing it. */
export const BriefSchema = Type.Object({
  head: Oid,
  status: BriefStatusSchema,
  failure: Type.Optional(Type.String()),
  guide: Type.Optional(GuideSchema),
  /** The earlier head this brief was cut from, when only the interdiff was new. */
  from: Type.Optional(Oid),
  /** Core head name, for reading its transcript. */
  name: Type.String(),
  /** When the fork point was written; turns after it are this brief's own. */
  forkedAt: Type.Union([Type.Number(), Type.Null()]),
  /** When its run settled. */
  doneAt: Type.Optional(Type.Number()),
});

export type Brief = Static<typeof BriefSchema>;

/** Nyte coding on the review's branch, in its own worktree. */
export const AuthorSchema = Type.Object({
  sessionId: schemas.SessionId,
  worktree: Type.String(),
  status: Type.Union([Type.Literal("working"), Type.Literal("idle"), Type.Literal("failed")]),
  failure: Type.Optional(Type.String()),
});

export type Author = Static<typeof AuthorSchema>;

export const ApprovalSchema = Type.Object({ head: Oid, at: Type.Number() });

export type Approval = Static<typeof ApprovalSchema>;

/**
 * A side chat: questions asked beside the pull request, answered by a fork of
 * the head's brief. Each thread is its own fork, so it starts from what the
 * guide already read and nothing it says is saved as a chat.
 */
export const ThreadSchema = Type.Object({
  /** The commit whose brief it forks. */
  head: Oid,
  /** The page's id for the thread. */
  thread: Type.String(),
  /** Core head name, for reading its transcript. */
  name: Type.String(),
  status: BriefStatusSchema,
  forkedAt: Type.Union([Type.Number(), Type.Null()]),
});

export type Thread = Static<typeof ThreadSchema>;

export const RevisionSchema = Type.Object({
  head: Oid,
  base: Oid,
  /** When the review first saw this head. */
  at: Type.Number(),
});

export type Revision = Static<typeof RevisionSchema>;

export const ReviewSummarySchema = Type.Object({
  id: Type.String(),
  title: Type.String(),
  baseRef: Type.String(),
  headRef: Type.String(),
  head: Oid,
  commits: Type.Integer(),
  files: Type.Integer(),
  added: Type.Integer(),
  removed: Type.Integer(),
  guide: Type.Union([
    Type.Literal("none"),
    Type.Literal("running"),
    Type.Literal("done"),
    Type.Literal("failed"),
  ]),
  /** The review's ref moved past the head its latest guide describes. */
  moved: Type.Boolean(),
  author: Type.Union([
    Type.Literal("none"),
    Type.Literal("working"),
    Type.Literal("idle"),
    Type.Literal("failed"),
  ]),
  /** You approved the head the ref points at now. */
  approved: Type.Boolean(),
  createdAt: Type.Number(),
});

export type ReviewSummary = Static<typeof ReviewSummarySchema>;

export const ReviewListSchema = Type.Object({ reviews: Type.Array(ReviewSummarySchema) });

export const ReviewDetailSchema = Type.Object({
  id: Type.String(),
  title: Type.String(),
  baseRef: Type.String(),
  headRef: Type.String(),
  sessionId: schemas.SessionId,
  createdAt: Type.Number(),
  /** What you asked Nyte to build, for a review that started as a task. */
  task: Type.Optional(Type.String()),
  /** Nyte coding on the branch, once it has started. */
  author: Type.Optional(AuthorSchema),
  /** Why Nyte cannot change this branch, when it cannot. */
  blocked: Type.Optional(Type.String()),
  approvals: Type.Array(ApprovalSchema),
  /** The head the ref points at now, and the base it is compared against. */
  revision: RevisionSchema,
  revisions: Type.Array(RevisionSchema),
  commits: Type.Array(CommitSchema),
  files: Type.Array(FileChangeSchema),
  briefs: Type.Array(BriefSchema),
  threads: Type.Array(ThreadSchema),
});

export type ReviewDetail = Static<typeof ReviewDetailSchema>;

export const PatchSchema = Type.Object({
  ...fileChangeFields,
  patch: Type.String(),
  /** Too large to draw; the counts still stand. */
  truncated: Type.Boolean(),
});

export const PatchListSchema = Type.Object({ patches: Type.Array(PatchSchema) });

export type Patch = Static<typeof PatchSchema>;

export const BranchSchema = Type.Object({
  name: Type.String(),
  oid: Oid,
  subject: Type.String(),
  at: Type.Number(),
  ahead: Type.Integer(),
  behind: Type.Integer(),
});

export type Branch = Static<typeof BranchSchema>;

export const RepoSchema = Type.Object({
  root: Type.String(),
  /** The default base: the upstream the repository merges into. */
  base: Type.String(),
  /** The branch your checkout is on: where a task starts by default. */
  current: Type.Optional(Type.String()),
  branches: Type.Array(BranchSchema),
});

export type Repo = Static<typeof RepoSchema>;

export const CompareSchema = Type.Object({
  base: Oid,
  head: Oid,
  commits: Type.Array(CommitSchema),
  files: Type.Integer(),
  added: Type.Integer(),
  removed: Type.Integer(),
});

export type Compare = Static<typeof CompareSchema>;

export const CreateReviewSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 200 }),
  base: Type.String({ minLength: 1 }),
  head: Type.String({ minLength: 1 }),
});

export type CreateReview = Static<typeof CreateReviewSchema>;

export const CreatedSchema = Type.Object({ id: Type.String() });

/** The review's core sessions: never changing once they exist, so a page can watch them. */
export const SessionSchema = Type.Object({
  sessionId: schemas.SessionId,
  authorSessionId: Type.Optional(schemas.SessionId),
});

export type Sessions = Static<typeof SessionSchema>;

export const TaskSchema = Type.Object({
  task: Type.String({ minLength: 1, maxLength: 20_000 }),
  /** The branch the task starts from, and the review compares against. */
  base: Type.String({ minLength: 1 }),
});

export type Task = Static<typeof TaskSchema>;

export const AskSchema = Type.Object({
  head: Oid,
  /** The side chat thread: its first question forks the brief, later ones follow in that fork. */
  thread: Type.String({ pattern: "^[a-z0-9]{1,16}$" }),
  /** Idempotency key: a retried send lands once. */
  key: Type.String({ minLength: 1 }),
  text: Type.String({ minLength: 1 }),
});

export type Ask = Static<typeof AskSchema>;

/** A change request: the same message, sent to Nyte on the branch instead of the reviewer. */
export const ChangeSchema = Type.Object({
  key: Type.String({ minLength: 1 }),
  text: Type.String({ minLength: 1 }),
});

export type Change = Static<typeof ChangeSchema>;

export const ApproveSchema = Type.Object({ head: Oid });

/** Write the guide for `head`, or write it again after it failed. */
export const WriteGuideSchema = Type.Object({ head: Oid });

export const ErrorSchema = Type.Object({ error: Type.String() });
