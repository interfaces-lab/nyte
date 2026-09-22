import { create, props } from "@stylexjs/stylex";
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { isTerminalPhase } from "@nyte-ai/protocol";
import type { RunId, SessionId, Turn, VcsFileKind } from "@nyte-ai/protocol";
import { FileTypeIconSprite } from "../components/file-type-icon";
import { ConfirmDialog } from "../components/confirm-dialog.tsx";
import { createDiffFilesLoader } from "../conversation/diff-expansion.ts";
import { nyte } from "../nyte.ts";
import { macPlatform } from "../platform.ts";
import {
  refreshVcs,
  useRunDiff,
  useSessionSnapshot,
  useVcsDiff,
  useVcsSnapshot,
} from "../queries.ts";
import { t } from "../theme/vars.stylex.ts";
import {
  branchReadout,
  changesScopeLabel,
  changesScopeValue,
  diffRequestForScope,
  scopeFiles,
  turnChangeOptions,
  turnScopeOption,
  workingTreeScopeOptions,
} from "./change-scopes.ts";
import { ChangesSidebar } from "./changes-sidebar.tsx";
import type { ChangesSidebarFile } from "./changes-sidebar.tsx";
import { ChangesStack } from "./changes-stack.tsx";
import type { ChangesStackItem } from "./changes-stack-code-view.ts";
import { ChangesToolbar, changesShortcutAction } from "./changes-toolbar.tsx";
import { changesViewOptions } from "./changes-view-options.ts";
import { changesViewed, patchDigest } from "./changes-viewed.ts";
import type { ViewedFile, ViewedState } from "./changes-viewed.ts";
import type { WorkbenchChangesScope } from "./controller.ts";
import {
  EMPTY_PATCH,
  uncommittedStackSection,
  type ChangeStackSection,
  type UncommittedPatch,
} from "./stacked-diff.ts";

interface WorkingChangeRow {
  readonly source: "working";
  readonly path: string;
  readonly status: VcsFileKind;
}

/** A file whose patch is the record: a turn's edit, or one commit's diff. */
interface PatchChange {
  readonly source: "patch";
  readonly path: string;
  readonly patch: string;
  readonly added: number;
  readonly removed: number;
}

type PatchChangeRow = PatchChange &
  ({ readonly origin: "recorded" } | { readonly origin: "vcs"; readonly status: VcsFileKind });

type ChangeRow = WorkingChangeRow | PatchChangeRow;

const EMPTY_TURNS: readonly Turn[] = [];

const EMPTY_ROWS: readonly WorkingChangeRow[] = [];

const UNCOMMITTED_SCOPE: WorkbenchChangesScope = { kind: "uncommitted" };

const NO_COLLAPSED_PATHS: readonly string[] = [];

const styles = create({
  panel: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: t.bgBase,
  },
  body: { display: "flex", flex: 1, minHeight: 0, minWidth: 0 },
  empty: {
    display: "flex",
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 0,
    padding: 20,
    color: t.textTertiary,
    fontSize: t.fontSm,
    textAlign: "center",
    textWrap: "pretty",
  },
});

function queryError(error: Error | null): string | undefined {
  if (error === null) return undefined;
  const message = error.message;

  return message.length > 160 ? `${message.slice(0, 159)}…` : message;
}

function uncommittedPatchState(
  patch: string | undefined,
  diffs: { readonly isLoading: boolean; readonly isError: boolean },
): UncommittedPatch {
  if (patch !== undefined && patch.trim() !== "") return { kind: "ready", patch };

  if (diffs.isError) return { kind: "failed" };

  if (diffs.isLoading) return { kind: "pending" };

  return { kind: "empty" };
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
export interface RevertTarget {
  readonly path: string;
  readonly untracked: boolean;
}

/**
 * A tracked file goes back to its committed state, which nothing can undo. An
 * untracked file has no committed state to return to, so it is trashed instead
 * and the copy says so rather than claiming the change is unrecoverable.
 */
export function revertConfirmation(target: RevertTarget) {
  if (target.untracked) {
    return {
      title: "Move to Trash?",
      description: `${target.path} is untracked, so reverting it moves the file to the trash.`,
      confirmLabel: "Move to Trash",
      pendingLabel: "Moving…",
    };
  }

  return {
    title: "Revert changes?",
    description: `${target.path} goes back to the last commit, and its changes are lost. This can’t be undone.`,
    confirmLabel: "Revert",
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
  readonly turns: readonly Turn[];
  readonly turnsError: Error | null;
  readonly liveRun: RunId | undefined;
}

function ChangesPanelView({
  visible = true,
  sessionId,
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
}: ChangesPanelViewProps): ReactElement {
  const turnOptions = useMemo(() => turnChangeOptions(turns), [turns]);
  const snapshot = useVcsSnapshot(visible);
  const filterInput = useRef<HTMLInputElement>(null);
  // The affordance that opened the confirmation, so closing it returns focus there.
  const revertReturnRef = useRef<HTMLButtonElement | null>(null);
  const [revertTarget, setRevertTarget] = useState<RevertTarget | undefined>(undefined);
  const [reverting, setReverting] = useState(false);
  const [revertError, setRevertError] = useState<string | undefined>(undefined);
  const [appliedReveal, setAppliedReveal] = useState({ scope: "", revision: 0 });

  // Collapse state belongs to the panel so the toolbar can command it, but it
  // describes one scope's files: switching scope starts over rather than
  // collapsing same-named files in the scope that replaced them.
  const [collapsedSections, setCollapsedSections] = useState<{
    readonly scope: string;
    readonly paths: readonly string[];
  }>({ scope: "", paths: NO_COLLAPSED_PATHS });

  const selectedTurn =
    scope.kind === "turn"
      ? turnOptions.find((option) => option.scope.turnId === scope.turnId)
      : undefined;

  // A stored turn the transcript no longer holds collapses to the working tree.
  const activeScope: WorkbenchChangesScope =
    scope.kind === "turn" && selectedTurn === undefined ? UNCOMMITTED_SCOPE : scope;

  const activeScopeValue = changesScopeValue(activeScope);
  const root = snapshot.data?.kind === "repository" ? snapshot.data.root : undefined;
  const revision = snapshot.data?.kind === "repository" ? snapshot.data.revision : undefined;
  const repository = root === undefined || revision === undefined ? undefined : { root, revision };

  const viewedSnapshot = useSyncExternalStore(
    changesViewed.subscribe,
    changesViewed.getSnapshot,
    changesViewed.getSnapshot,
  );

  useSyncExternalStore(
    changesViewOptions.subscribe,
    changesViewOptions.getSnapshot,
    changesViewOptions.getSnapshot,
  );
  // Options follow the repository; a turn shares the layout chosen for the tree
  // it belongs to. Review marks do not: the same path carries a different patch
  // in each scope, and a mark from one must not read as stale in another.
  const optionsScopeId = root ?? "workspace";
  const options = changesViewOptions.options(optionsScopeId);

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
            .map((file): WorkingChangeRow => ({
              source: "working",
              path: file.path,
              status: file.kind,
            }))
            .sort((left, right) => left.path.localeCompare(right.path)),
    [statusFiles],
  );

  const workingPaths = useMemo(() => workingRows.map((row) => row.path), [workingRows]);

  const diffRequest = diffRequestForScope(activeScope, {
    paths: workingScope ? workingPaths : undefined,
    ignoreWhitespace: options.ignoreWhitespace,
  });

  const diffs = useVcsDiff(
    repository === undefined || diffRequest === undefined
      ? undefined
      : { ...repository, request: diffRequest },
    visible && (!workingScope || workingPaths.length > 0),
  );

  const diffByPath = useMemo(
    () => new Map((diffs.data ?? []).map((item) => [item.path, item])),
    [diffs.data],
  );

  const selectedRun = selectedTurn?.run.kind === "run" ? selectedTurn.run.id : undefined;

  const runDiff = useRunDiff({
    sessionId,
    runId: selectedRun,
    live: selectedRun !== undefined && selectedRun === liveRun,
    enabled: visible,
  });

  const runFiles =
    runDiff.data === undefined || runDiff.data.kind === "not_found"
      ? undefined
      : runDiff.data.files;

  const patchRows = useMemo(
    (): readonly PatchChangeRow[] =>
      selectedTurn !== undefined
        ? runFiles !== undefined
          ? runFiles.map((file): PatchChangeRow => ({
              source: "patch",
              origin: "recorded",
              path: file.path,
              patch: file.patch,
              added: file.added,
              removed: file.removed,
            }))
          : selectedTurn.files.map(({ change, patch }): PatchChangeRow => ({
              source: "patch",
              origin: "recorded",
              path: change.path,
              patch,
              added: change.added,
              removed: change.removed,
            }))
        : activeScope.kind === "commit"
          ? (diffs.data ?? []).map((diff): PatchChangeRow => ({
              source: "patch",
              origin: "vcs",
              path: diff.path,
              status: diff.status,
              patch: diff.patch,
              added: diff.kind === "text" ? diff.added : 0,
              removed: diff.kind === "text" ? diff.removed : 0,
            }))
          : [],
    [selectedTurn, runFiles, activeScope.kind, diffs.data],
  );

  const rows: readonly ChangeRow[] = workingScope ? workingRows : patchRows;
  const rowByPath = useMemo(() => new Map(rows.map((row) => [row.path, row])), [rows]);
  const stackOrder = useMemo(() => rows.map((row) => row.path), [rows]);

  const collapsedPaths =
    collapsedSections.scope === activeScopeValue ? collapsedSections.paths : NO_COLLAPSED_PATHS;

  const allCollapsed =
    stackOrder.length > 0 && stackOrder.every((path) => collapsedPaths.includes(path));

  const activePath = stackOrder.includes(selectedPath ?? "") ? selectedPath : stackOrder[0];
  const diffsLoading = diffs.isLoading;
  const diffsError = diffs.isError;

  const sections = useMemo(
    () =>
      rows.map((row): ChangesStackItem => {
        const path = row.path;
        const diff = diffByPath.get(path);

        if (diff?.kind === "binary") {
          return { kind: "raw", path, text: diff.patch, added: 0, removed: 0 };
        }

        if (row.source === "patch") {
          const section: ChangeStackSection =
            row.patch.trim() === ""
              ? { kind: "notice", path, text: EMPTY_PATCH }
              : { kind: "diff", path, patch: row.patch };

          return { ...section, added: row.added, removed: row.removed };
        }

        const section = uncommittedStackSection({
          path,
          state: uncommittedPatchState(diff?.patch, {
            isLoading: diffsLoading,
            isError: diffsError,
          }),
        });

        return {
          ...section,
          added: diff?.added ?? 0,
          removed: diff?.removed ?? 0,
        };
      }),
    [rows, diffByPath, diffsLoading, diffsError],
  );

  // A review mark records the patch that was read, so the digest is taken from
  // the section the stack renders rather than from the raw working-tree diff.
  const viewedFiles = useMemo(
    (): readonly ViewedFile[] =>
      sections.map((section) => ({
        path: section.path,
        digest: patchDigest(
          section.kind === "diff" ? section.patch : section.kind === "pending" ? "" : section.text,
        ),
      })),
    [sections],
  );

  const digestByPath = useMemo(
    () => new Map(viewedFiles.map((file) => [file.path, file.digest])),
    [viewedFiles],
  );

  const vcsError = queryError(snapshot.error);
  const transcriptError = queryError(turnsError);

  // Each scope blames its own source first and falls back to the other, so no
  // failure is ever dropped. Turn options depend on the transcript; working-tree
  // rows depend on Git status.
  const vcsFailure =
    vcsError === undefined
      ? undefined
      : {
          text: "Couldn't read changes. Check that this folder is a Git repository.",
          detail: vcsError,
        };

  const transcriptFailure =
    transcriptError === undefined
      ? undefined
      : { text: "Couldn't read this conversation's changes.", detail: transcriptError };

  const diffFailure = diffs.isError
    ? { text: "Couldn't read changes.", detail: queryError(diffs.error) }
    : undefined;

  const readFailure =
    scope.kind === "turn"
      ? (transcriptFailure ?? vcsFailure)
      : (diffFailure ?? vcsFailure ?? transcriptFailure);

  // The turn's own files are loaded, so its emptiness is a fact that a stale
  // background failure cannot change.
  const emptyState: { readonly text: string; readonly detail?: string } =
    selectedTurn !== undefined
      ? { text: "This turn made no file changes" }
      : (readFailure ?? {
          text:
            snapshot.isLoading || diffs.isLoading
              ? "Loading changes…"
              : emptyScopeText(activeScope),
        });

  const viewedScopeId = `${optionsScopeId}\u0000${activeScopeValue}`;

  const viewedByPath = useMemo(
    () =>
      new Map(
        viewedFiles.map((file) => {
          const mark = viewedSnapshot[viewedScopeId]?.files[file.path];

          const state: ViewedState =
            mark === undefined ? "unviewed" : mark.digest === file.digest ? "viewed" : "changed";

          return [file.path, state];
        }),
      ),
    [viewedFiles, viewedSnapshot, viewedScopeId],
  );

  const viewedState = useCallback(
    (path: string): ViewedState => viewedByPath.get(path) ?? "unviewed",
    [viewedByPath],
  );

  const setViewed = useCallback(
    (paths: readonly string[], viewed: boolean): void => {
      if (viewed) {
        changesViewed.markAllViewed(
          viewedScopeId,
          paths.flatMap((path) => {
            const digest = digestByPath.get(path);

            return digest === undefined ? [] : [{ path, digest }];
          }),
        );

        return;
      }

      changesViewed.clearAllViewed(viewedScopeId, paths);
    },
    [viewedScopeId, digestByPath],
  );

  const setFileViewed = useCallback(
    (path: string, viewed: boolean): void => {
      setViewed([path], viewed);
    },
    [setViewed],
  );

  // Only a working tree has both sides of a file to widen a gap with. A turn's
  // patch and a commit's are records of an edit, and the files have moved on.
  const expandable = repository !== undefined && workingScope;

  const loadDiffFiles = useMemo(
    () =>
      expandable && root !== undefined && revision !== undefined
        ? createDiffFilesLoader({
            readContents: (input) =>
              nyte.workspace.vcs.contents({ ...input, target: { kind: "workspace" } }),
            root,
            revision,
            scope: { kind: "worktree" },
          })
        : undefined,
    [expandable, root, revision],
  );

  const sidebarFiles = useMemo(
    (): readonly ChangesSidebarFile[] =>
      sections.map((section) => {
        const row = rowByPath.get(section.path);

        const file = {
          path: section.path,
          added: section.added,
          removed: section.removed,
          viewed: viewedState(section.path),
        };

        if (row?.source === "working" || (row?.source === "patch" && row.origin === "vcs")) {
          return { ...file, status: row.status };
        }

        return file;
      }),
    [sections, rowByPath, viewedState],
  );

  const scopeStats = sections.reduce(
    (total, section) => ({
      added: total.added + section.added,
      removed: total.removed + section.removed,
    }),
    { added: 0, removed: 0 },
  );

  const filterFiles = (): void => {
    // The rail is display:none while hidden; focus lands the frame after it shows.
    if (!fileTreeVisible) onToggleFileTree();
    requestAnimationFrame(() => focusFileFilter(filterInput.current));
  };

  // Only a working tree has a state to go back to: a turn's patch and a
  // commit's are records, and the file has moved on since.
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

      const result = await nyte.workspace.vcs.discard({
        target: { kind: "workspace" },
        paths: [target.path],
        expect: { revision },
      });

      if (result.kind === "stale") {
        refreshVcs();
        setRevertError("Changes changed. Review them and try again.");

        return;
      }

      if (result.kind !== "applied") {
        setRevertError(
          result.kind === "failed" ? result.reason : "A run is still writing to this workspace.",
        );

        return;
      }

      const skipped = result.skipped.find((entry) => entry.path === target.path);

      if (skipped !== undefined) {
        setRevertError(skipped.reason);

        return;
      }

      // The file no longer has the patch its review mark was filed under.
      changesViewed.clearViewed(viewedScopeId, target.path);
      refreshVcs();
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
          refreshVcs();

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
        onRefresh={refreshVcs}
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
          <ChangesSidebar
            files={sidebarFiles}
            visible={fileTreeVisible}
            activePath={activePath}
            filterInputRef={filterInput}
            onRevealPath={onRevealPath}
            onAllViewedChange={setViewed}
          />
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
            />
          )}
        </div>
      )}
      <ConfirmDialog
        open={revertTarget !== undefined}
        pending={reverting}
        error={revertError}
        returnFocusRef={revertReturnRef}
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
  const snapshot = useSessionSnapshot(props.sessionId);
  const run = snapshot.data?.run;

  return (
    <ChangesPanelView
      {...props}
      turns={snapshot.data?.transcript ?? EMPTY_TURNS}
      turnsError={snapshot.error}
      liveRun={run !== undefined && !isTerminalPhase(run.phase) ? run.runId : undefined}
    />
  );
}

export function ChangesPanel(props: ChangesPanelProps): ReactElement {
  return props.sessionId === undefined ? (
    <ChangesPanelView {...props} turns={EMPTY_TURNS} turnsError={null} liveRun={undefined} />
  ) : (
    <SessionChangesPanel {...props} sessionId={props.sessionId} />
  );
}
