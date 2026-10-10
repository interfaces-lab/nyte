import type { FileChange, FileStatus } from "./files.ts";
import type { GitCommitId, GitRevision, RunId, SnapshotId } from "./ids.ts";

/** Returns the repository status, or `none` when there is no repository. */
export type GitStatus =
  | { readonly kind: "none" }
  | { readonly kind: "repository"; readonly root: string; readonly head: GitCommitId | null; readonly branch: string | null; readonly upstream: { readonly name: string; readonly ahead: number; readonly behind: number } | null; readonly revision: GitRevision; readonly staged: readonly FileChange[]; readonly unstaged: readonly FileChange[]; readonly untracked: readonly string[]; readonly conflicts: readonly string[] };
/** Returns one commit as a history row. */
export type GitCommitView = { readonly id: GitCommitId; readonly subject: string; readonly author: string; readonly committedAt: number; readonly parents: readonly GitCommitId[] }
/** Returns the current branch, every branch and the remotes. */
export type GitRefsView = { readonly current: string | null; readonly branches: readonly { readonly name: string; readonly commit: GitCommitId; readonly upstream: string | null }[]; readonly remotes: readonly string[] }
/** Returns one side of a file under a scope: absent, text, truncated or binary. */
export type GitFileSide = { readonly kind: "absent" } | { readonly kind: "text"; readonly text: string } | { readonly kind: "truncated"; readonly head: string } | { readonly kind: "binary" };
/** Returns a file's old and new sides under a scope. */
export type GitFileSides = { readonly path: string; readonly old: GitFileSide; readonly new: GitFileSide }
/** Returns per-line authorship for a file. */
export type BlameView = { readonly path: string; readonly lines: readonly { readonly line: number; readonly commit: GitCommitId; readonly author: string; readonly at: number }[] }

/**
 * Names what a git comparison compares.
 *
 * **Details**
 *
 * - `worktree`: HEAD vs working tree: everything uncommitted.
 * - `staged`: HEAD vs index.
 * - `unstaged`: index vs working tree.
 * - `commit`: a commit vs its parent.
 * - `branch`: merge-base(base, HEAD) vs HEAD: the PR view.
 *
 * @category git
 * @since 0.1.0
 */
export type GitScope =
  | { readonly kind: "worktree" }
  | { readonly kind: "staged" }
  | { readonly kind: "unstaged" }
  | { readonly kind: "commit"; readonly commit: GitCommitId }
  | { readonly kind: "branch"; readonly base: string };

/**
 * Describes how a diff is computed.
 *
 * @category git
 * @since 0.1.0
 */
export type DiffOptions = { readonly ignoreWhitespace?: boolean };

/**
 * Returns the files a comparison or a run changed, with line stats, at one
 * revision.
 *
 * @category git
 * @since 0.1.0
 */
export type ChangeSet = {
  /** A git revision, or a snapshot for run changes. */
  readonly revision: GitRevision | SnapshotId;
  /** One row per path; `from` is the source path of a rename. */
  readonly files: readonly { readonly path: string; readonly status: FileStatus; readonly stat: LineStat; readonly from?: string }[];
}

/**
 * Returns the full patch map for the requested paths at one revision.
 *
 * @category git
 * @since 0.1.0
 */
export type PatchSet = {
  readonly revision: GitRevision | SnapshotId;
  /** `fresh` false = the previous revision's entry, held while the new one loads. */
  readonly entries: ReadonlyMap<string, PatchEntry & { readonly fresh: boolean }>;
}

/**
 * Returns one path's parsed patch.
 *
 * **Details**
 *
 * `digest` is content identity for "viewed" marks: the same content after a
 * re-read stays viewed.
 *
 * - `text`: hunks with line counts.
 * - `binary`: no textual patch.
 * - `empty`: reported by the scope, no textual change, as under `ignoreWhitespace`.
 * - `too-large`: the host stopped reading at `limit`; `contents()` still works.
 * - `failed`: this path failed; the others in the set are fine.
 *
 * @category git
 * @since 0.1.0
 */
export type PatchEntry = { readonly path: string; readonly status: FileStatus; readonly digest: string } & (
  | { readonly kind: "text"; readonly added: number; readonly removed: number; readonly hunks: readonly Hunk[] }
  | { readonly kind: "binary" }
  | { readonly kind: "empty" }
  | { readonly kind: "too-large"; readonly limit: number }
  | { readonly kind: "failed"; readonly reason: string }
);

/**
 * Returns one parsed hunk.
 *
 * **Details**
 *
 * A client maps `Hunk[]` to its renderer's shape (desktop: @pierre/diffs
 * FileDiffMetadata) in O(lines) with no parser and no worker. Viewed marks
 * (path + digest) stay in the client; they are a reader's note, not repo
 * state.
 *
 * @category git
 * @since 0.1.0
 */
export type Hunk = {
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly header: string | null;
  readonly lines: readonly { readonly kind: "context" | "add" | "remove"; readonly text: string; readonly noNewline?: true }[];
}

/**
 * Returns a path's added and removed line counts, or why there are none.
 *
 * @category git
 * @since 0.1.0
 */
export type LineStat = { readonly kind: "text"; readonly added: number; readonly removed: number } | { readonly kind: "binary" } | { readonly kind: "unknown" };

/**
 * Describes a git write's guard: the status revision the client showed.
 *
 * @category git
 * @since 0.1.0
 */
export type GitWrite = { readonly expect?: GitRevision };

/**
 * Returns the result of a git write.
 *
 * **Outcomes**
 *
 * - `applied`: done; `revision` is the new status revision.
 * - `unchanged`: nothing to do.
 * - `stale`: the repository moved since `expect`; `revision` is current.
 * - `busy`: `runs` are writing this tree; discard and commit refuse, stage and unstage proceed.
 * - `rejected`: git refused; `reason` says why.
 *
 * @category git
 * @since 0.1.0
 */
export type GitOutcome =
  | { readonly kind: "applied"; readonly revision: GitRevision }
  | { readonly kind: "unchanged" }
  | { readonly kind: "stale"; readonly revision: GitRevision }
  | { readonly kind: "busy"; readonly runs: readonly RunId[] }
  | { readonly kind: "rejected"; readonly reason: string };
