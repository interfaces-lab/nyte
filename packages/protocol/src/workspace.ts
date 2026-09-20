/** What the `workspace` and `provider` namespaces answer with. */
import type { Api, Model, ModelCostRates, ModelThinkingLevel } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Static } from "typebox";
import type { RunInfo } from "./sdk.ts";

/** One known workspace. `name` is derived presentation, never stored. */
export interface WorkspaceInfo {
  readonly path: string;
  /** The folder's basename, what a picker shows. */
  readonly name: string;
  readonly lastOpenedAt: number;
  /** Current folder availability, when the registry can inspect the filesystem. */
  readonly available?: boolean;
}

/** Where new chats and pathless `@` files go on this host. */
export type WorkspaceSelection =
  | { readonly kind: "home" }
  | { readonly kind: "project"; readonly workspace: WorkspaceInfo };

/** Ask the host to serve Home or a listed project path. */
export type WorkspaceSelectInput =
  | { readonly kind: "home" }
  | { readonly kind: "project"; readonly path: string };

/** What `workspace.select` did: the cursor moved, or why it did not. */
export type WorkspaceSelectOutcome =
  | { readonly kind: "opened"; readonly selection: WorkspaceSelection }
  | { readonly kind: "unavailable"; readonly path: string }
  | { readonly kind: "untrusted"; readonly path: string }
  | { readonly kind: "failed"; readonly message: string };

/**
 * Which comparison a version-control read asks for. `worktree` is everything
 * since HEAD, staged or not; `staged` is the index against HEAD; `unstaged` is
 * the worktree against the index; `commit` is one commit against its parent;
 * `branch` is the worktree against its merge base with `base`.
 */
export type VcsScope =
  | { readonly kind: "worktree" }
  | { readonly kind: "staged" }
  | { readonly kind: "unstaged" }
  | { readonly kind: "commit"; readonly oid: string }
  | { readonly kind: "branch"; readonly base: string };

export type VcsFileKind = "added" | "modified" | "deleted" | "renamed" | "untracked" | "conflicted";

export type VcsFile =
  | { readonly path: string; readonly kind: Exclude<VcsFileKind, "renamed"> }
  | { readonly path: string; readonly kind: "renamed"; readonly from: string };

/**
 * Where the checkout stands. `oid` is `null` on an unborn branch, which has a
 * name but no commit yet. `base` is a review base the backend could infer.
 */
export interface VcsHead {
  readonly oid: string | null;
  readonly branch:
    | {
        readonly kind: "named";
        readonly name: string;
        readonly upstream: {
          readonly name: string;
          readonly ahead: number;
          readonly behind: number;
        } | null;
      }
    | { readonly kind: "detached" };
  readonly base: { readonly name: string; readonly source: "reflog" | "default" } | null;
}

/**
 * The repository as it stands. `root` is its identity and `revision` changes
 * with any of HEAD, the index, or the working tree, so a client keys caches
 * on the pair. One path can appear in both lists with different kinds.
 */
export type VcsSnapshot =
  | { readonly kind: "none" }
  | {
      readonly kind: "repository";
      readonly root: string;
      readonly revision: string;
      readonly head: VcsHead;
      readonly staged: readonly VcsFile[];
      readonly unstaged: readonly VcsFile[];
    };

export interface VcsDiff {
  readonly path: string;
  readonly kind: VcsFileKind;
  readonly added: number;
  readonly removed: number;
  readonly patch: string;
}

/**
 * Both sides of one file. A side is `null` where the file does not exist:
 * `old` for added or untracked files, `new` for deleted ones. Binary files
 * carry empty sides.
 */
export interface VcsContents {
  readonly path: string;
  readonly old: string | null;
  readonly new: string | null;
  readonly binary: boolean;
  readonly truncated: boolean;
}

export interface VcsCommitInfo {
  readonly oid: string;
  readonly subject: string;
  readonly author: string;
  /** Epoch milliseconds. */
  readonly committedAt: number;
}

/** One page of history, newest first. */
export interface VcsLog {
  readonly commits: readonly VcsCommitInfo[];
  readonly hasMore: boolean;
}

/** Short ref names: `main`, `origin/main`. */
export interface VcsRefs {
  readonly local: readonly string[];
  readonly remote: readonly string[];
}

export type VcsCommitTarget =
  | { readonly kind: "staged" }
  | { readonly kind: "all" }
  | { readonly kind: "paths"; readonly paths: readonly string[] };

/** What a per-path write did. A path git refused is `skipped`; the rest applied. */
export type VcsPathsOutcome =
  | {
      readonly kind: "applied";
      readonly paths: readonly string[];
      readonly skipped: readonly { readonly path: string; readonly reason: string }[];
    }
  | { readonly kind: "failed"; readonly reason: string }
  | { readonly kind: "stale" };

export type VcsCommitOutcome =
  | { readonly kind: "committed"; readonly oid: string; readonly summary: string }
  | { readonly kind: "nothing_to_commit" }
  | { readonly kind: "failed"; readonly reason: string }
  | { readonly kind: "stale" };

export type VcsBranchOutcome =
  | { readonly kind: "created" }
  | { readonly kind: "exists" }
  | { readonly kind: "invalid_name"; readonly reason: string }
  | { readonly kind: "failed"; readonly reason: string }
  | { readonly kind: "stale" };

export type VcsPushOutcome =
  | { readonly kind: "pushed"; readonly remote: string; readonly branch: string }
  | { readonly kind: "up_to_date" }
  | { readonly kind: "no_upstream"; readonly branch: string }
  | { readonly kind: "rejected"; readonly reason: string }
  | { readonly kind: "failed"; readonly reason: string }
  | { readonly kind: "stale" };

/** A discard waits for the session's live run; the run would write over it. */
export type VcsDiscardOutcome = VcsPathsOutcome | { readonly kind: "busy"; readonly run: RunInfo };

/**
 * One file or folder `@` can name. The host discovers these in the workspace it
 * serves; a remote client never walks a filesystem it cannot see.
 */
export interface MentionFile {
  /** Absolute path. Directories carry a trailing separator. */
  readonly path: string;
  /** The `file:` URL a message spells the mention as (`@file:///…`). */
  readonly url: string;
  /** Path relative to the workspace root, forward slashes, `/` suffix for directories. */
  readonly displayPath: string;
  /** Basename, `/` suffix for directories. */
  readonly label: string;
}

/** Public picker data, shared by local SDK and remote clients. */
export type ModelInfo = Readonly<Pick<Model<Api>, "id" | "provider" | "name" | "contextWindow">> & {
  readonly cost: Readonly<ModelCostRates>;
  readonly thinkingLevels: readonly ModelThinkingLevel[];
};

export type WorkspaceFileDocument =
  | {
      readonly kind: "text";
      readonly path: string;
      readonly contents: string;
      /** Hash of the bytes read; save refuses to replace a different version. */
      readonly version: string;
    }
  | { readonly kind: "binary"; readonly path: string; readonly size: number }
  | { readonly kind: "too_large"; readonly path: string; readonly size: number };

export type WorkspaceFileSaveOutcome =
  | { readonly kind: "saved"; readonly version: string }
  | { readonly kind: "conflict" };

const globPatterns = Type.Optional(
  Type.Array(Type.String({ minLength: 1, maxLength: 256 }), { maxItems: 20 }),
);

/** Hosts compose this schema with their own request/cancellation metadata. */
export const WorkspaceSearchSchema = Type.Object(
  {
    query: Type.String({ minLength: 1, maxLength: 1000 }),
    caseSensitive: Type.Optional(Type.Boolean()),
    wholeWord: Type.Optional(Type.Boolean()),
    regex: Type.Optional(Type.Boolean()),
    include: globPatterns,
    exclude: globPatterns,
    maxMatches: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
    drafts: Type.Optional(
      Type.Array(
        Type.Object(
          {
            path: Type.String({ minLength: 1 }),
            contents: Type.String({ maxLength: 200_000 }),
          },
          { additionalProperties: false },
        ),
        { maxItems: 10 },
      ),
    ),
  },
  { additionalProperties: false },
);

export type WorkspaceSearchInput = Readonly<Static<typeof WorkspaceSearchSchema>>;

export interface WorkspaceSearchMatch {
  /** One-based line and column; column and length use UTF-16 code units. */
  readonly line: number;
  readonly column: number;
  readonly length: number;
  readonly snippet: string;
  /** One-based column where the bounded snippet begins. */
  readonly snippetColumn: number;
}

export interface WorkspaceSearchFile {
  readonly path: string;
  readonly displayPath: string;
  readonly source: "disk" | "draft";
  readonly matches: readonly WorkspaceSearchMatch[];
}

export interface WorkspaceSearchResult {
  readonly files: readonly WorkspaceSearchFile[];
  readonly matchCount: number;
  readonly truncated: boolean;
  /**
   * rg does not report exact counts of ignored, binary, oversized or
   * unreadable files. Null must not be presented as zero skipped files.
   */
  readonly skipped: null;
}
