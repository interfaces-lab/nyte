import type { FileChange, FileStatus } from "./files.ts";
import type { GitCommitId, GitRevision, RunId, SnapshotId } from "./ids.ts";

export type GitStatus =
  | { readonly kind: "none" }
  | {
      readonly kind: "repository";
      readonly root: string;
      readonly head: GitCommitId | null;
      readonly branch: string | null;
      readonly upstream: {
        readonly name: string;
        readonly ahead: number;
        readonly behind: number;
      } | null;
      readonly revision: GitRevision;
      readonly staged: readonly FileChange[];
      readonly unstaged: readonly FileChange[];
      readonly untracked: readonly string[];
      readonly conflicts: readonly string[];
    };
export type GitCommitView = {
  readonly id: GitCommitId;
  readonly subject: string;
  readonly author: string;
  readonly committedAt: number;
  readonly parents: readonly GitCommitId[];
};
export type GitRefsView = {
  readonly current: string | null;
  readonly branches: readonly {
    readonly name: string;
    readonly commit: GitCommitId;
    readonly upstream: string | null;
  }[];
  readonly remotes: readonly string[];
};
export type GitFileSide =
  | { readonly kind: "absent" }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "truncated"; readonly head: string }
  | { readonly kind: "binary" };
export type GitFileSides = {
  readonly path: string;
  readonly old: GitFileSide;
  readonly new: GitFileSide;
};
export type BlameView = {
  readonly path: string;
  readonly lines: readonly {
    readonly line: number;
    readonly commit: GitCommitId;
    readonly author: string;
    readonly at: number;
  }[];
};

export type GitScope =
  | { readonly kind: "worktree" }
  | { readonly kind: "staged" }
  | { readonly kind: "unstaged" }
  | { readonly kind: "commit"; readonly commit: GitCommitId }
  | { readonly kind: "branch"; readonly base: string };

export type DiffOptions = { readonly ignoreWhitespace?: boolean };

export type ChangeSet = {
  readonly revision: GitRevision | SnapshotId;
  readonly files: readonly {
    readonly path: string;
    readonly status: FileStatus;
    readonly stat: LineStat;
    readonly from?: string;
  }[];
};

export type PatchSet = {
  readonly revision: GitRevision | SnapshotId;
  readonly entries: ReadonlyMap<string, PatchEntry & { readonly fresh: boolean }>;
};

export type PatchEntry = {
  readonly path: string;
  readonly status: FileStatus;
  readonly digest: string;
} & (
  | {
      readonly kind: "text";
      readonly added: number;
      readonly removed: number;
      readonly hunks: readonly Hunk[];
    }
  | { readonly kind: "binary" }
  | { readonly kind: "empty" }
  | { readonly kind: "too-large"; readonly limit: number }
  | { readonly kind: "failed"; readonly reason: string }
);

export type Hunk = {
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly header: string | null;
  readonly lines: readonly {
    readonly kind: "context" | "add" | "remove";
    readonly text: string;
    readonly noNewline?: true;
  }[];
};

export type LineStat =
  | { readonly kind: "text"; readonly added: number; readonly removed: number }
  | { readonly kind: "binary" }
  | { readonly kind: "unknown" };

export type GitWrite = { readonly expect?: GitRevision };

export type GitOutcome =
  | { readonly kind: "applied"; readonly revision: GitRevision }
  | { readonly kind: "unchanged" }
  | { readonly kind: "stale"; readonly revision: GitRevision }
  | { readonly kind: "busy"; readonly runs: readonly RunId[] }
  | { readonly kind: "rejected"; readonly reason: string };
