import { create, props } from "@stylexjs/stylex";
import { useMutation } from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import type {
  ChangeSet,
  ChangeSource,
  FileStatus,
  LineStat,
  RunId,
  SessionId,
  SessionView,
  WorkspaceId,
} from "@nyte-ai/sdk";
import { FileTypeIconSprite } from "../components/file-type-icon";
import { ConfirmDialog } from "@nyte-ai/ui/alert-dialog";
import { asId } from "@nyte-ai/schema";
import { createDiffFilesLoader } from "../conversation/diff-expansion.ts";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import {
  readGitPatches,
  readRecordedPatches,
  refreshVcs,
  useRecordedChanges,
  useSession,
  useVcsChanges,
  useVcsSnapshot,
  workspaceGit,
} from "../queries.ts";
import { conversationTurns } from "../view-helpers.ts";
import { sessionWatch, useWatchSelect } from "../sdk.tsx";
import { usePaneControllerSnapshot } from "../layout/pane-context.tsx";
import { activeSelection } from "../layout/pane-layout.ts";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import {
  branchReadout,
  changesRepository,
  changesScopeLabel,
  changesScopeValue,
  scopeFiles,
  sameTurnOptions,
  sessionScopeOption,
  turnChangeOptions,
  turnScopeOption,
  vcsRequestForScope,
  workingTreeScopeOptions,
} from "./change-scopes.ts";
import type { TurnChangeOption } from "./change-scopes.ts";
import { ChangesSidebar } from "./changes-sidebar.tsx";
import type { ChangesSidebarFile } from "./changes-sidebar.tsx";
import { preferences, useSetting } from "../preferences/index.ts";
import { ChangesStack } from "./changes-stack.tsx";
import type { ChangesStackItem } from "./changes-stack-code-view.ts";
import { createPatchLoader } from "./changes-patches.ts";
import type { PatchEntry, PatchSource } from "./changes-patches.ts";
import { ChangesToolbar, changesShortcutAction } from "./changes-toolbar.tsx";
import { changesViewOptions, useChangesViewOptions } from "./changes-view-options.ts";
import { changesViewed, patchDigest } from "./changes-viewed.ts";
import type { ViewedState } from "./changes-viewed.ts";
import type { WorkbenchChangesScope } from "./controller.ts";
import { EMPTY_PATCH, patchStackSection } from "./stacked-diff.ts";
import { nyte } from "../nyte.ts";

interface VcsChangeRow {
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

type ChangeRow = VcsChangeRow | RecordedChangeRow;

const NO_TURN_OPTIONS: readonly TurnChangeOption[] = [];

const EMPTY_ROWS: readonly VcsChangeRow[] = [];

const UNKNOWN_STAT: LineStat = { kind: "unknown" };

const recordedVersions = new WeakMap<readonly ChangeRow[], number>();

let nextRecordedVersion = 0;

function recordedVersion(rows: readonly ChangeRow[]): number {
  const known = recordedVersions.get(rows);

  if (known !== undefined) return known;
  nextRecordedVersion += 1;
  recordedVersions.set(rows, nextRecordedVersion);

  return nextRecordedVersion;
}

function viewedDigest(entry: PatchEntry): string | undefined {
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

const UNCOMMITTED_SCOPE: WorkbenchChangesScope = { kind: "uncommitted" };

const NO_COLLAPSED_PATHS: readonly string[] = [];

const styles = create({
  panel: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
  },
  body: { display: "flex", flex: 1, minHeight: 0, minWidth: 0 },
  unmarked: {
    paddingBlock: space.s1_5,
    paddingInline: space.s3,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    textWrap: "pretty",
  },
  empty: {
    display: "flex",
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 0,
    padding: space.s5,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    textAlign: "center",
    textWrap: "pretty",
  },
});

function queryError(error: Error | null): string | undefined {
  if (error === null) return undefined;
  const message = error.message;

  return message.length > 160 ? `${message.slice(0, 159)}…` : message;
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

interface RevertTarget {
  readonly path: string;
  readonly untracked: boolean;
}

function revertConfirmation(target: RevertTarget) {
  if (target.untracked) {
    return {
      title: "Move to Trash",
      description: `${target.path} is untracked, so reverting it moves the file to the trash.`,
      confirmLabel: "Move to Trash",
      pendingLabel: "Moving…",
    };
  }

  return {
    title: "Revert Changes",
    description: `${target.path} goes back to the last commit, and its changes are lost. This can’t be undone.`,
    confirmLabel: "Revert Changes",
    pendingLabel: "Reverting…",
  };
}

type PatchSnapshot = ReturnType<ReturnType<typeof createPatchLoader>["getSnapshot"]>;

function findPatch(
  snapshot: PatchSnapshot,
  source: PatchSource | undefined,
  path: string,
): { readonly entry: PatchEntry; readonly fresh: boolean } | undefined {
  const current = source !== undefined && snapshot.key === source.key;
  const fresh = current ? snapshot.fresh.get(path) : undefined;

  if (fresh !== undefined) return { entry: fresh, fresh: true };

  if (source === undefined || snapshot.lineage !== source.lineage) return undefined;

  const stale = snapshot.stale.get(path) ?? (current ? undefined : snapshot.fresh.get(path));

  return stale === undefined ? undefined : { entry: stale, fresh: false };
}

function usePatchLoader(
  source: PatchSource | undefined,
  preparedPaths: readonly string[],
): ReturnType<typeof createPatchLoader> {
  const [patches] = useState(createPatchLoader);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- points the patch loader cache at the source before children read it
  useLayoutEffect(() => {
    if (source !== undefined) patches.setSource(source);
  }, [patches, source]);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- tells the patch loader cache which paths to prefetch
  useLayoutEffect(() => {
    patches.prepare(preparedPaths);
  }, [patches, preparedPaths]);

  useMountEffect(() => () => patches.release());

  return patches;
}

function useChangeRows(
  source: ChangeRow["source"],
  workingRows: readonly VcsChangeRow[],
  manifest: ChangeSet | undefined,
  recorded: ChangeSet | undefined,
): readonly ChangeRow[] {
  "use memo";

  if (source === "working") return workingRows;

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

function useStackSections(
  rows: readonly ChangeRow[],
  manifest: ChangeSet | undefined,
  patchSnapshot: PatchSnapshot,
  patchSource: PatchSource | undefined,
): readonly ChangesStackItem[] {
  "use memo";

  const statByPath = new Map((manifest?.files ?? []).map((change) => [change.path, change.stat]));

  return rows.map((row): ChangesStackItem => {
    const found = findPatch(patchSnapshot, patchSource, row.path);
    const section = patchStackSection({ path: row.path, entry: found?.entry });

    const stat: LineStat =
      row.source === "recorded"
        ? { kind: "text", added: row.added, removed: row.removed }
        : ((found?.fresh === true ? entryStat(found.entry) : undefined) ??
          statByPath.get(row.path) ??
          UNKNOWN_STAT);

    return { ...section, stat };
  });
}

function preparationOrder(
  rows: readonly ChangeRow[],
  activePath: string | undefined,
  collapsedPaths: readonly string[],
): readonly string[] {
  const collapsed = new Set(collapsedPaths);

  const active = Math.max(
    rows.findIndex((row) => row.path === activePath),
    0,
  );

  const nearest: string[] = [];

  for (let distance = 0; nearest.length < rows.length; distance += 1) {
    const below = rows[active + distance]?.path;
    const above = distance === 0 ? undefined : rows[active - distance]?.path;

    if (below !== undefined) nearest.push(below);

    if (above !== undefined) nearest.push(above);
  }

  return nearest.filter((path) => !collapsed.has(path));
}

async function revertFile(path: string, revision: string | undefined): Promise<string | undefined> {
  if (revision === undefined) return "Refresh changes and try again.";

  try {
    const result = await (
      await workspaceGit()
    ).discard([path], {
      expect: asId<"git-revision">(revision),
    });

    if (result.kind === "stale") {
      void refreshVcs();

      return "Changes changed. Review them and try again.";
    }

    if (result.kind === "rejected") return result.reason;

    if (result.kind === "busy") return "A run is still writing to this workspace.";

    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : "Couldn’t revert this file.";
  }
}

function focusFileFilter(field: HTMLInputElement | null): void {
  if (field === null) return;
  field.focus();
  field.select();
}

interface ChangesPanelProps {
  readonly visible?: boolean;
  readonly scope: WorkbenchChangesScope;
  readonly selectedPath: string | undefined;
  readonly revealPathRevision: number;
  readonly scrollTop: number;
  readonly fileTreeVisible: boolean;
  readonly onScopeChange: (scope: WorkbenchChangesScope) => void;
  readonly onToggleFileTree: () => void;
  readonly onSelectPath: (path: string | undefined) => void;
  readonly onRevealPath: (path: string) => void;
  readonly onScrollTop: (scrollTop: number) => void;
  readonly onRevertPath?: (path: string) => void;
  readonly onOpenLink?: (url: string) => void;
}

interface ChangesPanelViewProps extends ChangesPanelProps {
  readonly sessionId: SessionId | undefined;
  readonly turnOptions: readonly TurnChangeOption[];
  readonly turnsError: Error | null;
  readonly liveRun: RunId | undefined;
  readonly workspace: WorkspaceId | undefined;
  readonly sessionChanges: SessionView["changes"] | undefined;
}

function ChangesPanelView({
  visible = true,
  scope,
  selectedPath,
  revealPathRevision,
  scrollTop,
  fileTreeVisible,
  onScopeChange,
  onToggleFileTree,
  onSelectPath,
  onRevealPath,
  onScrollTop,
  onRevertPath,
  onOpenLink,
  sessionId,
  turnOptions,
  turnsError,
  liveRun,
  workspace,
  sessionChanges,
}: ChangesPanelViewProps): ReactElement {
  const uiFontSize = useSetting(preferences.uiFontSize);

  const sessionOption =
    sessionChanges === undefined ? undefined : sessionScopeOption(sessionChanges);

  const snapshot = useVcsSnapshot(visible);
  const filterInput = useRef<HTMLInputElement>(null);
  const revertReturnRef = useRef<HTMLButtonElement | null>(null);
  const [revertTarget, setRevertTarget] = useState<RevertTarget | undefined>(undefined);
  const [reverting, setReverting] = useState(false);
  const [revertError, setRevertError] = useState<string | undefined>(undefined);
  const [appliedReveal, setAppliedReveal] = useState({ scope: "", revision: 0 });

  const [collapsedSections, setCollapsedSections] = useState<{
    readonly scope: string;
    readonly paths: readonly string[];
  }>({ scope: "", paths: NO_COLLAPSED_PATHS });

  const [markNotice, setMarkNotice] = useState({ scope: "", text: "" });

  const selectedTurn =
    scope.kind === "turn"
      ? turnOptions.find((option) => option.scope.turnId === scope.turnId)
      : undefined;

  const activeScope: WorkbenchChangesScope =
    (scope.kind === "turn" && selectedTurn === undefined) ||
    (scope.kind === "thread" && sessionId === undefined)
      ? UNCOMMITTED_SCOPE
      : scope;

  const selectedRun = selectedTurn?.run ?? undefined;

  const recordedSource: ChangeSource | undefined =
    activeScope.kind === "thread" && sessionId !== undefined
      ? { kind: "session", session: sessionId }
      : selectedRun === undefined
        ? undefined
        : { kind: "run", run: selectedRun };

  const recordedScope = activeScope.kind === "thread" || activeScope.kind === "turn";

  const activeScopeValue = changesScopeValue(activeScope);
  const repository = changesRepository(snapshot.data);
  const root = repository?.root;
  const revision = repository?.revision;

  const viewedSnapshot = useSyncExternalStore(
    changesViewed.subscribe,
    changesViewed.getSnapshot,
    changesViewed.getSnapshot,
  );

  const optionsScopeId = root ?? "workspace";
  const options = useChangesViewOptions(optionsScopeId);

  const workingScope = !recordedScope && activeScope.kind !== "commit";

  const statusFiles =
    activeScope.kind === "uncommitted" ||
    activeScope.kind === "staged" ||
    activeScope.kind === "unstaged"
      ? scopeFiles(snapshot.data, activeScope.kind)
      : undefined;

  const workingRows =
    statusFiles === undefined
      ? EMPTY_ROWS
      : statusFiles
          .map((file): VcsChangeRow => ({
            source: "working",
            path: file.path,
            status: file.kind,
          }))
          .sort((left, right) => left.path.localeCompare(right.path));

  const vcsRequest = vcsRequestForScope(activeScope);

  const manifest = useVcsChanges(
    repository === undefined ? undefined : vcsRequest,
    options.ignoreWhitespace,
    revision,
    visible && (!workingScope || workingRows.length > 0),
  );

  const recorded = useRecordedChanges({
    workspace,
    source: recordedSource,
    live:
      liveRun !== undefined &&
      (recordedSource?.kind === "session" ||
        (recordedSource?.kind === "run" && recordedSource.run === liveRun)),
    enabled: visible,
  });

  const rows = useChangeRows(
    workingScope ? "working" : recordedScope ? "recorded" : "commit",
    workingRows,
    manifest.data,
    recorded.data,
  );

  const stackOrder = rows.map((row) => row.path);

  const collapsedPaths =
    collapsedSections.scope === activeScopeValue ? collapsedSections.paths : NO_COLLAPSED_PATHS;

  const allCollapsed = rows.length > 0 && rows.every((row) => collapsedPaths.includes(row.path));

  const activePath = rows.some((row) => row.path === selectedPath) ? selectedPath : rows[0]?.path;

  const preparedPaths = visible ? preparationOrder(rows, activePath, collapsedPaths) : [];

  const { ignoreWhitespace } = options;

  const patchKey =
    repository === undefined || vcsRequest === undefined
      ? undefined
      : [
          repository.root,
          activeScope.kind === "commit" ? activeScope.oid : repository.revision,
          activeScopeValue,
          ignoreWhitespace ? "ignore-whitespace" : "",
        ].join("\u0000");

  const whitespace = ignoreWhitespace ? "w" : "";
  const vcsLineage = `${root ?? ""}\u0000${activeScopeValue}\u0000${whitespace}`;

  const patchSource: PatchSource | undefined = recordedScope
    ? workspace === undefined || recordedSource === undefined
      ? undefined
      : {
          key: `${activeScopeValue}\u0000${whitespace}\u0000${String(recordedVersion(rows))}`,
          lineage: `${activeScopeValue}\u0000${whitespace}`,
          paths: stackOrder,
          read: (paths) => readRecordedPatches(workspace, recordedSource, paths, ignoreWhitespace),
        }
    : patchKey === undefined || vcsRequest === undefined
      ? undefined
      : {
          key: patchKey,
          lineage: vcsLineage,
          paths: stackOrder,
          read: (paths) => readGitPatches(vcsRequest, paths, ignoreWhitespace),
        };

  const patches = usePatchLoader(patchSource, preparedPaths);
  const refresh = useMutation({ mutationFn: refreshVcs });

  const patchSnapshot = useSyncExternalStore(
    patches.subscribe,
    patches.getSnapshot,
    patches.getSnapshot,
  );

  const sections = useStackSections(rows, manifest.data, patchSnapshot, patchSource);

  const transcriptError = queryError(turnsError);

  const vcsFailure =
    snapshot.data?.kind === "none"
      ? { text: "Couldn't read changes. Check that this folder is a Git repository." }
      : undefined;

  const transcriptFailure =
    transcriptError === undefined
      ? undefined
      : { text: "Couldn't read this conversation's changes.", detail: transcriptError };

  const manifestFailure = manifest.isError
    ? { text: "Couldn't read changes.", detail: queryError(manifest.error) }
    : undefined;

  const recordedFailure = recorded.isError
    ? { text: "Couldn't read changes.", detail: queryError(recorded.error) }
    : undefined;

  const emptyState: { readonly text: string; readonly detail?: string } = recordedScope
    ? (transcriptFailure ??
      recordedFailure ?? {
        text: recorded.isLoading ? "Loading changes…" : emptyScopeText(activeScope),
      })
    : (manifestFailure ??
      vcsFailure ??
      transcriptFailure ?? {
        text:
          snapshot.data === undefined || manifest.isLoading
            ? "Loading changes…"
            : emptyScopeText(activeScope),
      });

  const viewedScopeId = `${optionsScopeId}\u0000${activeScopeValue}`;

  const viewedByPath = new Map(
    rows.map((row) => {
      const mark = viewedSnapshot[viewedScopeId]?.files[row.path];
      const found = findPatch(patchSnapshot, patchSource, row.path);
      const digest = found?.fresh === true ? viewedDigest(found.entry) : undefined;

      const state: ViewedState =
        mark === undefined
          ? "unviewed"
          : digest === undefined
            ? "unknown"
            : mark.digest === digest
              ? "viewed"
              : "changed";

      return [row.path, state];
    }),
  );

  const viewedState = (path: string): ViewedState => viewedByPath.get(path) ?? "unviewed";
  const rowByPath = new Map(rows.map((row) => [row.path, row]));

  const sidebarFiles: readonly ChangesSidebarFile[] = sections.map((section) => {
    const row = rowByPath.get(section.path);
    const file = { path: section.path, stat: section.stat, viewed: viewedState(section.path) };

    return row === undefined || row.source === "recorded" ? file : { ...file, status: row.status };
  });

  const setViewed = (paths: readonly string[], viewed: boolean): void => {
    if (!viewed) {
      changesViewed.clearAllViewed(viewedScopeId, paths);

      return;
    }

    const scopeValue = activeScopeValue;

    void patches.ensure(paths).then((answer) => {
      if (answer.kind === "superseded") {
        setMarkNotice({
          scope: scopeValue,
          text: "The changes moved before every file was read, so nothing was marked viewed.",
        });

        return;
      }

      const marks = paths.flatMap((path) => {
        const entry = answer.entries.get(path);
        const digest = entry === undefined ? undefined : viewedDigest(entry);

        return digest === undefined ? [] : [{ path, digest }];
      });

      changesViewed.markAllViewed(viewedScopeId, marks);
      const unread = paths.length - marks.length;

      setMarkNotice({
        scope: scopeValue,
        text:
          unread === 0
            ? ""
            : unread === 1
              ? "1 file wasn’t marked viewed because its diff couldn’t be read."
              : `${String(unread)} files weren’t marked viewed because their diffs couldn’t be read.`,
      });
    });
  };

  const setFileViewed = (path: string, viewed: boolean): void => {
    setViewed([path], viewed);
  };

  const expandable = repository !== undefined && workingScope;

  const loadDiffFiles =
    expandable && root !== undefined
      ? createDiffFilesLoader({
          readContents: async (input) => (await workspaceGit()).contents(input.path, input.scope),
          root,
          scope: { kind: "worktree" },
        })
      : undefined;

  const scopeStats = sections.reduce<{ added: number; removed: number } | undefined>(
    (total, section) =>
      total === undefined || section.stat.kind === "unknown"
        ? undefined
        : section.stat.kind === "binary"
          ? total
          : {
              added: total.added + section.stat.added,
              removed: total.removed + section.stat.removed,
            },
    { added: 0, removed: 0 },
  );

  const filterFiles = (): void => {
    if (!fileTreeVisible) onToggleFileTree();
    requestAnimationFrame(() => focusFileFilter(filterInput.current));
  };

  const askToRevert = (path: string): void => {
    const row = rowByPath.get(path);

    if (row === undefined || row.source !== "working") return;
    const opener = document.activeElement;
    revertReturnRef.current = opener instanceof HTMLButtonElement ? opener : null;
    setRevertError(undefined);
    setRevertTarget({ path, untracked: row.status === "untracked" });
  };

  const revertPath = workingScope ? (onRevertPath ?? askToRevert) : undefined;

  const confirmRevert = async (target: RevertTarget): Promise<void> => {
    setReverting(true);
    setRevertError(undefined);
    const failure = await revertFile(target.path, revision);
    setReverting(false);

    if (failure !== undefined) {
      setRevertError(failure);

      return;
    }

    changesViewed.clearViewed(viewedScopeId, target.path);
    void refreshVcs();
    setRevertTarget(undefined);
  };

  const revertCopy = revertConfirmation(revertTarget ?? { path: "", untracked: false });

  const toggleCollapseAll = (): void => {
    setCollapsedSections({
      scope: activeScopeValue,
      paths: allCollapsed ? NO_COLLAPSED_PATHS : stackOrder,
    });
  };

  const toggleCollapsedPath = (path: string): void => {
    setCollapsedSections((current) => {
      const paths = current.scope === activeScopeValue ? current.paths : NO_COLLAPSED_PATHS;

      return {
        scope: activeScopeValue,
        paths: paths.includes(path) ? paths.filter((entry) => entry !== path) : [...paths, path],
      };
    });
  };

  return (
    <section
      {...props(styles.panel)}
      aria-label="Workspace changes"
      onKeyDown={(event) => {
        const action = changesShortcutAction(event.nativeEvent, nyte.platform === "darwin");

        if (action === undefined) return;
        event.preventDefault();

        if (action === "filter-files") {
          filterFiles();

          return;
        }

        if (action === "refresh") {
          refresh.mutate();

          return;
        }

        changesViewOptions.setOptions(optionsScopeId, {
          ignoreWhitespace: !options.ignoreWhitespace,
        });
      }}
    >
      <FileTypeIconSprite />
      <ChangesToolbar
        scope={activeScope}
        scopeLabel={changesScopeLabel(activeScope, [
          ...workingTreeScopeOptions(snapshot.data),
          ...(sessionOption === undefined ? [] : [sessionOption]),
          ...turnOptions.map(turnScopeOption),
        ])}
        scopeStats={scopeStats}
        scopeFileCount={rows.length}
        snapshot={snapshot.data}
        repository={repository}
        branch={branchReadout(snapshot.data)}
        sessionOption={sessionOption}
        turnOptions={turnOptions}
        viewOptions={options}
        fileTreeVisible={fileTreeVisible}
        onScopeChange={onScopeChange}
        onViewOptionsChange={(changes) => {
          changesViewOptions.setOptions(optionsScopeId, changes);
        }}
        onToggleFileTree={onToggleFileTree}
        onRefresh={() => refresh.mutate()}
        refreshing={refresh.isPending}
        onFilterFiles={filterFiles}
        allFilesCollapsed={allCollapsed}
        onToggleCollapseAll={toggleCollapseAll}
        onOpenLink={onOpenLink}
      />
      {rows.length === 0 ? (
        <div
          role={emptyState.detail === undefined ? "status" : "alert"}
          title={emptyState.detail}
          {...props(styles.empty)}
        >
          {emptyState.text}
        </div>
      ) : (
        <div key={`${optionsScopeId}\u0000${activeScopeValue}`} {...props(styles.body)}>
          {fileTreeVisible && (
            <ChangesSidebar
              key={uiFontSize}
              files={sidebarFiles}
              activePath={activePath}
              filterInputRef={filterInput}
              onRevealPath={onRevealPath}
              onAllViewedChange={setViewed}
            />
          )}
          {visible && (
            <ChangesStack
              items={sections}
              collapsedPaths={collapsedPaths}
              onToggleCollapsed={toggleCollapsedPath}
              onExpand={(path) =>
                setCollapsedSections((current) => ({
                  ...current,
                  paths: current.paths.filter((entry) => entry !== path),
                }))
              }
              scrollTop={scrollTop}
              focusPath={activePath}
              focusRevision={
                appliedReveal.scope === activeScopeValue &&
                appliedReveal.revision === revealPathRevision
                  ? 0
                  : revealPathRevision
              }
              onFocusApplied={(revision) => setAppliedReveal({ scope: activeScopeValue, revision })}
              layout={options.layout}
              wordWrap={options.wordWrap}
              loadDiffFiles={loadDiffFiles}
              viewedState={viewedState}
              onViewedChange={setFileViewed}
              onRevertPath={revertPath}
              onScrollTop={onScrollTop}
              onActivePath={onSelectPath}
              onDemandPatch={patches.mount}
            />
          )}
        </div>
      )}
      {markNotice.scope === activeScopeValue && markNotice.text !== "" && (
        <div role="status" {...props(styles.unmarked)}>
          {markNotice.text}
        </div>
      )}
      <ConfirmDialog
        open={revertTarget !== undefined}
        pending={reverting}
        error={revertError}
        finalFocus={revertReturnRef}
        title={revertCopy.title}
        description={revertCopy.description}
        confirmLabel={revertCopy.confirmLabel}
        pendingLabel={revertCopy.pendingLabel}
        onOpenChange={(open) => {
          if (!open) setRevertTarget(undefined);
        }}
        onConfirm={() => {
          if (revertTarget !== undefined) void confirmRevert(revertTarget);
        }}
      />
    </section>
  );
}

function SessionChangesPanel(
  props: ChangesPanelProps & { readonly sessionId: SessionId },
): ReactElement {
  const store = sessionWatch(props.sessionId);

  const turnOptions = useWatchSelect(
    store,
    ({ value }) =>
      value === undefined ? NO_TURN_OPTIONS : turnChangeOptions(conversationTurns(value)),
    sameTurnOptions,
  );

  const liveRun = useWatchSelect(store, ({ value }) =>
    value === undefined || value.execution.kind === "idle" ? undefined : value.execution.run.id,
  );

  const sessionChanges = useWatchSelect(store, ({ value }) => value?.changes);
  const workspace = useSession(props.sessionId, (session) => session.workspace);

  return (
    <ChangesPanelView
      {...props}
      turnOptions={turnOptions}
      turnsError={null}
      liveRun={liveRun}
      workspace={workspace.data ?? undefined}
      sessionChanges={sessionChanges}
    />
  );
}

export function ChangesPanel(props: ChangesPanelProps): ReactElement {
  const selection = activeSelection(usePaneControllerSnapshot().layout);

  return selection.kind !== "session" ? (
    <ChangesPanelView
      {...props}
      sessionId={undefined}
      turnOptions={NO_TURN_OPTIONS}
      turnsError={null}
      liveRun={undefined}
      workspace={undefined}
      sessionChanges={undefined}
    />
  ) : (
    <SessionChangesPanel {...props} sessionId={selection.sessionId} />
  );
}
