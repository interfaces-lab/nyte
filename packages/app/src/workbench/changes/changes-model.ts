import type {
  ChangeSet,
  ChangeSource,
  FileStatus,
  GitStatus,
  LineStat,
  SessionId,
} from "@nyte-ai/sdk";
import type { createPatchLoader, PatchEntry } from "../../diff/changes-patches.ts";
import { patchDigest } from "../../diff/changes-viewed.ts";
import type { ViewedState } from "../../diff/changes-viewed.ts";
import { EMPTY_PATCH, patchStackSection } from "../../diff/stacked-diff.ts";
import { changesScopeValue } from "../model.ts";
import type { WorkbenchChangesScope } from "../model.ts";
import { scopeFiles } from "./change-scopes.ts";
import type { ChangesRepository, ChangeTotals, TurnChangeOption } from "./change-scopes.ts";
import type { ChangesSidebarFile } from "./changes-sidebar.tsx";
import type { ChangesStackItem } from "./changes-stack-code-view.ts";

export interface VcsChangeRow {
  readonly source: "working" | "commit";
  readonly path: string;
  readonly status: FileStatus;
}

interface RecordedChangeRow {
  readonly source: "recorded";
  readonly path: string;
  readonly added: number;
  readonly removed: number;
}

export type ChangeRow = VcsChangeRow | RecordedChangeRow;

export type PatchSnapshot = ReturnType<ReturnType<typeof createPatchLoader>["getSnapshot"]>;

const UNCOMMITTED_SCOPE: WorkbenchChangesScope = { kind: "uncommitted" };

const UNKNOWN_STAT: LineStat = { kind: "unknown" };

const EMPTY_ROWS: readonly VcsChangeRow[] = [];

interface ResolvedChangesScope {
  readonly scope: WorkbenchChangesScope;
  readonly value: string;
  readonly rows: ChangeRow["source"];
  readonly recorded: ChangeSource | undefined;
}

export function resolveChangesScope(
  scope: WorkbenchChangesScope,
  turnOptions: readonly TurnChangeOption[],
  sessionId: SessionId | undefined,
): ResolvedChangesScope {
  const turn =
    scope.kind === "turn"
      ? turnOptions.find((option) => option.scope.turnId === scope.turnId)
      : undefined;

  const active =
    (scope.kind === "turn" && turn === undefined) ||
    (scope.kind === "thread" && sessionId === undefined)
      ? UNCOMMITTED_SCOPE
      : scope;

  const run = turn?.run ?? undefined;

  const recorded: ChangeSource | undefined =
    active.kind === "thread" && sessionId !== undefined
      ? { kind: "session", session: sessionId }
      : run === undefined
        ? undefined
        : { kind: "run", run };

  return {
    scope: active,
    value: changesScopeValue(active),
    rows:
      active.kind === "thread" || active.kind === "turn"
        ? "recorded"
        : active.kind === "commit"
          ? "commit"
          : "working",
    recorded,
  };
}

export function workingRows(
  snapshot: GitStatus | undefined,
  scope: WorkbenchChangesScope,
): readonly VcsChangeRow[] {
  if (scope.kind !== "uncommitted" && scope.kind !== "staged" && scope.kind !== "unstaged")
    return EMPTY_ROWS;

  const files = scopeFiles(snapshot, scope.kind);

  if (files === undefined) return EMPTY_ROWS;

  return files
    .map((file): VcsChangeRow => ({ source: "working", path: file.path, status: file.kind }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function changeRows(
  source: ChangeRow["source"],
  working: readonly VcsChangeRow[],
  manifest: ChangeSet | undefined,
  recorded: ChangeSet | undefined,
): readonly ChangeRow[] {
  if (source === "working") return working;

  if (source === "recorded") {
    return (recorded?.files ?? []).map((file): RecordedChangeRow => ({
      source: "recorded",
      path: file.path,
      added: file.stat.kind === "text" ? file.stat.added : 0,
      removed: file.stat.kind === "text" ? file.stat.removed : 0,
    }));
  }

  return (manifest?.files ?? []).map((change): VcsChangeRow => ({
    source: "commit",
    path: change.path,
    status: change.status,
  }));
}

const recordedVersions = new WeakMap<readonly ChangeRow[], number>();

let nextRecordedVersion = 0;

function recordedVersion(rows: readonly ChangeRow[]): number {
  const known = recordedVersions.get(rows);

  if (known !== undefined) return known;
  nextRecordedVersion += 1;
  recordedVersions.set(rows, nextRecordedVersion);

  return nextRecordedVersion;
}

export function patchIdentity(input: {
  readonly resolved: ResolvedChangesScope;
  readonly repository: ChangesRepository | undefined;
  readonly ignoreWhitespace: boolean;
  readonly rows: readonly ChangeRow[];
}): { readonly key: string; readonly lineage: string } | undefined {
  const value = input.resolved.value;
  const whitespace = input.ignoreWhitespace ? "w" : "";

  if (input.resolved.rows === "recorded") {
    return {
      key: `${value}\u0000${whitespace}\u0000${String(recordedVersion(input.rows))}`,
      lineage: `${value}\u0000${whitespace}`,
    };
  }

  const repository = input.repository;

  if (repository === undefined) return undefined;
  const scope = input.resolved.scope;

  return {
    key: [
      repository.root,
      scope.kind === "commit" ? scope.oid : repository.revision,
      value,
      input.ignoreWhitespace ? "ignore-whitespace" : "",
    ].join("\u0000"),
    lineage: `${repository.root}\u0000${value}\u0000${whitespace}`,
  };
}

function findPatch(
  snapshot: PatchSnapshot,
  source: { readonly key: string; readonly lineage: string } | undefined,
  path: string,
): { readonly entry: PatchEntry; readonly fresh: boolean } | undefined {
  const current = source !== undefined && snapshot.key === source.key;
  const fresh = current ? snapshot.fresh.get(path) : undefined;

  if (fresh !== undefined) return { entry: fresh, fresh: true };

  if (source === undefined || snapshot.lineage !== source.lineage) return undefined;

  const stale = snapshot.stale.get(path) ?? (current ? undefined : snapshot.fresh.get(path));

  return stale === undefined ? undefined : { entry: stale, fresh: false };
}

function entryStat(entry: PatchEntry): LineStat | undefined {
  switch (entry.kind) {
    case "ready":
      return { kind: "text", added: entry.added, removed: entry.removed };
    case "binary":
      return { kind: "binary" };
    case "empty":
      return { kind: "text", added: 0, removed: 0 };
    case "too_large":
    case "failed":
      return undefined;
    default: {
      const _exhaustive: never = entry;

      return _exhaustive;
    }
  }
}

export function viewedDigest(entry: PatchEntry): string | undefined {
  switch (entry.kind) {
    case "ready":
    case "binary":
      return entry.digest;
    case "empty":
      return patchDigest(EMPTY_PATCH);
    case "too_large":
    case "failed":
      return undefined;
    default: {
      const _exhaustive: never = entry;

      return _exhaustive;
    }
  }
}

export function stackSections(
  rows: readonly ChangeRow[],
  manifest: ChangeSet | undefined,
  snapshot: PatchSnapshot,
  source: { readonly key: string; readonly lineage: string } | undefined,
): readonly ChangesStackItem[] {
  const statByPath = manifestStats(manifest);

  return rows.map((row): ChangesStackItem => {
    const found = findPatch(snapshot, source, row.path);
    const section = patchStackSection({ path: row.path, entry: found?.entry });

    const stat =
      (row.source !== "recorded" && found?.fresh === true ? entryStat(found.entry) : undefined) ??
      rowStat(row, statByPath);

    return { ...section, stat };
  });
}

function manifestStats(manifest: ChangeSet | undefined): ReadonlyMap<string, LineStat> {
  return new Map((manifest?.files ?? []).map((change) => [change.path, change.stat]));
}

function rowStat(row: ChangeRow, statByPath: ReadonlyMap<string, LineStat>): LineStat {
  return row.source === "recorded"
    ? { kind: "text", added: row.added, removed: row.removed }
    : (statByPath.get(row.path) ?? UNKNOWN_STAT);
}

export function viewedStates(
  rows: readonly ChangeRow[],
  marks: Readonly<Record<string, { readonly digest: string }>> | undefined,
  snapshot: PatchSnapshot,
  source: { readonly key: string; readonly lineage: string } | undefined,
): ReadonlyMap<string, ViewedState> {
  return new Map(
    rows.map((row): [string, ViewedState] => {
      const mark = marks?.[row.path];
      const found = findPatch(snapshot, source, row.path);
      const digest = found?.fresh === true ? viewedDigest(found.entry) : undefined;

      if (mark === undefined) return [row.path, "unviewed"];

      if (digest === undefined) return [row.path, "unknown"];

      return [row.path, mark.digest === digest ? "viewed" : "changed"];
    }),
  );
}

export function sidebarFiles(
  sections: readonly ChangesStackItem[],
  rows: readonly ChangeRow[],
  viewed: ReadonlyMap<string, ViewedState>,
): readonly ChangesSidebarFile[] {
  const rowByPath = new Map(rows.map((row) => [row.path, row]));

  return sections.map((section) => {
    const row = rowByPath.get(section.path);

    const file = {
      path: section.path,
      stat: section.stat,
      viewed: viewed.get(section.path) ?? "unviewed",
    };

    return row === undefined || row.source === "recorded" ? file : { ...file, status: row.status };
  });
}

export function changeTotals(
  rows: readonly ChangeRow[],
  manifest: ChangeSet | undefined,
): ChangeTotals {
  const statByPath = manifestStats(manifest);

  return {
    fileCount: rows.length,
    stats: rows.reduce<{ added: number; removed: number } | undefined>(
      (total, row) => {
        const stat = rowStat(row, statByPath);

        if (total === undefined || stat.kind === "unknown") return undefined;

        return stat.kind === "binary"
          ? total
          : { added: total.added + stat.added, removed: total.removed + stat.removed };
      },
      { added: 0, removed: 0 },
    ),
  };
}

export function preparationOrder(
  rows: readonly ChangeRow[],
  activePath: string | undefined,
  collapsedPaths: readonly string[],
): readonly string[] {
  const collapsed = new Set(collapsedPaths);

  const active = Math.max(
    rows.findIndex((row) => row.path === activePath),
    0,
  );

  const nearest = rows.flatMap((_row, distance) => {
    const below = rows[active + distance]?.path;
    const above = distance === 0 ? undefined : rows[active - distance]?.path;

    return [below, above].filter((path) => path !== undefined);
  });

  return nearest.filter((path) => !collapsed.has(path));
}

function emptyScopeText(scope: WorkbenchChangesScope): string {
  switch (scope.kind) {
    case "uncommitted":
      return "Working tree is clean";
    case "staged":
      return "Nothing is staged";
    case "unstaged":
      return "No unstaged changes";
    case "thread":
      return "This chat made no file changes";
    case "turn":
      return "This turn made no file changes";
    case "commit":
      return "This commit changed no files";
    default: {
      const _exhaustive: never = scope;

      return _exhaustive;
    }
  }
}

interface ReadState {
  readonly isError: boolean;
  readonly isLoading: boolean;
  readonly error: Error | null;
}

function queryError(error: Error | null): string | undefined {
  if (error === null) return undefined;
  const message = error.message;

  return message.length > 160 ? `${message.slice(0, 159)}…` : message;
}

interface ChangesEmptyState {
  readonly text: string;
  readonly detail?: string;
}

export function changesEmptyState(input: {
  readonly resolved: ResolvedChangesScope;
  readonly snapshot: GitStatus | undefined;
  readonly manifest: ReadState;
  readonly recorded: ReadState;
}): ChangesEmptyState {
  if (input.resolved.rows === "recorded") {
    if (input.recorded.isError)
      return { text: "Couldn't read changes.", detail: queryError(input.recorded.error) };

    return {
      text: input.recorded.isLoading ? "Loading changes…" : emptyScopeText(input.resolved.scope),
    };
  }

  if (input.manifest.isError)
    return { text: "Couldn't read changes.", detail: queryError(input.manifest.error) };

  if (input.snapshot?.kind === "none")
    return { text: "Couldn't read changes. Check that this folder is a Git repository." };

  return {
    text:
      input.snapshot === undefined || input.manifest.isLoading
        ? "Loading changes…"
        : emptyScopeText(input.resolved.scope),
  };
}

export interface RevertTarget {
  readonly path: string;
  readonly untracked: boolean;
}

export function revertConfirmation(target: RevertTarget) {
  if (target.untracked) {
    return {
      title: "Delete File",
      description: `${target.path} is untracked, so reverting it deletes the file permanently. This can’t be undone.`,
      confirmLabel: "Delete File",
      pendingLabel: "Deleting…",
    };
  }

  return {
    title: "Revert Changes",
    description: `${target.path} goes back to the last commit, and its changes are lost. This can’t be undone.`,
    confirmLabel: "Revert Changes",
    pendingLabel: "Reverting…",
  };
}
