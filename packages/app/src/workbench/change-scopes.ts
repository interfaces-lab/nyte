import { changesFromTurns, worktreeFiles } from "@nyte-ai/client";
import type {
  FileChange,
  Turn,
  TurnRun,
  VcsCommitInfo,
  VcsFile,
  VcsSnapshot,
} from "@nyte-ai/protocol";
import type { VcsChangesRequest } from "../queries.ts";
import type { WorkbenchChangesScope } from "./controller.ts";

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
  readonly run: TurnRun;
  readonly label: string;
  readonly stats: { readonly added: number; readonly removed: number };
  readonly files: readonly { readonly change: FileChange; readonly patch: string }[];
}

/** Newest first; each file carries the exact patches that produced its counts, in order. */
export function turnChangeOptions(turns: readonly Turn[]): readonly TurnChangeOption[] {
  const turnCount = turns.reduce((count, turn) => (turn.kind === "turn" ? count + 1 : count), 0);
  const options: TurnChangeOption[] = [];
  let ordinal = 0;

  for (const turn of turns) {
    if (turn.kind !== "turn") continue;
    ordinal += 1;
    const patches = new Map<string, string[]>();
    const folded = new Set<string>();

    for (const part of turn.parts) {
      if (part.kind !== "tool" || part.class.kind !== "file_patch") continue;

      if (part.state.kind !== "success" || part.state.commit === null) continue;

      if (folded.has(part.state.commit)) continue;
      folded.add(part.state.commit);
      const { path, patch } = part.class;
      const previous = patches.get(path);

      if (previous === undefined) patches.set(path, [patch]);
      else previous.push(patch);
    }

    const files = changesFromTurns([turn]).map((change) => ({
      change,
      patch: (patches.get(change.path) ?? []).join("\n"),
    }));

    options.push({
      scope: { kind: "turn", turnId: turn.id },
      run: turn.run,
      label: ordinal === turnCount ? "Latest" : `Turn ${String(ordinal)}`,
      stats: files.reduce(
        (total, file) => ({
          added: total.added + file.change.added,
          removed: total.removed + file.change.removed,
        }),
        { added: 0, removed: 0 },
      ),
      files,
    });
  }

  return options.reverse();
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
 * Which Git comparison answers a scope. A turn's changes are folded from the
 * transcript the panel already holds, so no VCS read serves it.
 */
export function vcsRequestForScope(
  scope: WorkbenchChangesScope,
  options?: { readonly ignoreWhitespace?: boolean },
): VcsChangesRequest | undefined {
  const base = {
    target: { kind: "workspace" } as const,
    ignoreWhitespace: options?.ignoreWhitespace ?? false,
  };

  switch (scope.kind) {
    case "uncommitted":
      return { scope: { kind: "worktree" }, ...base };
    case "staged":
      return { scope: { kind: "staged" }, ...base };
    case "unstaged":
      return { scope: { kind: "unstaged" }, ...base };
    case "commit":
      return { scope: { kind: "commit", oid: scope.oid }, ...base };
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

export function changesRepository(
  snapshot: VcsSnapshot | undefined,
): ChangesRepository | undefined {
  return snapshot?.kind === "repository"
    ? { root: snapshot.root, revision: snapshot.revision }
    : undefined;
}

export function scopeFiles(
  snapshot: VcsSnapshot | undefined,
  scope: "uncommitted" | "staged" | "unstaged",
): readonly VcsFile[] | undefined {
  if (snapshot === undefined || snapshot.kind !== "repository") return undefined;

  switch (scope) {
    case "uncommitted":
      return worktreeFiles(snapshot);
    case "staged":
      return snapshot.staged;
    case "unstaged":
      return snapshot.unstaged;
    default: {
      const _exhaustive: never = scope;

      return _exhaustive;
    }
  }
}

function workingTreeOption(
  scope: WorkbenchChangesScope,
  label: string,
  files: readonly VcsFile[] | undefined,
): ChangesScopeOption {
  return {
    scope,
    label,
    detail: undefined,
    read: files === undefined ? { kind: "pending" } : { kind: "files", fileCount: files.length },
  };
}

export function workingTreeScopeOptions(
  snapshot: VcsSnapshot | undefined,
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
  commits: readonly VcsCommitInfo[],
  readByOid: ReadonlyMap<string, ChangeScopeRead> = new Map(),
): readonly ChangesScopeOption[] {
  return commits.map((commit) => ({
    scope: { kind: "commit", oid: commit.oid },
    label: commit.subject,
    detail: `${commit.oid.slice(0, 7)} · ${commit.author}`,
    read: readByOid.get(commit.oid) ?? { kind: "pending" },
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

export function branchReadout(snapshot: VcsSnapshot | undefined): BranchReadout | undefined {
  if (snapshot === undefined || snapshot.kind !== "repository") return undefined;
  const head = snapshot.head;

  switch (head.kind) {
    case "detached":
      return { kind: head.kind, label: head.oid.slice(0, 7) };
    case "unborn":
      return { kind: head.kind, label: head.branch };
    case "attached":
      return {
        kind: head.kind,
        label: head.branch,
        upstream: head.upstream?.name ?? null,
        ahead: head.upstream?.ahead ?? 0,
        behind: head.upstream?.behind ?? 0,
      };
    default: {
      const _exhaustive: never = head;

      return _exhaustive;
    }
  }
}
