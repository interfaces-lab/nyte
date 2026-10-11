import type { GitScope, GitStatus, RunId } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { isToolMessage, worktreeFiles } from "../view-helpers.ts";
import type { ConversationTurn, WorktreeFile } from "../view-helpers.ts";
import type { WorkbenchChangesScope } from "./controller.ts";

/** One page of history as the toolbar lists it. */
interface CommitInfo {
  readonly id: string;
  readonly subject: string;
  readonly author: string;
}

type TurnChangesScope = Extract<WorkbenchChangesScope, { kind: "turn" }>;

export interface ChangeScopeStats {
  readonly added: number;
  readonly removed: number;
}

/** `files` knows the paths from Git status but has read no patch, so its line totals are unknown, not zero. */
export type ChangeScopeRead =
  | { readonly kind: "pending" }
  | { readonly kind: "files"; readonly fileCount: number }
  | {
      readonly kind: "ready";
      readonly stats: ChangeScopeStats;
      readonly fileCount: number;
    };

export interface ChangesScopeOption {
  readonly scope: WorkbenchChangesScope;
  readonly label: string;
  /** Second line: a commit's short oid and author, or a branch's upstream. */
  readonly detail: string | undefined;
  readonly read: ChangeScopeRead;
}

export interface TurnChangeOption {
  readonly scope: TurnChangesScope;
  readonly run: RunId | null;
  readonly label: string;
  readonly stats: { readonly added: number; readonly removed: number };
  /** The paths the turn's settled calls changed; the run's recorded snapshots carry the patches. */
  readonly files: readonly string[];
}

/** Newest first; counts are the turn's summary, paths the ones its settled calls reported. */
export function turnChangeOptions(turns: readonly ConversationTurn[]): readonly TurnChangeOption[] {
  return turns
    .map((turn, index): TurnChangeOption => {
      const files = new Set<string>();

      for (const message of turn.messages) {
        if (isToolMessage(message) && message.state.phase === "settled")
          for (const path of message.state.changes?.paths ?? []) files.add(path);
      }

      return {
        scope: { kind: "turn", turnId: turn.info.id },
        run: turn.info.run,
        label: index === turns.length - 1 ? "Latest" : `Turn ${String(index + 1)}`,
        stats: { added: turn.info.summary.added, removed: turn.info.summary.removed },
        files: [...files],
      };
    })
    .reverse();
}

export function turnHasChanges(option: TurnChangeOption): boolean {
  return option.files.length > 0;
}

/** Empty turns stay hidden until asked for, except the one already on screen. */
export function visibleTurnOptions(
  options: readonly TurnChangeOption[],
  showAll: boolean,
  selectedTurnId: TurnChangesScope["turnId"] | undefined,
): readonly TurnChangeOption[] {
  if (showAll) return options;

  return options.filter(
    (option) => turnHasChanges(option) || option.scope.turnId === selectedTurnId,
  );
}

export function changesScopeValue(scope: WorkbenchChangesScope): string {
  switch (scope.kind) {
    case "uncommitted":
    case "staged":
    case "unstaged":
      return scope.kind;
    case "turn":
      return `turn:${scope.turnId}`;
    case "commit":
      return `commit:${scope.oid}`;
    default: {
      const _exhaustive: never = scope;

      return _exhaustive;
    }
  }
}

/**
 * Which Git comparison answers a scope. A turn's changes are its run's
 * recorded snapshots, so no Git read serves it.
 */
export function vcsRequestForScope(scope: WorkbenchChangesScope): GitScope | undefined {
  switch (scope.kind) {
    case "uncommitted":
      return { kind: "worktree" };
    case "staged":
      return { kind: "staged" };
    case "unstaged":
      return { kind: "unstaged" };
    case "commit":
      return { kind: "commit", commit: asId<"git-commit">(scope.oid) };
    case "turn":
      return undefined;
    default: {
      const _exhaustive: never = scope;

      return _exhaustive;
    }
  }
}

/** The repository a scope is read against; absent outside a Git working tree. */
export interface ChangesRepository {
  readonly root: string;
  readonly revision: string;
}

export function changesRepository(snapshot: GitStatus | undefined): ChangesRepository | undefined {
  return snapshot?.kind === "repository"
    ? { root: snapshot.root, revision: snapshot.revision }
    : undefined;
}

export function scopeFiles(
  snapshot: GitStatus | undefined,
  scope: "uncommitted" | "staged" | "unstaged",
): readonly WorktreeFile[] | undefined {
  if (snapshot === undefined || snapshot.kind !== "repository") return undefined;

  switch (scope) {
    case "uncommitted":
      return worktreeFiles(snapshot);
    case "staged":
      return snapshot.staged.map((file) => ({ path: file.path, kind: file.status }));
    case "unstaged":
      return [
        ...snapshot.unstaged.map((file) => ({ path: file.path, kind: file.status })),
        ...snapshot.untracked.map((path) => ({ path, kind: "untracked" as const })),
      ];
    default: {
      const _exhaustive: never = scope;

      return _exhaustive;
    }
  }
}

function workingTreeOption(
  scope: WorkbenchChangesScope,
  label: string,
  files: readonly WorktreeFile[] | undefined,
): ChangesScopeOption {
  return {
    scope,
    label,
    detail: undefined,
    read: files === undefined ? { kind: "pending" } : { kind: "files", fileCount: files.length },
  };
}

export function workingTreeScopeOptions(
  snapshot: GitStatus | undefined,
): readonly ChangesScopeOption[] {
  return [
    workingTreeOption({ kind: "uncommitted" }, "Uncommitted", scopeFiles(snapshot, "uncommitted")),
    workingTreeOption({ kind: "staged" }, "Staged", scopeFiles(snapshot, "staged")),
    workingTreeOption({ kind: "unstaged" }, "Unstaged", scopeFiles(snapshot, "unstaged")),
  ];
}

/**
 * History entries, newest first. A commit's counts need its own diff read, so
 * `statsByOid` carries only the commits already read.
 */
export function commitScopeOptions(
  commits: readonly CommitInfo[],
  readByOid: ReadonlyMap<string, ChangeScopeRead> = new Map(),
): readonly ChangesScopeOption[] {
  return commits.map((commit) => ({
    scope: { kind: "commit", oid: commit.id },
    label: commit.subject,
    detail: `${commit.id.slice(0, 7)} · ${commit.author}`,
    read: readByOid.get(commit.id) ?? { kind: "pending" },
  }));
}

export function turnScopeOption(option: TurnChangeOption): ChangesScopeOption {
  return {
    scope: option.scope,
    label: option.label,
    detail: undefined,
    read: { kind: "ready", stats: option.stats, fileCount: option.files.length },
  };
}

export function changesScopeLabel(
  scope: WorkbenchChangesScope,
  options: readonly ChangesScopeOption[],
): string {
  const listed = options.find(
    (option) => changesScopeValue(option.scope) === changesScopeValue(scope),
  );

  if (listed !== undefined) return listed.label;

  switch (scope.kind) {
    case "uncommitted":
      return "Uncommitted";
    case "staged":
      return "Staged";
    case "unstaged":
      return "Unstaged";
    case "turn":
      return "Turn";
    case "commit":
      return scope.oid.slice(0, 7);
    default: {
      const _exhaustive: never = scope;

      return _exhaustive;
    }
  }
}

export type BranchReadout =
  | { readonly kind: "detached"; readonly label: string }
  | { readonly kind: "unborn"; readonly label: string }
  | {
      readonly kind: "attached";
      readonly label: string;
      readonly upstream: string | null;
      readonly ahead: number;
      readonly behind: number;
    };

export function branchReadout(snapshot: GitStatus | undefined): BranchReadout | undefined {
  if (snapshot === undefined || snapshot.kind !== "repository") return undefined;

  if (snapshot.branch === null)
    return { kind: "detached", label: snapshot.head === null ? "HEAD" : snapshot.head.slice(0, 7) };

  if (snapshot.head === null) return { kind: "unborn", label: snapshot.branch };

  return {
    kind: "attached",
    label: snapshot.branch,
    upstream: snapshot.upstream?.name ?? null,
    ahead: snapshot.upstream?.ahead ?? 0,
    behind: snapshot.upstream?.behind ?? 0,
  };
}
