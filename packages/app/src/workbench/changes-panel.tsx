import { create, props } from "@stylexjs/stylex";
import { useMutation } from "@tanstack/react-query";
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactElement } from "react";
import type { FileStatus, LineStat, RunId, SessionId, WorkspaceId } from "@nyte-ai/sdk";
import { FileTypeIconSprite } from "../components/file-type-icon";
import { ConfirmDialog } from "@nyte-ai/ui/alert-dialog";
import { asId } from "@nyte-ai/schema";
import { createDiffFilesLoader } from "../conversation/diff-expansion.ts";
import { useMountEffect } from "../use-mount-effect.ts";
import { macPlatform } from "../platform.ts";
import {
  readGitPatches,
  readRunPatches,
  refreshVcs,
  useRunChanges,
  useSession,
  useSessionView,
  useVcsChanges,
  useVcsSnapshot,
  workspaceGit,
} from "../queries.ts";
import { conversationTurns } from "../view-helpers.ts";
import type { ConversationTurn } from "../view-helpers.ts";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import {
  branchReadout,
  changesRepository,
  changesScopeLabel,
  changesScopeValue,
  scopeFiles,
  turnChangeOptions,
  turnScopeOption,
  vcsRequestForScope,
  workingTreeScopeOptions,
} from "./change-scopes.ts";
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

const EMPTY_TURNS: readonly ConversationTurn[] = [];

const EMPTY_ROWS: readonly VcsChangeRow[] = [];

const EMPTY_RECORDED: readonly RecordedChangeRow[] = [];

const UNKNOWN_STAT: LineStat = { kind: "unknown" };

const recordedVersions = new WeakMap<readonly RecordedChangeRow[], number>();

let nextRecordedVersion = 0;

function recordedVersion(rows: readonly RecordedChangeRow[]): number {
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
    backgroundColor: role.bgBase,
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

/** The file a confirmation is about, and whether reverting it means the trash. */
interface RevertTarget {
  readonly path: string;
  readonly untracked: boolean;
}

/**
 * A tracked file goes back to its committed state, which nothing can undo. An
 * untracked file has no committed state to return to, so it is trashed instead
 * and the copy says so rather than claiming the change is unrecoverable.
 */
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

/**
 * The rail owns the only search surface, so the toolbar's filter command goes
 * through the field the rail renders rather than a second copy of its state.
 */
function focusFileFilter(field: HTMLInputElement | null): void {
  if (field === null) return;
  field.focus();
  field.select();
}

interface ChangesPanelProps {
  readonly visible?: boolean;
  readonly sessionId: SessionId | undefined;
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
  /**
   * Discards a file's working-tree changes. The panel confirms and reverts on
   * its own when this is unset; a host that supplies it owns the confirmation.
   */
  readonly onRevertPath?: (path: string) => void;
}

interface ChangesPanelViewProps extends ChangesPanelProps {
  readonly turns: readonly ConversationTurn[];
  readonly turnsError: Error | null;
  readonly liveRun: RunId | undefined;
  readonly workspace: WorkspaceId | undefined;
}

/**
 * The Changes tab for one scope.
 *
 * - Closing the revert confirmation returns focus to the affordance that opened it.
 * - Collapse state belongs to the panel so the toolbar can command it, but it
 *   describes one scope's files: switching scope starts over rather than
 *   collapsing same-named files in the scope that replaced them.
 * - A stored turn the transcript no longer holds collapses to the working tree.
 * - View options follow the repository; a turn shares the layout chosen for the
 *   tree it belongs to. Review marks do not: the same path carries a different
 *   patch in each scope, and a mark from one must not read as stale in another.
 * - A turn's own files are loaded, so its emptiness is a fact that a stale
 *   background failure cannot change.
 * - Only a working tree has both sides of a file to widen a gap with, and a
 *   state to revert to. A turn's patch and a commit's are records of an edit,
 *   and the files have moved on. Pierre re-renders every visible file when
 *   expandability changes, so it does not follow the revision.
 * - A reverted file no longer has the patch its review mark was filed under,
 *   so the mark clears.
 */
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
  turns,
  turnsError,
  liveRun,
  workspace,
}: ChangesPanelViewProps): ReactElement {
  const uiFontSize = useSetting(preferences.uiFontSize);
  const turnOptions = useMemo(() => turnChangeOptions(turns), [turns]);
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

  const selectedTurn =
    scope.kind === "turn"
      ? turnOptions.find((option) => option.scope.turnId === scope.turnId)
      : undefined;

  const activeScope: WorkbenchChangesScope =
    scope.kind === "turn" && selectedTurn === undefined ? UNCOMMITTED_SCOPE : scope;

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

  const workingScope = activeScope.kind !== "turn" && activeScope.kind !== "commit";

  const statusFiles = useMemo(
    () =>
      activeScope.kind === "turn" || activeScope.kind === "commit"
        ? undefined
        : scopeFiles(snapshot.data, activeScope.kind),
    [snapshot.data, activeScope.kind],
  );

  const workingRows = useMemo(
    () =>
      statusFiles === undefined
        ? EMPTY_ROWS
        : statusFiles
            .map((file): VcsChangeRow => ({
              source: "working",
              path: file.path,
              status: file.kind,
            }))
            .sort((left, right) => left.path.localeCompare(right.path)),
    [statusFiles],
  );

  const vcsRequest = vcsRequestForScope(activeScope);

  const manifest = useVcsChanges(
    repository === undefined ? undefined : vcsRequest,
    options.ignoreWhitespace,
    revision,
    visible && (!workingScope || workingRows.length > 0),
  );

  const statByPath = useMemo(
    () => new Map((manifest.data?.files ?? []).map((change) => [change.path, change.stat])),
    [manifest.data],
  );

  const commitRows = useMemo(
    (): readonly VcsChangeRow[] =>
      activeScope.kind === "commit"
        ? (manifest.data?.files ?? []).map((change) => ({
            source: "commit",
            path: change.path,
            status: change.status,
          }))
        : EMPTY_ROWS,
    [activeScope.kind, manifest.data],
  );

  const selectedRun = selectedTurn?.run ?? undefined;

  const runChanges = useRunChanges({
    workspace,
    runId: selectedRun,
    live: selectedRun !== undefined && selectedRun === liveRun,
    enabled: visible,
  });

  const recordedRows = useMemo(
    (): readonly RecordedChangeRow[] =>
      selectedTurn === undefined
        ? EMPTY_RECORDED
        : (runChanges.data?.files ?? []).map((file): RecordedChangeRow => ({
            source: "recorded",
            path: file.path,
            added: file.stat.kind === "text" ? file.stat.added : 0,
            removed: file.stat.kind === "text" ? file.stat.removed : 0,
          })),
    [selectedTurn, runChanges.data],
  );

  const rows: readonly ChangeRow[] = workingScope
    ? workingRows
    : selectedTurn !== undefined
      ? recordedRows
      : commitRows;

  const rowByPath = useMemo(() => new Map(rows.map((row) => [row.path, row])), [rows]);
  const stackOrder = useMemo(() => rows.map((row) => row.path), [rows]);

  const collapsedPaths =
    collapsedSections.scope === activeScopeValue ? collapsedSections.paths : NO_COLLAPSED_PATHS;

  const allCollapsed =
    stackOrder.length > 0 && stackOrder.every((path) => collapsedPaths.includes(path));

  const activePath = stackOrder.includes(selectedPath ?? "") ? selectedPath : stackOrder[0];

  const preparedPaths = useMemo((): readonly string[] => {
    if (!visible) return [];
    const collapsed = new Set(collapsedPaths);
    const active = Math.max(
      stackOrder.findIndex((path) => path === activePath),
      0,
    );
    const nearest: string[] = [];

    for (let distance = 0; nearest.length < stackOrder.length; distance += 1) {
      const below = stackOrder[active + distance];
      const above = distance === 0 ? undefined : stackOrder[active - distance];

      if (below !== undefined) nearest.push(below);

      if (above !== undefined) nearest.push(above);
    }

    return nearest.filter((path) => !collapsed.has(path));
  }, [visible, collapsedPaths, stackOrder, activePath]);

  const selectedTurnId = selectedTurn?.scope.turnId;
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

  const patchSource = useMemo((): PatchSource | undefined => {
    if (selectedTurnId !== undefined) {
      if (workspace === undefined || selectedRun === undefined) return undefined;

      return {
        key: `turn\u0000${selectedTurnId}\u0000${whitespace}\u0000${String(recordedVersion(recordedRows))}`,
        lineage: `turn\u0000${selectedTurnId}\u0000${whitespace}`,
        paths: stackOrder,
        read: (paths) => readRunPatches(workspace, selectedRun, paths, ignoreWhitespace),
      };
    }

    const request = vcsRequestForScope(activeScope);

    if (patchKey === undefined || request === undefined) return undefined;

    return {
      key: patchKey,
      lineage: vcsLineage,
      paths: stackOrder,
      read: (paths) => readGitPatches(request, paths, ignoreWhitespace),
    };
  }, [
    selectedTurnId,
    selectedRun,
    workspace,
    recordedRows,
    patchKey,
    vcsLineage,
    stackOrder,
    activeScope,
    ignoreWhitespace,
    whitespace,
  ]);

  const [patches] = useState(createPatchLoader);
  const refresh = useMutation({ mutationFn: refreshVcs });

  const patchSnapshot = useSyncExternalStore(
    patches.subscribe,
    patches.getSnapshot,
    patches.getSnapshot,
  );

  useLayoutEffect(() => {
    if (patchSource !== undefined) patches.setSource(patchSource);
  }, [patches, patchSource]);

  useLayoutEffect(() => {
    patches.prepare(preparedPaths);
  }, [patches, preparedPaths]);

  useMountEffect(() => () => patches.release());

  const patchFor = useCallback(
    (path: string): { readonly entry: PatchEntry; readonly fresh: boolean } | undefined => {
      const current = patchSource !== undefined && patchSnapshot.key === patchSource.key;
      const fresh = current ? patchSnapshot.fresh.get(path) : undefined;

      if (fresh !== undefined) return { entry: fresh, fresh: true };

      if (patchSource === undefined || patchSnapshot.lineage !== patchSource.lineage) {
        return undefined;
      }

      const stale =
        patchSnapshot.stale.get(path) ?? (current ? undefined : patchSnapshot.fresh.get(path));

      return stale === undefined ? undefined : { entry: stale, fresh: false };
    },
    [patchSnapshot, patchSource],
  );

  const sections = useMemo(
    () =>
      rows.map((row): ChangesStackItem => {
        const found = patchFor(row.path);
        const section = patchStackSection({ path: row.path, entry: found?.entry });

        const stat: LineStat =
          row.source === "recorded"
            ? { kind: "text", added: row.added, removed: row.removed }
            : ((found?.fresh === true ? entryStat(found.entry) : undefined) ??
              statByPath.get(row.path) ??
              UNKNOWN_STAT);

        return { ...section, stat };
      }),
    [rows, patchFor, statByPath],
  );

  const digestByPath = useMemo(() => {
    const digests = new Map<string, string>();

    for (const row of rows) {
      const found = patchFor(row.path);
      const digest = found?.fresh === true ? viewedDigest(found.entry) : undefined;

      if (digest !== undefined) digests.set(row.path, digest);
    }

    return digests;
  }, [rows, patchFor]);

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

  const readFailure =
    scope.kind === "turn"
      ? (transcriptFailure ?? vcsFailure)
      : (manifestFailure ?? vcsFailure ?? transcriptFailure);

  const emptyState: { readonly text: string; readonly detail?: string } =
    selectedTurn !== undefined
      ? { text: "This turn made no file changes" }
      : (readFailure ?? {
          text:
            snapshot.data === undefined || manifest.isLoading
              ? "Loading changes…"
              : emptyScopeText(activeScope),
        });

  const viewedScopeId = `${optionsScopeId}\u0000${activeScopeValue}`;

  const viewedByPath = useMemo(
    () =>
      new Map(
        rows.map((row) => {
          const mark = viewedSnapshot[viewedScopeId]?.files[row.path];
          const digest = digestByPath.get(row.path);

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
      ),
    [rows, digestByPath, viewedSnapshot, viewedScopeId],
  );

  const viewedState = useCallback(
    (path: string): ViewedState => viewedByPath.get(path) ?? "unviewed",
    [viewedByPath],
  );

  const [markNotice, setMarkNotice] = useState({ scope: "", text: "" });

  const setViewed = useCallback(
    (paths: readonly string[], viewed: boolean): void => {
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
    },
    [viewedScopeId, patches, activeScopeValue],
  );

  const setFileViewed = useCallback(
    (path: string, viewed: boolean): void => {
      setViewed([path], viewed);
    },
    [setViewed],
  );

  const expandable = repository !== undefined && workingScope;

  const loadDiffFiles = useMemo(
    () =>
      expandable && root !== undefined
        ? createDiffFilesLoader({
            readContents: async (input) => (await workspaceGit()).contents(input.path, input.scope),
            root,
            scope: { kind: "worktree" },
          })
        : undefined,
    [expandable, root],
  );

  const sidebarFiles = useMemo(
    (): readonly ChangesSidebarFile[] =>
      sections.map((section) => {
        const row = rowByPath.get(section.path);
        const file = { path: section.path, stat: section.stat, viewed: viewedState(section.path) };

        return row === undefined || row.source === "recorded"
          ? file
          : { ...file, status: row.status };
      }),
    [sections, rowByPath, viewedState],
  );

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

  const askToRevert = useCallback(
    (path: string): void => {
      const row = rowByPath.get(path);

      if (row === undefined || row.source !== "working") return;
      const opener = document.activeElement;
      revertReturnRef.current = opener instanceof HTMLButtonElement ? opener : null;
      setRevertError(undefined);
      setRevertTarget({ path, untracked: row.status === "untracked" });
    },
    [rowByPath],
  );

  const revertPath = workingScope ? (onRevertPath ?? askToRevert) : undefined;

  const confirmRevert = async (target: RevertTarget): Promise<void> => {
    setReverting(true);
    setRevertError(undefined);

    try {
      if (revision === undefined) {
        setRevertError("Refresh changes and try again.");

        return;
      }

      const result = await (
        await workspaceGit()
      ).discard([target.path], {
        expect: asId<"git-revision">(revision),
      });

      if (result.kind === "stale") {
        void refreshVcs();
        setRevertError("Changes changed. Review them and try again.");

        return;
      }

      if (result.kind === "rejected") {
        setRevertError(result.reason);

        return;
      }

      if (result.kind === "busy") {
        setRevertError("A run is still writing to this workspace.");

        return;
      }

      changesViewed.clearViewed(viewedScopeId, target.path);
      void refreshVcs();
      setRevertTarget(undefined);
    } catch (error) {
      setRevertError(error instanceof Error ? error.message : "Couldn’t revert this file.");
    } finally {
      setReverting(false);
    }
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
        const action = changesShortcutAction(event.nativeEvent, macPlatform(undefined));

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
          ...turnOptions.map(turnScopeOption),
        ])}
        scopeStats={scopeStats}
        scopeFileCount={rows.length}
        snapshot={snapshot.data}
        repository={repository}
        branch={branchReadout(snapshot.data)}
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
  const view = useSessionView(props.sessionId);
  const session = useSession(props.sessionId);
  const turns = useMemo(
    () => (view === undefined ? EMPTY_TURNS : conversationTurns(view).turns),
    [view],
  );
  const execution = view?.execution;

  return (
    <ChangesPanelView
      {...props}
      turns={turns}
      turnsError={null}
      liveRun={execution === undefined || execution.kind === "idle" ? undefined : execution.run.id}
      workspace={session.data?.workspace ?? undefined}
    />
  );
}

export function ChangesPanel(props: ChangesPanelProps): ReactElement {
  return props.sessionId === undefined ? (
    <ChangesPanelView
      {...props}
      turns={EMPTY_TURNS}
      turnsError={null}
      liveRun={undefined}
      workspace={undefined}
    />
  ) : (
    <SessionChangesPanel {...props} sessionId={props.sessionId} />
  );
}
