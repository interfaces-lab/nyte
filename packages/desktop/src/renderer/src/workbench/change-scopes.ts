import { changesFromTurns, parsePatchFacts } from "@nyte-ai/client";
import type { FileChange, RunId, Turn, VcsDiff, VcsStatus } from "@nyte-ai/protocol";
import type {
  DesktopVcsCommit,
  DesktopVcsDiffInput,
  DesktopVcsSnapshot,
} from "../../../shared/ipc.ts";
import type { WorkbenchChangesScope } from "./controller.ts";

type TurnChangesScope = Extract<WorkbenchChangesScope, { kind: "turn" }>;

export interface ChangeScopeStats {
  readonly added: number;
  readonly removed: number;
}

/**
 * One entry of the scope menu. `stats` and `fileCount` are absent while the
 * read that would produce them has not answered, which a caller shows as a
 * blank instead of a zero it cannot vouch for.
 */
export interface ChangesScopeOption {
  readonly scope: WorkbenchChangesScope;
  readonly label: string;
  /** Second line: a commit's short oid and author, or a branch's upstream. */
  readonly detail: string | undefined;
  readonly stats: ChangeScopeStats | undefined;
  readonly fileCount: number | undefined;
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
      if (part.result === undefined || part.result.isError || folded.has(part.result.commit))
        continue;
      folded.add(part.result.commit);
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
      stats: changeStats(files.map((file) => file.change)),
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
): DesktopVcsDiffInput | undefined {
  const narrowing = { paths: options?.paths, ignoreWhitespace: options?.ignoreWhitespace };
  switch (scope.kind) {
    case "uncommitted":
      return { scope: "worktree", ...narrowing };
    case "staged":
      return { scope: "staged", ...narrowing };
    case "unstaged":
      return { scope: "unstaged", ...narrowing };
    case "commit":
      return { scope: "commit", commit: scope.oid, ...narrowing };
    case "turn":
      return undefined;
    default: {
      const _exhaustive: never = scope;
      return _exhaustive;
    }
  }
}

/** Totals over a scope's patches. Unparsable patches contribute nothing. */
export function diffScopeStats(diffs: readonly VcsDiff[]): ChangeScopeStats {
  return diffs.reduce<ChangeScopeStats>(
    (total, diff) => {
      const facts = parsePatchFacts(diff.patch);
      if (facts === undefined) return total;
      return { added: total.added + facts.added, removed: total.removed + facts.removed };
    },
    { added: 0, removed: 0 },
  );
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
  files: VcsStatus["files"] | undefined,
  diffs: readonly VcsDiff[] | undefined,
): ChangesScopeOption {
  return {
    scope,
    label,
    detail: undefined,
    stats: diffs === undefined ? undefined : diffScopeStats(diffs),
    fileCount: files?.length,
  };
}

/**
 * Uncommitted, and the index split when the snapshot carries it. A snapshot
 * built from the status alone offers Uncommitted only, so a caller never shows
 * a Staged entry it has no records for.
 */
export function workingTreeScopeOptions(
  snapshot: DesktopVcsSnapshot | undefined,
  diffs: WorkingTreeDiffs = {},
): readonly ChangesScopeOption[] {
  const options = [
    workingTreeOption(
      { kind: "uncommitted" },
      "Uncommitted",
      snapshot?.status.files,
      diffs.uncommitted,
    ),
  ];
  if (snapshot?.staged !== undefined)
    options.push(workingTreeOption({ kind: "staged" }, "Staged", snapshot.staged, diffs.staged));
  if (snapshot?.unstaged !== undefined)
    options.push(
      workingTreeOption({ kind: "unstaged" }, "Unstaged", snapshot.unstaged, diffs.unstaged),
    );
  return options;
}

/**
 * History entries, newest first. A commit's counts need its own diff read, so
 * `statsByOid` carries only the commits already read.
 */
export function commitScopeOptions(
  commits: readonly DesktopVcsCommit[],
  statsByOid: ReadonlyMap<string, ChangeScopeStats> = new Map(),
): readonly ChangesScopeOption[] {
  return commits.map((commit) => ({
    scope: { kind: "commit", oid: commit.oid },
    label: commit.subject,
    detail: `${commit.shortOid} · ${commit.author}`,
    stats: statsByOid.get(commit.oid),
    fileCount: undefined,
  }));
}

/** A turn option in the shared menu shape; the turn's files stay on the option itself. */
export function turnScopeOption(option: TurnChangeOption): ChangesScopeOption {
  return {
    scope: option.scope,
    label: option.label,
    detail: undefined,
    stats: option.stats,
    fileCount: option.files.length,
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

export function branchReadout(snapshot: DesktopVcsSnapshot | undefined): BranchReadout | undefined {
  if (snapshot === undefined || snapshot.kind !== "repository") return undefined;
  const head = snapshot.head;
  if (head === undefined) {
    // A snapshot built from the status alone knows the branch name and nothing else.
    const branch = snapshot.status.branch;
    return branch === undefined
      ? undefined
      : { label: branch, detached: false, unborn: false, upstream: undefined, ahead: 0, behind: 0 };
  }
  const branch = head.branch ?? snapshot.status.branch;
  const detached = branch === undefined;
  return {
    label: branch ?? (head.oid ?? "").slice(0, 7),
    detached,
    unborn: head.oid === null,
    upstream: head.upstream,
    ahead: head.ahead,
    behind: head.behind,
  };
}
