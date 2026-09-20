import { worktreeFiles } from "@nyte-ai/client";
import type {
  FileChange,
  RunId,
  Turn,
  VcsCommitInfo,
  VcsDiff,
  VcsFile,
  VcsSnapshot,
} from "@nyte-ai/protocol";
import type { VcsDiffRequest } from "../queries.ts";
import type { WorkbenchChangesScope } from "./controller.ts";

type TurnChangesScope = Extract<WorkbenchChangesScope, { kind: "turn" }>;

export interface ChangeScopeStats {
  readonly added: number;
  readonly removed: number;
}

export type ChangeScopeRead =
  | { readonly kind: "pending" }
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
  /** The run whose exact diff `runs.diff` answers; a turn of only a request has none yet. */
  readonly run: RunId | undefined;
  readonly label: string;
  readonly stats: { readonly added: number; readonly removed: number };
  readonly files: readonly { readonly change: FileChange; readonly patch: string }[];
}

function changeStats(changes: readonly FileChange[]): TurnChangeOption["stats"] {
  return changes.reduce(
    (total, change) => ({
      added: total.added + change.added,
      removed: total.removed + change.removed,
    }),
    { added: 0, removed: 0 },
  );
}

export interface TranscriptChangesProjection {
  readonly declared: readonly FileChange[];
  readonly options: readonly TurnChangeOption[];
}

function addChange(changes: Map<string, FileChange>, change: FileChange): void {
  const previous = changes.get(change.path);
  changes.set(change.path, {
    path: change.path,
    added: (previous?.added ?? 0) + change.added,
    removed: (previous?.removed ?? 0) + change.removed,
  });
}

/** Newest first; each file carries the exact patches that produced its counts, in order. */
export function transcriptChanges(turns: readonly Turn[]): TranscriptChangesProjection {
  const turnCount = turns.reduce((count, turn) => (turn.kind === "turn" ? count + 1 : count), 0);
  const options: TurnChangeOption[] = [];
  const declared = new Map<string, FileChange>();
  const declaredCommits = new Set<string>();
  let ordinal = 0;
  for (const turn of turns) {
    if (turn.kind !== "turn") continue;
    ordinal += 1;
    const patches = new Map<string, string[]>();
    const turnChanges = new Map<string, FileChange>();
    const folded = new Set<string>();
    for (const part of turn.parts) {
      if (part.kind !== "tool" || part.class.kind !== "file_patch") continue;
      if (part.result === undefined || part.result.isError || folded.has(part.result.commit))
        continue;
      folded.add(part.result.commit);
      const { path, patch, added, removed } = part.class;
      const previous = patches.get(path);
      if (previous === undefined) patches.set(path, [patch]);
      else previous.push(patch);
      addChange(turnChanges, { path, added, removed });
      if (!declaredCommits.has(part.result.commit)) {
        declaredCommits.add(part.result.commit);
        addChange(declared, { path, added, removed });
      }
    }
    const files = [...turnChanges.values()].map((change) => ({
      change,
      patch: (patches.get(change.path) ?? []).join("\n"),
    }));
    options.push({
      scope: { kind: "turn", turnId: turn.id },
      run: turn.run,
      label: ordinal === turnCount ? "Latest" : `Turn ${String(ordinal)}`,
      stats: changeStats(files.map((file) => file.change)),
      files,
    });
  }
  return { declared: [...declared.values()], options: options.reverse() };
}

export function turnChangeOptions(turns: readonly Turn[]): readonly TurnChangeOption[] {
  return transcriptChanges(turns).options;
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

/** A stable menu value and cache key for one scope. */
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
 * Which diff read answers a scope. A turn's changes are folded from the
 * transcript the panel already holds, so no VCS read serves it.
 */
export function diffRequestForScope(
  scope: WorkbenchChangesScope,
  options?: { readonly paths?: readonly string[]; readonly ignoreWhitespace?: boolean },
): VcsDiffRequest | undefined {
  const narrowing = {
    paths: options?.paths === undefined ? undefined : [...options.paths],
    ignoreWhitespace: options?.ignoreWhitespace,
  };
  switch (scope.kind) {
    case "uncommitted":
      return { scope: { kind: "worktree" }, ...narrowing };
    case "staged":
      return { scope: { kind: "staged" }, ...narrowing };
    case "unstaged":
      return { scope: { kind: "unstaged" }, ...narrowing };
    case "commit":
      return { scope: { kind: "commit", oid: scope.oid }, ...narrowing };
    case "turn":
      return undefined;
    default: {
      const _exhaustive: never = scope;
      return _exhaustive;
    }
  }
}

/** Totals over a scope's patches. */
export function diffScopeStats(diffs: readonly VcsDiff[]): ChangeScopeStats {
  return diffs.reduce<ChangeScopeStats>(
    (total, diff) => ({ added: total.added + diff.added, removed: total.removed + diff.removed }),
    { added: 0, removed: 0 },
  );
}

/** The files a working-tree scope lists. */
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

/** Diffs already read for the working-tree scopes; each is absent until read. */
export interface WorkingTreeDiffs {
  readonly uncommitted?: readonly VcsDiff[];
  readonly staged?: readonly VcsDiff[];
  readonly unstaged?: readonly VcsDiff[];
}

function workingTreeOption(
  scope: WorkbenchChangesScope,
  label: string,
  files: readonly VcsFile[] | undefined,
  diffs: readonly VcsDiff[] | undefined,
): ChangesScopeOption {
  return {
    scope,
    label,
    detail: undefined,
    read:
      files === undefined || diffs === undefined
        ? { kind: "pending" }
        : { kind: "ready", stats: diffScopeStats(diffs), fileCount: files.length },
  };
}

/** Uncommitted, then the index split. */
export function workingTreeScopeOptions(
  snapshot: VcsSnapshot | undefined,
  diffs: WorkingTreeDiffs = {},
): readonly ChangesScopeOption[] {
  return [
    workingTreeOption(
      { kind: "uncommitted" },
      "Uncommitted",
      scopeFiles(snapshot, "uncommitted"),
      diffs.uncommitted,
    ),
    workingTreeOption({ kind: "staged" }, "Staged", scopeFiles(snapshot, "staged"), diffs.staged),
    workingTreeOption(
      { kind: "unstaged" },
      "Unstaged",
      scopeFiles(snapshot, "unstaged"),
      diffs.unstaged,
    ),
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

/** A turn option in the shared menu shape; the turn's files stay on the option itself. */
export function turnScopeOption(option: TurnChangeOption): ChangesScopeOption {
  return {
    scope: option.scope,
    label: option.label,
    detail: undefined,
    read: { kind: "ready", stats: option.stats, fileCount: option.files.length },
  };
}

/** What the trigger says when the scope is not one of the listed options. */
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

/**
 * The branch line above the scope menu. `detached` means HEAD points at a
 * commit with no branch, where `label` is the short oid. An unborn HEAD keeps
 * its branch name and reports no ahead or behind counts.
 */
export interface BranchReadout {
  readonly label: string;
  readonly detached: boolean;
  readonly unborn: boolean;
  readonly upstream: string | undefined;
  readonly ahead: number;
  readonly behind: number;
}

export function branchReadout(snapshot: VcsSnapshot | undefined): BranchReadout | undefined {
  if (snapshot === undefined || snapshot.kind !== "repository") return undefined;
  const head = snapshot.head;
  if (head.branch.kind === "detached") {
    return {
      label: (head.oid ?? "").slice(0, 7),
      detached: true,
      unborn: head.oid === null,
      upstream: undefined,
      ahead: 0,
      behind: 0,
    };
  }
  return {
    label: head.branch.name,
    detached: false,
    unborn: head.oid === null,
    upstream: head.branch.upstream?.name,
    ahead: head.branch.upstream?.ahead ?? 0,
    behind: head.branch.upstream?.behind ?? 0,
  };
}
