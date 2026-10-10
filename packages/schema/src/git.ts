import type { FileChange } from "./files.ts";
import type { GitCommitId, GitRevision } from "./ids.ts";

/** Returns the repository status, or `none` when there is no repository. */
export type GitStatus =
  | { readonly kind: "none" }
  | { readonly kind: "repository"; readonly root: string; readonly head: GitCommitId | null; readonly branch: string | null; readonly upstream: { readonly name: string; readonly ahead: number; readonly behind: number } | null; readonly revision: GitRevision; readonly staged: readonly FileChange[]; readonly unstaged: readonly FileChange[]; readonly untracked: readonly string[]; readonly conflicts: readonly string[] };
/** Returns one commit as a history row. */
export interface GitCommitView { readonly id: GitCommitId; readonly subject: string; readonly author: string; readonly committedAt: number; readonly parents: readonly GitCommitId[] }
/** Returns the current branch, every branch and the remotes. */
export interface GitRefsView { readonly current: string | null; readonly branches: readonly { readonly name: string; readonly commit: GitCommitId; readonly upstream: string | null }[]; readonly remotes: readonly string[] }
/** Returns one side of a file under a scope: absent, text, truncated or binary. */
export type GitFileSide = { readonly kind: "absent" } | { readonly kind: "text"; readonly text: string } | { readonly kind: "truncated"; readonly head: string } | { readonly kind: "binary" };
/** Returns a file's old and new sides under a scope. */
export interface GitFileSides { readonly path: string; readonly old: GitFileSide; readonly new: GitFileSide }
/** Returns per-line authorship for a file. */
export interface BlameView { readonly path: string; readonly lines: readonly { readonly line: number; readonly commit: GitCommitId; readonly author: string; readonly at: number }[] }
